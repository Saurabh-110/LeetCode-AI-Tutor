import os
import sys

import pytest

sys.path.insert(0, os.path.dirname(os.path.dirname(__file__)))

from app import create_app  # noqa: E402
from llm import LLMError  # noqa: E402
from prompts import build_user_turn, strip_code_blocks  # noqa: E402


class FakeLLM:
    def __init__(self, reply="Think about what you've already seen.", error=None):
        self.reply, self.error, self.calls = reply, error, []

    def generate(self, system, turns):
        self.calls.append((system, turns))
        if self.error:
            raise self.error
        return self.reply


BODY = {"problem_title": "Two Sum", "problem_description": "Find two numbers adding to target."}


@pytest.fixture
def fake():
    return FakeLLM()


@pytest.fixture
def client(fake):
    return create_app(llm=fake).test_client()


def post(client, **overrides):
    return client.post("/get-hint", json={**BODY, **overrides})


def test_health(client):
    assert client.get("/health").get_json() == {"status": "ok", "api_configured": True}


def test_first_hint_ok(client, fake):
    r = post(client)
    assert r.status_code == 200 and r.get_json()["hint"]
    system, turns = fake.calls[0]
    assert "Two Sum" in system
    assert turns[-1]["role"] == "user" and "Level 1" in turns[-1]["text"]


def test_hint_level_changes_instruction(client, fake):
    post(client, hint_level=3)
    assert "Level 3" in fake.calls[0][1][-1]["text"]


def test_history_sent_once_not_duplicated(client, fake):
    hist = [{"role": "user", "text": "q1"}, {"role": "model", "text": "a1"}]
    post(client, mode="chat", message="q2", chat_history=hist)
    turns = fake.calls[0][1]
    assert [t["role"] for t in turns] == ["user", "model", "user"]
    assert sum("q2" in t["text"] for t in turns) == 1


@pytest.mark.parametrize(
    "overrides",
    [
        {"problem_title": ""},
        {"problem_description": None},
        {"mode": "nope"},
        {"hint_level": 9},
        {"hint_level": True},
        {"mode": "chat"},  # message required
        {"chat_history": "x"},
        {"chat_history": [{"role": "system", "text": "x"}]},
        {"user_code": 5},
    ],
)
def test_validation_errors(client, overrides):
    assert post(client, **overrides).status_code == 400


def test_non_json_body(client):
    assert client.post("/get-hint", data="nope").status_code == 400


def test_payload_too_large(client):
    assert post(client, user_code="x" * 300_000).status_code == 413


def test_inputs_truncated(client, fake):
    post(client, user_code="x" * 50_000)
    assert len(fake.calls[0][1][-1]["text"]) < 21_000


def test_code_stripped_in_hint_mode():
    out = strip_code_blocks("Try this:\n```python\nreturn 1\n```\nDone", "hint")
    assert "return 1" not in out and "omitted" in out


def test_code_kept_in_code_mode():
    assert "return 1" in strip_code_blocks("```py\nreturn 1\n```", "code")


def test_reply_code_stripped_end_to_end():
    c = create_app(llm=FakeLLM(reply="```python\nsecret()\n```")).test_client()
    assert "secret()" not in post(c).get_json()["hint"]


def test_llm_error_status_passthrough():
    c = create_app(llm=FakeLLM(error=LLMError("slow down", 429))).test_client()
    r = post(c)
    assert r.status_code == 429 and r.get_json()["error"] == "slow down"


def test_unexpected_error_hides_details():
    c = create_app(llm=FakeLLM(error=RuntimeError("secret key abc"))).test_client()
    r = post(c)
    assert r.status_code == 500 and "abc" not in r.get_json()["error"]


def test_missing_api_key_returns_500(monkeypatch):
    monkeypatch.setenv("GEMINI_API_KEY", "")
    r = create_app().test_client().post("/get-hint", json=BODY)
    assert r.status_code == 500


def test_code_included_for_debug():
    t = build_user_turn("debug", 1, "", "def f(): pass", "python")
    assert "def f(): pass" in t and "Do not provide corrected code" in t


@pytest.mark.parametrize(
    "code,status,fragment",
    [(429, 429, "quota"), (503, 503, "busy"), (404, 500, "GEMINI_MODEL"), (400, 500, "key")],
)
def test_gemini_errors_are_translated(code, status, fragment):
    from google.genai import errors

    from llm import _translate

    exc = errors.APIError(code, {"error": {"message": "x"}})
    out = _translate(exc)
    assert out.status == status and fragment in out.message


def test_persona_is_beginner_friendly():
    from prompts import build_system_instruction

    assert "beginner" in build_system_instruction("T", "D")
