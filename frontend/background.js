/**
 * LeetCode AI Tutor - background service worker.
 * Relays tutor requests from the content script to the local backend. The API key lives only
 * on the backend; nothing secret is stored in the extension.
 */

const BACKEND_URL = "http://127.0.0.1:5000/get-hint";
const REQUEST_TIMEOUT_MS = 60 * 1000;

async function callBackend(payload) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(BACKEND_URL, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
      signal: controller.signal,
    });
    let data = null;
    try {
      data = await response.json();
    } catch (_) {
      /* non-JSON body */
    }
    if (!response.ok) {
      return { error: (data && data.error) || `Server returned status ${response.status}.` };
    }
    return data && data.hint ? { hint: data.hint } : { error: "The server sent an empty reply." };
  } catch (err) {
    if (err.name === "AbortError") return { error: "The request timed out. Please try again." };
    return {
      error: "Could not reach the backend. Make sure the Python server is running (see README).",
    };
  } finally {
    clearTimeout(timer);
  }
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Only accept messages from this extension's own content scripts.
  if (sender.id !== chrome.runtime.id || request.type !== "getHint") return false;
  callBackend(request.payload).then(sendResponse);
  return true; // keep the channel open for the async response
});
