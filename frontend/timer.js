/**
 * Assistance timer: pure logic, no DOM or chrome.* access, so it can be unit tested in Node.
 *
 * Design:
 *  - Time only counts while the user is "active" (tab visible AND window focused) and has
 *    started working (first keystroke in the editor).
 *  - Each problem has its own timer instance. Switching problems swaps instances, so one
 *    problem's time never triggers a reminder on another.
 *  - A reminder is deferred while the user is typing (idle grace period) and capped per problem.
 */
(function (root) {
  const DEFAULT_MINUTES = 15;
  const MIN_MINUTES = 1;
  const MAX_MINUTES = 180;
  const IDLE_GRACE_MS = 20 * 1000; // never interrupt active typing
  const SNOOZE_MS = 5 * 60 * 1000;
  const MAX_PROMPTS = 3; // stop nagging after this many reminders per problem
  const SESSION_EXPIRY_MS = 6 * 60 * 60 * 1000; // revisit after 6h = fresh session

  function clampMinutes(value) {
    const n = Math.round(Number(value));
    if (!Number.isFinite(n)) return DEFAULT_MINUTES;
    return Math.min(MAX_MINUTES, Math.max(MIN_MINUTES, n));
  }

  /** "/problems/two-sum/description/" -> "two-sum"; null if not a problem page. */
  function slugFromPath(pathname) {
    const m = /^\/problems\/([^/]+)/.exec(pathname || "");
    return m ? m[1] : null;
  }

  class AssistTimer {
    constructor(saved = {}, thresholdMs = DEFAULT_MINUTES * 60 * 1000) {
      this.thresholdMs = thresholdMs;
      this.baseMs = saved.elapsedMs || 0; // banked active time
      this.extraMs = saved.extraMs || 0; // added by snoozes
      this.prompts = saved.prompts || 0;
      this.dismissed = !!saved.dismissed;
      this.started = !!saved.started;
      this.active = false;
      this.segmentStart = null; // when the current active segment began
    }

    get counting() {
      return this.started && this.active;
    }

    elapsedMs(now) {
      return (
        this.baseMs +
        (this.segmentStart != null ? Math.max(0, now - this.segmentStart) : 0)
      );
    }

    /** User began working (first editor keystroke). Idempotent. */
    markStarted(now) {
      if (this.started) return;
      this.started = true;
      if (this.active) this.segmentStart = now;
    }

    /** Page became active/inactive (visibility + focus). Banks time when going inactive. */
    setActive(active, now) {
      if (active === this.active) return;
      if (this.segmentStart != null) {
        this.baseMs += Math.max(0, now - this.segmentStart);
        this.segmentStart = null;
      }
      this.active = active;
      if (this.counting) this.segmentStart = now;
    }

    setThreshold(ms) {
      this.thresholdMs = ms;
    }

    dueAtMs() {
      return this.thresholdMs + this.extraMs;
    }

    remainingMs(now) {
      return Math.max(0, this.dueAtMs() - this.elapsedMs(now));
    }

    /** Should the reminder appear right now? */
    isDue(now, lastActivityAt = null) {
      if (!this.started || this.dismissed || this.prompts >= MAX_PROMPTS)
        return false;
      if (this.elapsedMs(now) < this.dueAtMs()) return false;
      return lastActivityAt == null || now - lastActivityAt >= IDLE_GRACE_MS;
    }

    /** Record that a reminder was shown. */
    markPrompted() {
      this.prompts += 1;
    }

    /** Remind again after `ms` more active time (default 5 min). */
    snooze(now, ms = SNOOZE_MS) {
      this.dismissed = false;
      this.extraMs = Math.max(0, this.elapsedMs(now) + ms - this.thresholdMs);
    }

    /** Remind again after one full interval. */
    deferFullInterval(now) {
      this.snooze(now, this.thresholdMs);
    }

    /** No more reminders for this problem. */
    dismiss() {
      this.dismissed = true;
    }

    /** Clock back to zero. Stays "started" and keeps counting if the page is active. */
    reset(now) {
      this.baseMs = 0;
      this.extraMs = 0;
      this.prompts = 0;
      this.dismissed = false;
      this.segmentStart = this.counting ? now : null;
    }

    toJSON(now) {
      return {
        elapsedMs: this.elapsedMs(now),
        extraMs: this.extraMs,
        prompts: this.prompts,
        dismissed: this.dismissed,
        started: this.started,
      };
    }

    state() {
      if (!this.started) return "waiting";
      if (this.dismissed || this.prompts >= MAX_PROMPTS) return "off";
      return this.active ? "running" : "paused";
    }
  }

  /**
   * Rebuild a timer from a stored per-problem record. A record older than
   * SESSION_EXPIRY_MS belongs to a previous session, so start fresh.
   */
  function restoreTimer(record, now, thresholdMs) {
    const fresh =
      !record || !record.savedAt || now - record.savedAt > SESSION_EXPIRY_MS;
    return new AssistTimer(fresh ? {} : record.timer || {}, thresholdMs);
  }

  const api = {
    AssistTimer,
    restoreTimer,
    slugFromPath,
    clampMinutes,
    DEFAULT_MINUTES,
    MIN_MINUTES,
    MAX_MINUTES,
    IDLE_GRACE_MS,
    SNOOZE_MS,
    MAX_PROMPTS,
    SESSION_EXPIRY_MS,
  };

  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.LTTimer = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
