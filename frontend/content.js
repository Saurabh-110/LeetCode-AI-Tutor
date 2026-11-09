/**
 * LeetCode AI Tutor - content script.
 *
 * Responsibilities: per-problem assistance timer (pauses when you leave the page, resets when
 * you change problems), reminder card, and the hint-first chat panel. Timer maths lives in
 * timer.js (unit tested); this file wires it to the page, storage and the backend.
 */
(() => {
  "use strict";

  const { AssistTimer, restoreTimer, slugFromPath, clampMinutes, DEFAULT_MINUTES } = globalThis.LTTimer;

  const TICK_MS = 1000;
  const SAVE_EVERY_MS = 10 * 1000;
  const SUSPEND_GAP_MS = 15 * 1000;
  const MAX_SAVED_MESSAGES = 40;
  const HISTORY_RETENTION_MS = 90 * 24 * 60 * 60 * 1000;
  const MAX_HINT_LEVEL = 3;

  const ACTIONS = [
    { mode: "explain", label: "Explain my code", say: "Explain what my code does." },
    { mode: "debug", label: "Debug", say: "Please debug my code." },
    { mode: "complexity", label: "Complexity", say: "What is the time and space complexity of my code?" },
    { mode: "compare", label: "Brute vs optimal", say: "Compare brute-force and optimized approaches." },
    { mode: "pseudocode", label: "Pseudocode", say: "Show me pseudocode.", spoiler: true },
    { mode: "code", label: "Full solution", say: "Show me the full solution.", spoiler: true },
  ];

  const state = {
    settings: { isEnabled: true, timerMinutes: DEFAULT_MINUTES },
    slug: null,
    loading: false,
    timer: null,
    record: null, // persisted per-problem data (hints used, messages)
    history: [], // [{role:'user'|'model', text}] sent to the backend
    hintLevel: 1,
    hintsUsed: 0,
    lastActivityAt: null,
    lastSave: 0,
    lastTickAt: 0,
    busy: false,
    chatOpen: false,
    ui: { root: null, launcher: null, card: null, panel: null, log: null, input: null, controls: [] },
  };

  const alive = () => {
    try {
      return !!chrome.runtime.id;
    } catch (_) {
      return false; // extension was reloaded/updated; this script is orphaned
    }
  };
  const thresholdMs = () => clampMinutes(state.settings.timerMinutes) * 60 * 1000;
  const storageKey = (slug) => `p:${slug}`;

  // ---------- DOM helpers ----------

  function el(tag, props = {}, ...kids) {
    const node = document.createElement(tag);
    for (const [k, v] of Object.entries(props)) {
      if (v == null || v === false) continue;
      if (k === "class") node.className = v;
      else if (k.startsWith("on")) node.addEventListener(k.slice(2), v);
      else node.setAttribute(k, v === true ? "" : v);
    }
    node.append(...kids);
    return node;
  }

  function renderMarkdown(node, text) {
    const parse = globalThis.marked && (globalThis.marked.parse || globalThis.marked);
    if (parse && globalThis.DOMPurify) {
      const html = parse(text, { gfm: true, breaks: true });
      node.innerHTML = globalThis.DOMPurify.sanitize(html, {
        ALLOWED_TAGS: ["p", "br", "strong", "em", "code", "pre", "ul", "ol", "li", "blockquote",
          "h1", "h2", "h3", "h4", "table", "thead", "tbody", "tr", "th", "td"],
        ALLOWED_ATTR: [],
      });
    } else {
      node.textContent = text;
    }
  }

  // ---------- Page scraping ----------

  function firstMatch(selectors) {
    for (const s of selectors) {
      const n = document.querySelector(s);
      if (n && n.textContent.trim()) return n;
    }
    return null;
  }

  function scrapeTitle() {
    const n = firstMatch(['[data-cy="question-title"]', ".text-title-large a", ".text-title-large"]);
    if (n) return n.textContent.trim().replace(/^\d+\.\s*/, "");
    const fromTab = document.title.replace(/\s*-\s*LeetCode.*$/i, "").trim();
    return fromTab || null;
  }

  function scrapeProblem() {
    const title = scrapeTitle();
    const node = firstMatch([
      '[data-track-load="description_content"]',
      ".elfjS",
      ".question-content",
    ]);
    const description = node ? node.innerText.trim() : "";
    return title && description ? { title, description } : null;
  }

  /** Editor contents via the MAIN-world bridge; falls back to the visible DOM lines. */
  function getEditor() {
    return new Promise((resolve) => {
      const id = `${Date.now()}-${Math.random()}`;
      const done = (value) => {
        window.removeEventListener("message", onMessage);
        clearTimeout(timeout);
        resolve(value);
      };
      const onMessage = (e) => {
        const m = e.data;
        if (e.source === window && m && m.source === "lt-page" && m.id === id) {
          done({ code: m.code || "", language: m.language || "" });
        }
      };
      const timeout = setTimeout(() => {
        const lines = document.querySelector(".monaco-editor .view-lines");
        done({ code: lines ? lines.innerText.replace(/ /g, " ") : "", language: "" });
      }, 800);
      window.addEventListener("message", onMessage);
      window.postMessage({ source: "lt-content", type: "getCode", id }, "*");
    });
  }

  // ---------- Persistence ----------

  function save(now = Date.now(), leaving = false) {
    if (!alive() || !state.slug || !state.timer) return;
    // Don't create history entries for problems the user merely opened.
    if (!state.timer.started && state.history.length === 0) return;
    state.lastSave = now;
    const prev = state.record || {};
    // While leaving, the DOM may already show the next problem, so don't trust a fresh scrape.
    const title = leaving ? prev.title || state.slug : scrapeTitle() || prev.title || state.slug;
    state.record = {
      title,
      url: `https://leetcode.com/problems/${state.slug}/`,
      firstSeen: prev.firstSeen || now,
      savedAt: now,
      hintsUsed: state.hintsUsed,
      hintLevel: state.hintLevel,
      messages: state.history.slice(-MAX_SAVED_MESSAGES),
      timer: state.timer.toJSON(now),
    };
    chrome.storage.local.set({ [storageKey(state.slug)]: state.record });
  }

  function pruneOldRecords() {
    chrome.storage.local.get(null, (all) => {
      const cutoff = Date.now() - HISTORY_RETENTION_MS;
      const stale = Object.keys(all).filter((k) => k.startsWith("p:") && (all[k].savedAt || 0) < cutoff);
      if (stale.length) chrome.storage.local.remove(stale);
    });
  }

  // ---------- Problem lifecycle ----------

  /** Detect SPA navigation. Leaving a problem banks and saves its time; entering one loads its own timer. */
  function syncProblem(now) {
    const slug = slugFromPath(location.pathname);
    if (slug === state.slug) return;

    if (state.timer) {
      state.timer.setActive(false, now); // bank time up to this moment
      save(now, true);
    }
    closeCard();
    closePanel();
    state.slug = slug;
    state.timer = null;
    state.record = null;
    state.history = [];
    state.hintLevel = 1;
    state.hintsUsed = 0;
    state.lastActivityAt = null;
    state.busy = false;
    updateLauncher();

    if (!slug) return;
    state.loading = true;
    chrome.storage.local.get(storageKey(slug), (res) => {
      if (state.slug !== slug || !alive()) return; // navigated again while loading
      const rec = res[storageKey(slug)] || null;
      state.record = rec;
      state.timer = restoreTimer(rec, Date.now(), thresholdMs());
      state.history = rec && Array.isArray(rec.messages) ? rec.messages : [];
      state.hintLevel = (rec && rec.hintLevel) || 1;
      state.hintsUsed = (rec && rec.hintsUsed) || 0;
      state.loading = false;
      state.timer.setActive(isPageActive(), Date.now());
      updateLauncher();
    });
  }

  const isPageActive = () => document.visibilityState === "visible" && document.hasFocus();

  function tick() {
    if (!alive()) return clearInterval(tickHandle);
    const now = Date.now();
    syncProblem(now);
    const t = state.timer;
    if (!t) return;
    // A long gap between ticks means the computer slept or the browser throttled this tab.
    // Count only up to the last tick we actually saw, not the time we weren't running.
    if (state.lastTickAt && now - state.lastTickAt > SUSPEND_GAP_MS) t.setActive(false, state.lastTickAt);
    state.lastTickAt = now;
    t.setActive(isPageActive(), now);
    if (state.settings.isEnabled && !state.ui.card && !state.chatOpen && t.isDue(now, state.lastActivityAt)) {
      showCard(now);
    }
    if (t.started && now - state.lastSave >= SAVE_EVERY_MS) save(now);
  }

  function onEditorKeydown(e) {
    if (!(e.target instanceof Element) || !e.target.closest(".monaco-editor")) return;
    const now = Date.now();
    state.lastActivityAt = now;
    if (state.timer && !state.timer.started) {
      state.timer.setActive(isPageActive(), now);
      state.timer.markStarted(now);
      save(now);
    }
  }

  // ---------- UI: launcher, reminder card, chat panel ----------

  function ensureRoot() {
    if (state.ui.root && document.body.contains(state.ui.root)) return;
    state.ui.root = el("div", { id: "leet-tutor-root" });
    state.ui.launcher = el("button", {
      class: "lt-launcher", type: "button", title: "AI Tutor", "aria-label": "Open AI Tutor",
      onclick: () => (state.chatOpen ? closePanel() : openPanel()),
    }, "AI");
    state.ui.root.append(state.ui.launcher);
    document.body.append(state.ui.root);
  }

  function updateLauncher() {
    const visible = state.settings.isEnabled && !!state.slug;
    if (visible) ensureRoot();
    if (state.ui.root) state.ui.root.style.display = visible ? "" : "none";
    if (!visible) {
      closeCard();
      closePanel();
    }
  }

  function showCard(now) {
    ensureRoot();
    state.timer.markPrompted();
    save(now);
    const t = state.timer;
    const act = (fn) => () => {
      fn();
      closeCard();
      save(Date.now());
    };
    const mins = Math.round(state.timer.thresholdMs / 60000);
    state.ui.card = el("div", { class: "lt-card", role: "alertdialog", "aria-label": "Need help?" },
      el("p", { class: "lt-card-text" }, "You've been working on this problem for a while. Do you need any assistance?"),
      el("div", { class: "lt-row" },
        el("button", { class: "lt-btn lt-primary", type: "button",
          onclick: act(() => { t.deferFullInterval(Date.now()); openPanel("hint"); }) }, "Get a Hint"),
        el("button", { class: "lt-btn", type: "button",
          onclick: act(() => { t.deferFullInterval(Date.now()); openPanel(); }) }, "Ask AI Tutor"),
        el("button", { class: "lt-btn", type: "button",
          onclick: act(() => t.deferFullInterval(Date.now())) }, "Continue Solving")),
      el("div", { class: "lt-row lt-links" },
        el("button", { class: "lt-link", type: "button", onclick: act(() => t.snooze(Date.now())) }, "Snooze 5 min"),
        el("button", { class: "lt-link", type: "button", onclick: act(() => t.dismiss()) }, "Don't remind me here")),
      el("p", { class: "lt-card-foot" }, `Reminder interval: ${mins} min of active time`));
    state.ui.root.prepend(state.ui.card);
  }

  function closeCard() {
    if (state.ui.card) state.ui.card.remove();
    state.ui.card = null;
  }

  function openPanel(autoMode) {
    if (!state.timer || state.chatOpen) return;
    closeCard();
    ensureRoot();
    state.chatOpen = true;
    // Asking for help counts as answering the reminder, so it won't re-fire when the chat closes.
    const now = Date.now();
    if (state.timer.elapsedMs(now) >= state.timer.dueAtMs()) state.timer.deferFullInterval(now);

    const log = el("div", { class: "lt-log", role: "log", "aria-live": "polite" });
    const input = el("input", {
      class: "lt-input", type: "text", maxlength: "1000", placeholder: "Ask a question...",
      "aria-label": "Message to AI Tutor",
      onkeydown: (e) => {
        if (e.key === "Enter" && !e.shiftKey) {
          e.preventDefault();
          sendTyped();
        }
      },
    });
    const send = el("button", { class: "lt-btn lt-primary", type: "button", onclick: sendTyped }, "Send");

    const hintBtn = el("button", { class: "lt-chip lt-chip-hint", type: "button", onclick: requestHint });
    const chips = [hintBtn];
    for (const a of ACTIONS) {
      const b = el("button", { class: "lt-chip" + (a.spoiler ? " lt-chip-spoiler" : ""), type: "button" }, a.label);
      b.addEventListener("click", () => {
        if (!a.spoiler || b.dataset.armed) return void runAction(a, b);
        b.dataset.armed = "1";
        b.textContent = "Reveal? Click again";
        setTimeout(() => { delete b.dataset.armed; b.textContent = a.label; }, 4000);
      });
      chips.push(b);
    }

    const panel = el("div", {
      class: "lt-panel", role: "dialog", "aria-label": "AI Tutor",
      onkeydown: (e) => e.key === "Escape" && closePanel(),
    },
      el("div", { class: "lt-header" },
        el("span", { class: "lt-title" }, "AI Tutor"),
        el("button", { class: "lt-x", type: "button", "aria-label": "Close", onclick: closePanel }, "×")),
      el("div", { class: "lt-chips" }, ...chips),
      log,
      el("div", { class: "lt-input-row" }, input, send));

    Object.assign(state.ui, { panel, log, input, controls: [...chips, send, input], hintBtn });
    state.ui.root.prepend(panel);
    updateHintLabel();

    if (state.history.length === 0) {
      addMessage("ai", "Hi! I'll guide you with hints first. Code is shown only if you explicitly ask for it. Use the buttons above or ask me anything.");
    } else {
      for (const m of state.history) addMessage(m.role === "user" ? "user" : "ai", m.text);
    }
    if (autoMode === "hint") requestHint();
    else input.focus();
  }

  function closePanel() {
    if (state.ui.panel) state.ui.panel.remove();
    Object.assign(state.ui, { panel: null, log: null, input: null, controls: [], hintBtn: null });
    state.chatOpen = false;
  }

  function updateHintLabel() {
    if (state.ui.hintBtn) state.ui.hintBtn.textContent = `Hint (${state.hintLevel}/${MAX_HINT_LEVEL})`;
  }

  function addMessage(kind, text) {
    if (!state.ui.log) return null;
    const node = el("div", { class: `lt-msg lt-${kind}` });
    if (kind === "ai") renderMarkdown(node, text);
    else node.textContent = text;
    state.ui.log.append(node);
    state.ui.log.scrollTop = state.ui.log.scrollHeight;
    return node;
  }

  function setBusy(busy) {
    state.busy = busy;
    for (const c of state.ui.controls) c.disabled = busy;
    if (!state.ui.log) return;
    const existing = state.ui.log.querySelector(".lt-typing");
    if (busy && !existing) {
      state.ui.log.append(el("div", { class: "lt-msg lt-ai lt-typing", "aria-label": "Thinking" },
        el("span"), el("span"), el("span")));
      state.ui.log.scrollTop = state.ui.log.scrollHeight;
    } else if (!busy && existing) existing.remove();
  }

  // ---------- Tutor requests ----------

  function requestHint() {
    run("hint", `Give me a level ${state.hintLevel} hint.`);
  }
  function runAction(a, btn) {
    if (btn) {
      delete btn.dataset.armed;
      btn.textContent = a.label;
    }
    run(a.mode, a.say);
  }
  function sendTyped() {
    const text = state.ui.input && state.ui.input.value.trim();
    if (!text || state.busy) return;
    state.ui.input.value = "";
    run("chat", text, text);
  }

  async function run(mode, label, message = "", isRetry = false) {
    if (state.busy || !state.ui.log) return;
    const problem = scrapeProblem();
    if (!isRetry) addMessage("user", label);
    if (!problem) {
      addMessage("error", "I couldn't read this problem from the page. Reload the page and try again.");
      return;
    }
    setBusy(true);
    const slug = state.slug;
    const editor = await getEditor();
    const level = state.hintLevel;

    chrome.runtime.sendMessage({
      type: "getHint",
      payload: {
        problem_title: problem.title,
        problem_description: problem.description,
        user_code: editor.code,
        language: editor.language,
        mode,
        hint_level: level,
        message,
        chat_history: state.history,
      },
    }, (res) => {
      if (state.slug !== slug) return; // user changed problem mid-request; discard
      setBusy(false);
      const failure = chrome.runtime.lastError
        ? "Connection to the extension was lost. Reload the page and try again."
        : !res ? "No response received. Please try again." : res.error;
      if (failure) {
        const box = addMessage("error", failure);
        if (box) box.append(el("button", { class: "lt-link", type: "button",
          onclick: () => { box.remove(); run(mode, label, message, true); } }, "Retry"));
        return;
      }
      state.history.push({ role: "user", text: label }, { role: "model", text: res.hint });
      if (mode === "hint") {
        state.hintsUsed += 1;
        state.hintLevel = Math.min(MAX_HINT_LEVEL, level + 1);
        updateHintLabel();
      }
      addMessage("ai", res.hint);
      save();
    });
  }

  // ---------- Messages from the popup ----------

  chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
    if (sender.id !== chrome.runtime.id) return false;
    const now = Date.now();
    if (msg.type === "settingsUpdated") {
      if (typeof msg.isEnabled === "boolean") state.settings.isEnabled = msg.isEnabled;
      if (msg.timerMinutes != null) {
        state.settings.timerMinutes = clampMinutes(msg.timerMinutes);
        if (state.timer) state.timer.setThreshold(thresholdMs());
      }
      updateLauncher();
      sendResponse({ ok: true });
    } else if (msg.type === "getStatus") {
      const t = state.timer;
      sendResponse({
        slug: state.slug,
        title: scrapeTitle(),
        enabled: state.settings.isEnabled,
        state: t ? t.state() : "loading",
        elapsedMs: t ? t.elapsedMs(now) : 0,
        remainingMs: t ? t.remainingMs(now) : 0,
        hintsUsed: state.hintsUsed,
      });
    } else if (msg.type === "resetTimer") {
      if (state.timer) {
        state.timer.reset(now);
        closeCard();
        save(now);
      }
      sendResponse({ ok: true });
    }
    return false;
  });

  // ---------- Boot ----------

  let tickHandle = null;
  chrome.storage.local.get(["isEnabled", "timerMinutes"], (res) => {
    state.settings.isEnabled = typeof res.isEnabled === "boolean" ? res.isEnabled : true;
    state.settings.timerMinutes = clampMinutes(res.timerMinutes ?? DEFAULT_MINUTES);
    pruneOldRecords();

    document.addEventListener("keydown", onEditorKeydown, true);
    document.addEventListener("visibilitychange", tick);
    window.addEventListener("focus", tick);
    window.addEventListener("blur", tick);
    window.addEventListener("pagehide", () => {
      if (state.timer) {
        state.timer.setActive(false, Date.now());
        save();
      }
    });
    tickHandle = setInterval(tick, TICK_MS);
    tick();
  });
})();
