/**
 * LeetCode AI Tutor - Content Script
 */

// Global state variables
let hintModal = null;
let chatLog = null;
let messageInput = null;
let typingTimer = null;
let timerDuration = 5 * 60 * 1000; // Default 5 minutes
let isEnabled = true;
let chatHistory = [];

// --- Main Execution ---

chrome.storage.local.get(["isEnabled", "timerDuration"], (result) => {
  isEnabled = typeof result.isEnabled === "undefined" ? true : result.isEnabled;
  if (result.timerDuration) {
    timerDuration = parseInt(result.timerDuration, 10) * 60 * 1000;
  }

  // **FIXED**: The hardcoded testing timer is now commented out.
  // The timer duration selected in the popup will now be used.
  // To re-enable for testing, uncomment the line below.
  timerDuration = 20 * 1000;

  if (isEnabled) {
    initialize();
  }
});

function initialize() {
  const observer = new MutationObserver((mutations, obs) => {
    const editorContainer = document.querySelector(".monaco-editor");
    if (editorContainer) {
      console.log("LeetCode AI Tutor: Editor found, attaching listener.");
      editorContainer.addEventListener("keydown", handleFirstTyping);
      obs.disconnect();
    }
  });

  observer.observe(document.body, {
    childList: true,
    subtree: true,
  });
}

function handleFirstTyping() {
  console.log("LeetCode AI Tutor: First typing detected, starting timer.");
  startTimer();
  this.removeEventListener("keydown", handleFirstTyping);
}

function startTimer() {
  if (typingTimer) {
    clearTimeout(typingTimer);
  }
  typingTimer = setTimeout(() => {
    console.log("LeetCode AI Tutor: Timer expired, showing help modal.");
    showInitialPrompt();
  }, timerDuration);
}

// --- UI Creation and Management ---

function showInitialPrompt() {
  if (hintModal) return;

  hintModal = document.createElement("div");
  hintModal.id = "leet-tutor-modal";
  hintModal.innerHTML = `
        <div class="leet-tutor-content">
            <p>Are you stuck? Need a little help?</p>
            <div class="leet-tutor-button-group">
                <button id="leet-tutor-yes-btn">Yes, please!</button>
                <button id="leet-tutor-no-btn">No, I'm good</button>
            </div>
        </div>
    `;
  document.body.appendChild(hintModal);

  document
    .getElementById("leet-tutor-yes-btn")
    .addEventListener("click", transitionToChat);
  document
    .getElementById("leet-tutor-no-btn")
    .addEventListener("click", closeModal);
}

function transitionToChat() {
  chatHistory = [];
  // Use innerHTML on the modal itself to replace the entire content
  hintModal.innerHTML = `
        <div class="leet-tutor-chat-header">
            <span>AI Tutor</span>
            <button id="leet-tutor-close-btn">&times;</button>
        </div>
        <div id="leet-tutor-chat-log"></div>
        <div class="leet-tutor-input-area">
            <input type="text" id="leet-tutor-message-input" placeholder="Ask a follow-up question...">
            <button id="leet-tutor-send-btn">Send</button>
        </div>
    `;

  chatLog = document.getElementById("leet-tutor-chat-log");
  messageInput = document.getElementById("leet-tutor-message-input");

  document
    .getElementById("leet-tutor-close-btn")
    .addEventListener("click", closeModal);
  document
    .getElementById("leet-tutor-send-btn")
    .addEventListener("click", handleSendMessage);
  messageInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      handleSendMessage();
    }
  });

  fetchHint();
}

function closeModal() {
  if (hintModal) {
    hintModal.remove();
    hintModal = null;
  }
  // Re-initialize to listen for typing again
  initialize();
}

function displayMessage(message, sender) {
  const messageElement = document.createElement("div");
  messageElement.classList.add("leet-tutor-message", `${sender}-message`);
  // Use innerText to prevent HTML injection
  messageElement.innerText = message;
  chatLog.appendChild(messageElement);
  chatLog.scrollTop = chatLog.scrollHeight;
}

function toggleLoading(show) {
  let spinner = chatLog.querySelector(".leet-tutor-spinner");
  if (show) {
    if (!spinner) {
      spinner = document.createElement("div");
      spinner.classList.add(
        "leet-tutor-spinner",
        "leet-tutor-message",
        "ai-message"
      );
      spinner.innerHTML = "<div></div><div></div><div></div>";
      chatLog.appendChild(spinner);
      chatLog.scrollTop = chatLog.scrollHeight;
    }
  } else {
    if (spinner) {
      spinner.remove();
    }
  }
}

// --- Data Scraping and Communication ---

function scrapeProblemData() {
  const titleElement = document.querySelector('[data-cy="question-title"]');
  // This class name is fragile and may change if LeetCode updates its UI.
  const descriptionElement = document.querySelector(".elfjS");

  const title = titleElement
    ? titleElement.textContent.trim()
    : "Could not find problem title.";
  const description = descriptionElement
    ? descriptionElement.innerText
    : "Could not find problem description.";

  return { title, description };
}

function handleSendMessage() {
  const message = messageInput.value.trim();
  if (message) {
    displayMessage(message, "user");
    chatHistory.push({ role: "user", parts: [{ text: message }] });
    messageInput.value = "";
    fetchHint();
  }
}

function fetchHint() {
  toggleLoading(true);
  const problemData = scrapeProblemData();

  const payload = {
    problem_title: problemData.title,
    problem_description: problemData.description,
    chat_history: chatHistory,
  };

  chrome.runtime.sendMessage(
    { type: "getHint", payload: payload },
    (response) => {
      toggleLoading(false);
      if (response && response.error) {
        console.error("Error from backend:", response.error);
        displayMessage(`Error: ${response.error}`, "ai");
      } else if (response && response.hint) {
        const aiResponse = response.hint;
        displayMessage(aiResponse, "ai");
        chatHistory.push({ role: "model", parts: [{ text: aiResponse }] });
      } else {
        displayMessage("Sorry, an unexpected error occurred.", "ai");
      }
    }
  );
}
