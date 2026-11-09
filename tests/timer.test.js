const test = require("node:test");
const assert = require("node:assert/strict");
const T = require("../frontend/timer.js");

const MIN = 60 * 1000;
const make = (minutes = 15) => new T.AssistTimer({}, minutes * MIN);

test("does not count until the user starts typing", () => {
  const t = make();
  t.setActive(true, 0);
  assert.equal(t.elapsedMs(10 * MIN), 0);
  assert.equal(t.state(), "waiting");
  t.markStarted(10 * MIN);
  assert.equal(t.elapsedMs(12 * MIN), 2 * MIN);
});

test("pauses while the tab is hidden or unfocused and resumes after", () => {
  const t = make();
  t.setActive(true, 0);
  t.markStarted(0);
  t.setActive(false, 5 * MIN); // user switches tab
  assert.equal(t.state(), "paused");
  assert.equal(t.elapsedMs(60 * MIN), 5 * MIN); // an hour away adds nothing
  t.setActive(true, 60 * MIN);
  assert.equal(t.elapsedMs(63 * MIN), 8 * MIN);
});

test("started while inactive begins counting once the page becomes active", () => {
  const t = make();
  t.markStarted(0);
  t.setActive(true, 2 * MIN);
  assert.equal(t.elapsedMs(5 * MIN), 3 * MIN);
});

test("becomes due after the threshold of active time", () => {
  const t = make(15);
  t.setActive(true, 0);
  t.markStarted(0);
  assert.equal(t.isDue(14 * MIN), false);
  assert.equal(t.isDue(15 * MIN), true);
});

test("is deferred while the user is actively typing", () => {
  const t = make(15);
  t.setActive(true, 0);
  t.markStarted(0);
  const due = 15 * MIN;
  assert.equal(t.isDue(due, due - 5000), false); // typed 5s ago
  assert.equal(t.isDue(due + T.IDLE_GRACE_MS, due - 5000), true);
});

test("snooze delays the next reminder by the snooze length", () => {
  const t = make(15);
  t.setActive(true, 0);
  t.markStarted(0);
  t.markPrompted();
  t.snooze(16 * MIN); // snooze 5 min from minute 16
  assert.equal(t.isDue(20 * MIN), false);
  assert.equal(t.isDue(21 * MIN), true);
});

test("deferFullInterval waits another whole interval", () => {
  const t = make(15);
  t.setActive(true, 0);
  t.markStarted(0);
  t.deferFullInterval(15 * MIN);
  assert.equal(t.isDue(29 * MIN), false);
  assert.equal(t.isDue(30 * MIN), true);
});

test("dismiss stops reminders; reset restores them from zero", () => {
  const t = make(15);
  t.setActive(true, 0);
  t.markStarted(0);
  t.dismiss();
  assert.equal(t.isDue(100 * MIN), false);
  assert.equal(t.state(), "off");
  t.reset(100 * MIN);
  assert.equal(t.elapsedMs(100 * MIN), 0);
  assert.equal(t.isDue(114 * MIN), false);
  assert.equal(t.isDue(115 * MIN), true);
});

test("reset while paused does not start counting", () => {
  const t = make();
  t.setActive(true, 0);
  t.markStarted(0);
  t.setActive(false, 3 * MIN);
  t.reset(4 * MIN);
  assert.equal(t.elapsedMs(50 * MIN), 0);
});

test("stops prompting after MAX_PROMPTS reminders", () => {
  const t = make(1);
  t.setActive(true, 0);
  t.markStarted(0);
  for (let i = 0; i < T.MAX_PROMPTS; i++) t.markPrompted();
  assert.equal(t.isDue(500 * MIN), false);
});

test("changing the threshold applies immediately", () => {
  const t = make(15);
  t.setActive(true, 0);
  t.markStarted(0);
  t.setThreshold(5 * MIN);
  assert.equal(t.isDue(5 * MIN), true);
});

test("a different problem gets an independent timer (no carry-over)", () => {
  const a = make();
  a.setActive(true, 0);
  a.markStarted(0);
  const b = make(); // switching problems creates a fresh instance
  b.setActive(true, 20 * MIN);
  assert.equal(a.isDue(20 * MIN), true);
  assert.equal(b.isDue(20 * MIN), false);
  assert.equal(b.state(), "waiting");
});

test("restoreTimer keeps recent progress and discards stale sessions", () => {
  const now = 100 * 60 * MIN;
  const rec = { savedAt: now - MIN, timer: { elapsedMs: 7 * MIN, started: true } };
  const kept = T.restoreTimer(rec, now, 15 * MIN);
  assert.equal(kept.baseMs, 7 * MIN);
  assert.equal(kept.started, true);

  const stale = { savedAt: now - T.SESSION_EXPIRY_MS - 1, timer: { elapsedMs: 7 * MIN, started: true } };
  const fresh = T.restoreTimer(stale, now, 15 * MIN);
  assert.equal(fresh.baseMs, 0);
  assert.equal(fresh.started, false);
  assert.equal(T.restoreTimer(null, now, 15 * MIN).baseMs, 0);
});

test("toJSON round-trips through restoreTimer", () => {
  const t = make();
  t.setActive(true, 0);
  t.markStarted(0);
  t.markPrompted();
  const saved = { savedAt: 9 * MIN, timer: t.toJSON(9 * MIN) };
  const r = T.restoreTimer(saved, 9 * MIN, 15 * MIN);
  assert.equal(r.elapsedMs(9 * MIN), 9 * MIN);
  assert.equal(r.prompts, 1);
});

test("slugFromPath", () => {
  assert.equal(T.slugFromPath("/problems/two-sum/description/"), "two-sum");
  assert.equal(T.slugFromPath("/problems/two-sum"), "two-sum");
  assert.equal(T.slugFromPath("/problemset/"), null);
  assert.equal(T.slugFromPath(""), null);
});

test("clampMinutes", () => {
  assert.equal(T.clampMinutes("20"), 20);
  assert.equal(T.clampMinutes(0), 1);
  assert.equal(T.clampMinutes(9999), 180);
  assert.equal(T.clampMinutes("abc"), 15);
});
