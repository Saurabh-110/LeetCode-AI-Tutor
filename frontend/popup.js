/**
 * Popup: settings, live status of the current problem's timer, and saved problem history.
 */
(() => {
  "use strict";
  const { clampMinutes, DEFAULT_MINUTES } = window.LTTimer;
  const PRESETS = ["5", "10", "15", "20", "30"];
  const $ = (id) => document.getElementById(id);

  const toggle = $("enable-toggle");
  const select = $("timer-select");
  const customRow = $("custom-row");
  const customInput = $("custom-input");

  const fmt = (ms) => {
    const s = Math.max(0, Math.round(ms / 1000));
    const m = Math.floor(s / 60);
    return m >= 60 ? `${Math.floor(m / 60)}h ${m % 60}m` : `${m}m ${String(s % 60).padStart(2, "0")}s`;
  };

  // ----- settings -----

  function applyMinutesToUI(minutes) {
    const asText = String(minutes);
    if (PRESETS.includes(asText)) {
      select.value = asText;
      customRow.hidden = true;
    } else {
      select.value = "custom";
      customInput.value = asText;
      customRow.hidden = false;
    }
  }

  function broadcast(settings) {
    chrome.tabs.query({ url: "https://leetcode.com/problems/*" }, (tabs) => {
      for (const tab of tabs) {
        chrome.tabs.sendMessage(tab.id, { type: "settingsUpdated", ...settings }).catch(() => {});
      }
    });
  }

  function saveMinutes(value) {
    const timerMinutes = clampMinutes(value);
    chrome.storage.local.set({ timerMinutes });
    broadcast({ timerMinutes });
  }

  chrome.storage.local.get(["isEnabled", "timerMinutes"], (res) => {
    toggle.checked = typeof res.isEnabled === "boolean" ? res.isEnabled : true;
    applyMinutesToUI(clampMinutes(res.timerMinutes ?? DEFAULT_MINUTES));
  });

  toggle.addEventListener("change", () => {
    chrome.storage.local.set({ isEnabled: toggle.checked });
    broadcast({ isEnabled: toggle.checked });
  });

  select.addEventListener("change", () => {
    if (select.value === "custom") {
      customRow.hidden = false;
      customInput.focus();
      return;
    }
    customRow.hidden = true;
    saveMinutes(select.value);
  });

  customInput.addEventListener("change", () => {
    const minutes = clampMinutes(customInput.value);
    customInput.value = minutes;
    saveMinutes(minutes);
  });

  // ----- current problem status -----

  const STATE_TEXT = {
    waiting: "Timer starts when you begin typing in the editor.",
    running: "Timer running",
    paused: "Paused (tab or window not active)",
    off: "Reminders are off for this problem",
    loading: "Loading...",
  };

  function renderStatus(status) {
    const resetBtn = $("reset-btn");
    if (!status || !status.slug) {
      $("status-title").textContent = "Open a LeetCode problem";
      $("status-line").textContent = "";
      resetBtn.hidden = true;
      return;
    }
    $("status-title").textContent = status.title || status.slug;
    const parts = [STATE_TEXT[status.state] || ""];
    if (status.state === "running" || status.state === "paused") {
      parts.push(`Elapsed ${fmt(status.elapsedMs)}, next reminder in ${fmt(status.remainingMs)}`);
    }
    if (status.hintsUsed) parts.push(`Hints used: ${status.hintsUsed}`);
    $("status-line").textContent = parts.filter(Boolean).join(" · ");
    resetBtn.hidden = !status.enabled;
  }

  function withActiveProblemTab(fn) {
    chrome.tabs.query({ active: true, currentWindow: true, url: "https://leetcode.com/problems/*" }, (tabs) => {
      fn(tabs[0] || null);
    });
  }

  function pollStatus() {
    withActiveProblemTab((tab) => {
      if (!tab) return renderStatus(null);
      chrome.tabs.sendMessage(tab.id, { type: "getStatus" }, (status) => {
        void chrome.runtime.lastError; // content script not ready (e.g. page still loading)
        renderStatus(status);
      });
    });
  }

  $("reset-btn").addEventListener("click", () => {
    withActiveProblemTab((tab) => {
      if (tab) chrome.tabs.sendMessage(tab.id, { type: "resetTimer" }, pollStatus);
    });
  });

  // ----- history -----

  function renderHistory() {
    chrome.storage.local.get(null, (all) => {
      const items = Object.entries(all)
        .filter(([k]) => k.startsWith("p:"))
        .map(([, v]) => v)
        .sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0))
        .slice(0, 8);
      const list = $("history");
      list.replaceChildren();
      for (const p of items) {
        const link = document.createElement("a");
        link.href = p.url;
        link.target = "_blank";
        link.rel = "noopener";
        link.textContent = p.title;
        const meta = document.createElement("span");
        meta.className = "meta";
        meta.textContent = `${Math.round((p.timer?.elapsedMs || 0) / 60000)} min · ${p.hintsUsed || 0} hints`;
        const li = document.createElement("li");
        li.append(link, meta);
        list.append(li);
      }
      $("history-empty").hidden = items.length > 0;
      $("clear-btn").hidden = items.length === 0;
    });
  }

  $("clear-btn").addEventListener("click", () => {
    chrome.storage.local.get(null, (all) => {
      chrome.storage.local.remove(Object.keys(all).filter((k) => k.startsWith("p:")), renderHistory);
    });
  });

  pollStatus();
  renderHistory();
  setInterval(pollStatus, 1000);
})();
