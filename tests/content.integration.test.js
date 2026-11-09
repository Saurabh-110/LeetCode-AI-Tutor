/**
 * Integration test: runs the real content.js inside jsdom with a fake chrome API and fake clock.
 * Skipped automatically when jsdom isn't installed (`npm install` provides it).
 */
const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");

let JSDOM;
try {
  ({ JSDOM } = require("jsdom"));
} catch (_) {
  /* handled below */
}

const MIN = 60 * 1000;
const read = (f) => fs.readFileSync(path.join(__dirname, "..", "frontend", f), "utf8");

function setup(startPath = "/problems/two-sum/", reply = "Think about a hash map.") {
  const dom = new JSDOM(
    `<body>
       <div class="text-title-large"><a>1. Two Sum</a></div>
       <div data-track-load="description_content">Find two numbers that add up to target.</div>
       <div class="monaco-editor"><textarea id="ta"></textarea><div class="view-lines">def f():\u00a0\u00a0pass</div></div>
     </body>`,
    { url: `https://leetcode.com${startPath}`, runScripts: "outside-only", pretendToBeVisual: true },
  );
  const w = dom.window;
  const env = { now: 1_000_000, visible: true, focused: true, interval: null, store: {}, onMessage: null, sent: [] };

  w.Date = class extends Date {
    static now() {
      return env.now;
    }
  };
  w.setInterval = (fn) => ((env.interval = fn), 1);
  Object.defineProperty(w.document, "visibilityState", { get: () => (env.visible ? "visible" : "hidden") });
  w.document.hasFocus = () => env.focused;
  // jsdom has no layout engine, so innerText is shimmed
  w.document.querySelector("[data-track-load]").innerText = "Find two numbers that add up to target.";
  w.document.querySelector(".view-lines").innerText = "def f():\u00a0\u00a0pass";

  w.chrome = {
    runtime: {
      id: "test-ext",
      sendMessage: (msg, cb) => (env.sent.push(msg), cb && cb({ hint: reply })),
      onMessage: { addListener: (fn) => (env.onMessage = fn) },
      lastError: null,
    },
    storage: {
      local: {
        get: (keys, cb) => {
          const all = env.store;
          if (keys === null) return cb({ ...all });
          const list = Array.isArray(keys) ? keys : [keys];
          cb(Object.fromEntries(list.filter((k) => k in all).map((k) => [k, all[k]])));
        },
        set: (obj) => Object.assign(env.store, JSON.parse(JSON.stringify(obj))),
        remove: () => {},
      },
    },
  };

  w.eval(read("lib/marked.min.js"));
  w.eval(read("lib/purify.min.js"));
  w.eval(read("timer.js"));
  w.eval(read("content.js"));

  const api = {
    env,
    w,
    /** Advance like a real browser: one tick per second. */
    advance(ms) {
      let left = ms;
      do {
        const step = Math.min(1000, left);
        env.now += step;
        left -= step;
        env.interval();
      } while (left > 0);
    },
    /** One giant gap with no ticks in between (sleep, throttling). */
    jump(ms) {
      env.now += ms;
      env.interval();
    },
    type() {
      const ta = w.document.getElementById("ta");
      ta.dispatchEvent(new w.KeyboardEvent("keydown", { key: "a", bubbles: true }));
    },
    status() {
      let out;
      env.onMessage({ type: "getStatus" }, { id: "test-ext" }, (r) => (out = r));
      return out;
    },
    goto(p) {
      w.history.pushState({}, "", p);
      env.interval();
    },
    card: () => w.document.querySelector(".lt-card"),
  };
  env.interval(); // first tick loads the problem
  return api;
}

const skip = JSDOM ? false : "jsdom not installed";

test("timer waits for first keystroke, then counts active time", { skip }, () => {
  const t = setup();
  t.advance(5 * MIN);
  assert.equal(t.status().state, "waiting");
  t.type();
  t.advance(3 * MIN);
  assert.equal(t.status().state, "running");
  assert.equal(Math.round(t.status().elapsedMs / MIN), 3);
});

test("shows the reminder after 15 active minutes, but not while typing", { skip }, () => {
  const t = setup();
  t.type();
  t.advance(15 * MIN - 5000);
  t.type(); // still typing right at the deadline
  t.advance(10000);
  assert.equal(t.card(), null, "must not interrupt active typing");
  t.advance(25000); // idle past the grace period
  assert.ok(t.card(), "reminder should appear");
  assert.match(t.card().textContent, /You've been working on this problem for a while/);
  const labels = [...t.card().querySelectorAll("button")].map((b) => b.textContent);
  assert.deepEqual(labels.slice(0, 3), ["Get a Hint", "Ask AI Tutor", "Continue Solving"]);
});

test("pauses while the tab is hidden or unfocused", { skip }, () => {
  const t = setup();
  t.type();
  t.advance(2 * MIN);
  t.env.visible = false;
  t.advance(0); // the visibilitychange event ticks immediately
  t.advance(60 * MIN); // away for an hour
  assert.equal(t.status().state, "paused");
  assert.equal(Math.round(t.status().elapsedMs / MIN), 2);
  assert.equal(t.card(), null, "no reminder while away");
  t.env.visible = true;
  t.advance(1 * MIN);
  assert.equal(Math.round(t.status().elapsedMs / MIN), 3);
  t.env.focused = false; // window blur also pauses
  t.advance(0);
  t.advance(30 * MIN);
  assert.equal(Math.round(t.status().elapsedMs / MIN), 3);
});

test("switching problems starts a fresh timer and never carries time over", { skip }, () => {
  const t = setup();
  t.type();
  t.advance(14 * MIN);
  t.goto("/problems/add-two-numbers/");
  t.advance(1000);
  assert.equal(t.status().slug, "add-two-numbers");
  assert.equal(t.status().state, "waiting");
  assert.equal(t.status().elapsedMs, 0);
  t.advance(10 * MIN);
  assert.equal(t.card(), null, "old problem's time must not trigger a reminder here");
});

test("returning to a problem resumes its saved time (pause, not reset)", { skip }, () => {
  const t = setup();
  t.type();
  t.advance(6 * MIN);
  t.goto("/problems/add-two-numbers/");
  t.advance(1000);
  t.advance(30 * MIN); // time spent elsewhere must not count for two-sum
  t.goto("/problems/two-sum/");
  t.advance(1000);
  assert.equal(Math.round(t.status().elapsedMs / MIN), 6);
});

test("a stale session (revisit after >6h) starts over", { skip }, () => {
  const t = setup();
  t.type();
  t.advance(6 * MIN);
  t.goto("/problems/add-two-numbers/");
  t.advance(1000);
  t.advance(7 * 60 * MIN);
  t.goto("/problems/two-sum/");
  t.advance(1000);
  assert.equal(t.status().elapsedMs, 0);
});

test("leaving the problem area hides the UI and stops the timer", { skip }, () => {
  const t = setup();
  t.type();
  t.advance(15 * MIN + 30000);
  assert.ok(t.card());
  t.goto("/problemset/");
  t.advance(1000);
  assert.equal(t.card(), null);
  assert.equal(t.status().slug, null);
});

test("computer sleep / throttled timers are not counted as active time", { skip }, () => {
  const t = setup();
  t.type();
  t.advance(2 * MIN);
  t.jump(3 * 60 * MIN); // laptop lid closed for 3h: one huge gap between ticks, tab still "visible"
  assert.ok(t.status().elapsedMs <= 2 * MIN + 1000, "sleep must not be counted");
  assert.equal(t.card(), null);
});

test("Get a Hint sends a level-1 hint request with the user's code and renders the reply", { skip }, async () => {
  const t = setup();
  t.type();
  t.advance(15 * MIN + 30000);
  [...t.card().querySelectorAll("button")].find((b) => b.textContent === "Get a Hint").click();
  await new Promise((r) => setTimeout(r, 1000)); // editor-code fallback resolves after 800ms
  const req = t.env.sent.at(-1);
  assert.equal(req.type, "getHint");
  assert.equal(req.payload.mode, "hint");
  assert.equal(req.payload.hint_level, 1);
  assert.equal(req.payload.problem_title, "Two Sum");
  assert.equal(req.payload.user_code, "def f():  pass"); // nbsp normalised
  const log = t.w.document.querySelector(".lt-log").textContent;
  assert.match(log, /Think about a hash map/);
  assert.match(t.w.document.querySelector(".lt-chip-hint").textContent, /2\/3/); // next hint is level 2
  const turns = JSON.parse(JSON.stringify(t.env.store["p:two-sum"].messages));
  assert.deepEqual(turns.map((m) => m.role), ["user", "model"]); // saved to history, alternating
});

test("snooze and dismiss stop repeated interruptions", { skip }, () => {
  const t = setup();
  t.type();
  t.advance(15 * MIN + 30000);
  [...t.card().querySelectorAll("button")].find((b) => /Snooze/.test(b.textContent)).click();
  assert.equal(t.card(), null);
  t.advance(4 * MIN);
  assert.equal(t.card(), null);
  t.advance(2 * MIN);
  assert.ok(t.card(), "reappears after the 5-minute snooze");
  [...t.card().querySelectorAll("button")].find((b) => /Don't remind/.test(b.textContent)).click();
  t.advance(60 * MIN);
  assert.equal(t.card(), null);
});

test("AI replies are rendered as markdown but sanitised (no script / event handlers)", { skip }, async () => {
  const evil = "**Use a map.** <img src=x onerror=alert(1)><script>window.pwned=1</script> [x](javascript:alert(1))";
  const t = setup("/problems/two-sum/", evil);
  t.type();
  t.advance(15 * MIN + 30000);
  [...t.card().querySelectorAll("button")].find((b) => b.textContent === "Get a Hint").click();
  await new Promise((r) => setTimeout(r, 1000));
  const ai = t.w.document.querySelector(".lt-log .lt-ai:last-child");
  assert.ok(ai.querySelector("strong"), "markdown rendered");
  assert.equal(ai.querySelector("img, script, a"), null, "dangerous tags removed");
  assert.equal(t.w.pwned, undefined);
});
