# LeetCode AI Tutor

A Chrome extension that tutors you through LeetCode problems **hint-first**. It never hands you the solution unprompted: you get progressively stronger hints, and pseudocode or full code only when you explicitly ask. A smart timer offers help when you've been stuck for a while, and stays out of your way the rest of the time.

> Not affiliated with LeetCode. Your problem text, code, and chat messages are sent to Google's Gemini API through your own local backend (see [Privacy](#privacy)).

## Features

- **Progressive hints.** Level 1 is a nudge, level 2 names the technique, level 3 outlines the steps in plain English. No code at any level.
- **Understands your code.** Reads the problem and your current editor contents (via Monaco), so it can explain, debug, and analyze what you actually wrote.
- **On-demand tools.** Explain my code, Debug, Complexity analysis, Brute-force vs optimized comparison, Pseudocode, Full solution. Pseudocode and full solution need a second confirming click.
- **Enforced, not just requested.** The backend prompt forbids code outside the pseudocode/full-solution modes, and a server-side guard strips any fenced code block that slips through.
- **Smart assistance timer.** Default 15 minutes, configurable 1-180 min. See below.
- **Progress and history.** Per-problem time spent, hints used, and chat history are saved locally; the popup lists recent problems.
- **Safe rendering.** AI replies are rendered as Markdown and sanitized with DOMPurify.

## What's new in v2.0

- Rebuilt around a **hint-first** policy with three hint levels; code only on explicit request, enforced server-side.
- The AI now sees **your current code** (explain, debug, complexity, brute-force vs optimized).
- **Smart per-problem timer**: pauses when you leave the tab, never carries time between problems, defers while you type, and caps reminders.
- Saved **progress and history** per problem; popup with live timer status and reset.
- Backend refactor: input validation, rate limiting, safer error handling, configurable model, 28 automated tests.
- Extension hardening: Manifest V3, sanitized Markdown rendering, no `tabs` permission, no secrets in the extension.

## How the timer works

| Situation | Behavior |
|---|---|
| Opening a problem | Nothing runs yet. The clock starts at your first keystroke in the editor. |
| Switching tabs / minimizing / window loses focus | **Pauses.** Only active time counts. |
| Computer sleeps or the browser throttles the tab | Gap is **not** counted. |
| Navigating to another problem (no page reload needed) | Each problem has its **own clock**. The old one is saved and paused; the new one starts fresh. Time never carries over. |
| Returning to a problem within 6 hours | **Resumes** where you left off. After 6 hours it starts over as a new session. |
| Leaving `/problems/*` | UI hides, timer stops. |
| Timer expires while you're typing | Deferred until you've been idle for 20 s. |
| Reminder shown | Buttons: **Get a Hint**, **Ask AI Tutor**, **Continue Solving**, plus *Snooze 5 min* and *Don't remind me here*. |
| After a reminder | Next one comes after another full interval; at most 3 reminders per problem. |
| Manual control | Reset the current problem's timer from the popup. Interval persists across browser sessions. |

## Architecture

```
 LeetCode page                         Extension                           Local server
┌─────────────────────┐  postMessage  ┌─────────────────┐  runtime msg  ┌──────────────┐   HTTP   ┌────────────┐   ┌────────┐
│ page-bridge.js      │◀────────────▶│ content.js      │──────────────▶│ background.js│─────────▶│ Flask app  │──▶│ Gemini │
│ (MAIN world: reads  │               │ timer, UI, chat │               │ (relay)      │          │ validation │   └────────┘
│  Monaco editor)     │               │ + timer.js      │               └──────────────┘          │ prompts.py │
└─────────────────────┘               └─────────────────┘                                         │ llm.py     │
                                         chrome.storage.local (settings, per-problem history)      └────────────┘
```

- `timer.js` is pure logic (no DOM or `chrome.*`), so it's unit tested in Node.
- The API key lives only in `backend/.env`. Nothing secret is in the extension.
- The service worker talks to `127.0.0.1:5000` through a host permission, so no CORS surface is exposed to web pages.

## Setup

**Requirements:** Python 3.10+, Node 18+ (tests only), Google Chrome 111+, a [Gemini API key](https://aistudio.google.com/apikey).

### 1. Backend

```bash
cd backend
python -m venv venv
source venv/bin/activate        # Windows: .\venv\Scripts\activate
pip install -r requirements.txt
cp .env.example .env            # Windows: copy .env.example .env  (then put your key in .env)
python app.py
```

Gemini model names change over time. If you get a "model not found" error, list the models your key can use and set `GEMINI_MODEL` in `.env`:

```bash
python -c "from dotenv import load_dotenv; import os; load_dotenv(); from google import genai; c=genai.Client(api_key=os.getenv('GEMINI_API_KEY')); [print(m.name) for m in c.models.list() if 'generateContent' in (m.supported_actions or [])]"
```

Check it: `http://127.0.0.1:5000/health` should return `{"api_configured": true, "status": "ok"}`.

### 2. Extension

1. Open `chrome://extensions` and enable **Developer mode**.
2. **Load unpacked** and select the `frontend/` folder.
3. Open any problem, e.g. <https://leetcode.com/problems/two-sum/>, and start typing.

### Environment variables (`backend/.env`)

| Variable | Required | Default | Purpose |
|---|---|---|---|
| `GEMINI_API_KEY` | yes | none | Gemini API key |
| `GEMINI_MODEL` | no | `gemini-3.1-flash-lite` | Model used for replies |
| `RATE_LIMIT_DEFAULT` | no | `60 per minute` | Global per-IP limit |
| `RATE_LIMIT_HINT` | no | `30 per minute` | Limit on `/get-hint` |
| `PORT` | no | `5000` | Port for `python app.py` |
| `FLASK_DEBUG` | no | `false` | Development only |

## Troubleshooting

| Symptom | Fix |
|---|---|
| "Could not reach the backend" | Start the server (`python app.py`) and check `http://127.0.0.1:5000/health`. |
| "model was not found" | Set `GEMINI_MODEL` to a model from the list command above, then restart the server. |
| "AI model is busy" / request times out | The model is overloaded. Try again, or switch `GEMINI_MODEL` to a lighter model. |
| "quota or rate limit reached" | Wait a minute, or check your usage in Google AI Studio. |
| Settings in `.env` have no effect | `.env` is read at startup. Stop the server (`Ctrl+C`) and start it again. |
| "couldn't read this problem" | LeetCode changed its page. Update the selectors in `frontend/content.js`. |

## Tests

```bash
# Backend (validation, prompts, code-leak guard, error handling; Gemini is mocked)
cd backend && pip install pytest && python -m pytest -q

# Extension (timer logic + content script in jsdom with a fake chrome API and clock)
npm install && npm test
```

Not covered by automated tests: behavior inside a real Chrome browser against live leetcode.com, and response quality from Gemini. Verify those manually after loading the extension.

## Project structure

```
backend/   app.py (routes, validation)  prompts.py (hint-first policy)  llm.py (Gemini wrapper)  tests/
frontend/  manifest.json  background.js  content.js  timer.js  page-bridge.js  popup.*  styles.css  lib/  icons/
tests/     timer.test.js  content.integration.test.js
```

## Security notes

- API key is read from the environment on the backend only; `.env` is git-ignored.
- Inputs are type-checked and length-limited server-side (title, description, code, messages, history); request bodies over 200 KB are rejected.
- Problem text and your code are placed in the prompt as delimited data, with instructions to ignore any commands inside them.
- Errors returned to the extension are generic; details stay in server logs.
- Manifest V3 with a strict extension CSP; permissions are `storage` plus two host permissions. The service worker only accepts messages from this extension.
- Rate limiting is in-memory and per client IP.

## Privacy

When you ask for help, the problem statement, your current code, and your chat messages are sent to your backend and then to Google's Gemini API. Timer data and history stay in `chrome.storage.local` on your machine (pruned after 90 days; clear anytime from the popup). There is no analytics or telemetry.

## Known limitations

- LeetCode's page structure changes occasionally. The scraper tries several selectors and shows a clear error if none match; if that happens, update the selectors in `content.js`.
- Editor contents come from the Monaco model exposed on `window.monaco`. If LeetCode stops exposing it, the extension falls back to the visible lines only.
- "Never gives code" is enforced by prompt plus a fenced-block filter, not a guarantee; a model could still describe a solution in prose at higher hint levels.

## License

MIT, see [LICENSE](LICENSE).
