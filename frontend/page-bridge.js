/**
 * Runs in the PAGE's JS world (manifest "world": "MAIN") so it can read the Monaco editor model.
 * Content scripts live in an isolated world and cannot see window.monaco, and scraping the DOM
 * only yields the visible (virtualised) lines. Talks to content.js via window.postMessage.
 */
(function () {
  window.addEventListener("message", (event) => {
    const msg = event.data;
    if (event.source !== window || !msg || msg.source !== "lt-content" || msg.type !== "getCode") {
      return;
    }
    let code = "";
    let language = "";
    try {
      const models = (window.monaco && window.monaco.editor && window.monaco.editor.getModels()) || [];
      const model = models.find((m) => m.getLanguageId() !== "plaintext") || models[0];
      if (model) {
        code = model.getValue();
        language = model.getLanguageId();
      }
    } catch (_) {
      /* fall through with empty values; content.js has a DOM fallback */
    }
    window.postMessage({ source: "lt-page", type: "code", id: msg.id, code, language }, "*");
  });
})();
