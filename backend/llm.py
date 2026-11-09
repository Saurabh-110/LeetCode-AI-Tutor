"""Thin wrapper around the Gemini SDK so the rest of the app (and tests) never touch it directly."""

from google import genai
from google.genai import errors, types


class LLMError(Exception):
    """Raised for any upstream failure, with an HTTP status and a user-safe message."""

    def __init__(self, message: str, status: int = 502):
        super().__init__(message)
        self.message = message
        self.status = status


class GeminiClient:
    def __init__(self, api_key: str, model: str):
        self._client = genai.Client(api_key=api_key)
        self._model = model

    def generate(self, system_instruction: str, turns: list[dict]) -> str:
        """turns: [{"role": "user"|"model", "text": str}, ...] ending with a user turn."""
        contents = [
            types.Content(role=t["role"], parts=[types.Part(text=t["text"])]) for t in turns
        ]
        try:
            response = self._client.models.generate_content(
                model=self._model,
                contents=contents,
                config=types.GenerateContentConfig(
                    system_instruction=system_instruction,
                    temperature=0.4,
                    max_output_tokens=1500,
                ),
            )
        except errors.APIError as exc:
            raise _translate(exc) from exc
        except Exception as exc:  # network errors, timeouts
            raise LLMError("Could not reach the AI service. Please try again.", 502) from exc

        text = (response.text or "").strip()
        if not text:
            raise LLMError("The AI returned an empty response. Please try again.", 502)
        return text


def _translate(exc: errors.APIError) -> LLMError:
    code = getattr(exc, "code", None)
    if code == 429:
        return LLMError("AI quota or rate limit reached. Wait a moment and try again.", 429)
    if code in (400, 401, 403):
        return LLMError("The server's Gemini API key or model configuration is invalid.", 500)
    if code == 404:
        return LLMError("The configured Gemini model was not found. Check GEMINI_MODEL.", 500)
    if code in (500, 503):
        return LLMError("The AI model is busy right now. Please try again in a moment.", 503)
    return LLMError("The AI service had a problem. Please try again.", 502)
