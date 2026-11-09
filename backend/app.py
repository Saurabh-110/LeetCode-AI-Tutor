"""LeetCode AI Tutor backend.

Flask API that turns a problem, the student's code, and a mode (hint, debug, ...)
into a tutoring reply from Gemini. The API key never leaves this process.
"""

import logging
import os

from dotenv import load_dotenv
from flask import Flask, jsonify, request
from flask_limiter import Limiter
from flask_limiter.util import get_remote_address

from llm import GeminiClient, LLMError
from prompts import MODES, build_system_instruction, build_user_turn, strip_code_blocks

load_dotenv()

log = logging.getLogger("leetcode-tutor")

MAX_BODY_BYTES = 200 * 1024
LIMITS = {
    "title": 300,
    "description": 12000,
    "code": 20000,
    "message": 2000,
    "language": 40,
    "history_turns": 20,
}


class ValidationError(ValueError):
    pass


def _text(data: dict, key: str, limit: int, required: bool = False) -> str:
    value = data.get(key, "")
    if value is None:
        value = ""
    if not isinstance(value, str):
        raise ValidationError(f"'{key}' must be a string.")
    value = value.strip()
    if required and not value:
        raise ValidationError(f"'{key}' is required.")
    return value[:limit]


def parse_request(data) -> dict:
    """Validate and normalise the JSON body. Raises ValidationError."""
    if not isinstance(data, dict):
        raise ValidationError("Request body must be a JSON object.")

    mode = data.get("mode", "hint")
    if mode not in MODES:
        raise ValidationError(f"'mode' must be one of: {', '.join(MODES)}.")

    level = data.get("hint_level", 1)
    if not isinstance(level, int) or isinstance(level, bool) or not 1 <= level <= 3:
        raise ValidationError("'hint_level' must be an integer from 1 to 3.")

    history = data.get("chat_history", [])
    if not isinstance(history, list):
        raise ValidationError("'chat_history' must be a list.")
    clean_history = []
    for turn in history[-LIMITS["history_turns"]:]:
        if (
            not isinstance(turn, dict)
            or turn.get("role") not in ("user", "model")
            or not isinstance(turn.get("text"), str)
        ):
            raise ValidationError("Each chat_history item needs role ('user'|'model') and text.")
        clean_history.append({"role": turn["role"], "text": turn["text"][: LIMITS["message"] * 3]})

    message = _text(data, "message", LIMITS["message"])
    if mode == "chat" and not message:
        raise ValidationError("'message' is required in chat mode.")

    return {
        "title": _text(data, "problem_title", LIMITS["title"], required=True),
        "description": _text(data, "problem_description", LIMITS["description"], required=True),
        "code": _text(data, "user_code", LIMITS["code"]),
        "language": _text(data, "language", LIMITS["language"]),
        "mode": mode,
        "hint_level": level,
        "message": message,
        "history": clean_history,
    }


def create_app(llm=None) -> Flask:
    """App factory. Pass `llm` (anything with .generate) to inject a fake in tests."""
    app = Flask(__name__)
    app.config["MAX_CONTENT_LENGTH"] = MAX_BODY_BYTES
    logging.basicConfig(level=logging.INFO, format="%(asctime)s %(levelname)s %(message)s")

    api_key = os.getenv("GEMINI_API_KEY", "")
    configured = bool(api_key) and api_key != "YOUR_API_KEY_HERE"
    if llm is None and configured:
        llm = GeminiClient(api_key, os.getenv("GEMINI_MODEL", "gemini-3.1-flash-lite"))
    if llm is None:
        log.error("GEMINI_API_KEY is missing or a placeholder; /get-hint will return 500.")

    limiter = Limiter(
        get_remote_address,
        app=app,
        default_limits=[os.getenv("RATE_LIMIT_DEFAULT", "60 per minute")],
        storage_uri="memory://",
    )

    @app.after_request
    def security_headers(response):
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Cache-Control"] = "no-store"
        return response

    @app.get("/health")
    def health():
        return jsonify({"status": "ok", "api_configured": llm is not None})

    @app.errorhandler(413)
    def too_large(_):
        return jsonify({"error": "Request payload too large."}), 413

    @app.post("/get-hint")
    @limiter.limit(os.getenv("RATE_LIMIT_HINT", "30 per minute"))
    def get_hint():
        if llm is None:
            return jsonify({"error": "The server's API key is missing. Check backend/.env."}), 500

        data = request.get_json(silent=True)
        try:
            req = parse_request(data)
        except ValidationError as exc:
            return jsonify({"error": str(exc)}), 400

        system = build_system_instruction(req["title"], req["description"])
        turn = build_user_turn(
            req["mode"], req["hint_level"], req["message"], req["code"], req["language"]
        )
        turns = req["history"] + [{"role": "user", "text": turn}]

        log.info("mode=%s level=%s problem=%s", req["mode"], req["hint_level"], req["title"][:60])
        try:
            reply = llm.generate(system, turns)
        except LLMError as exc:
            log.warning("LLM failure (%s): %s", exc.status, exc.message)
            return jsonify({"error": exc.message}), exc.status
        except Exception:  # never leak internals
            log.exception("Unexpected error generating reply")
            return jsonify({"error": "Unexpected server error. Please try again."}), 500

        return jsonify({"hint": strip_code_blocks(reply, req["mode"]), "mode": req["mode"]})

    return app


app = create_app()

if __name__ == "__main__":
    debug = os.getenv("FLASK_DEBUG", "false").lower() == "true"
    app.run(host="127.0.0.1", port=int(os.getenv("PORT", "5000")), debug=debug)
