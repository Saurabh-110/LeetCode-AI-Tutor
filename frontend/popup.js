document.addEventListener("DOMContentLoaded", () => {
  const enableToggle = document.getElementById("enable-toggle");
  const timerSelect = document.getElementById("timer-select");

  // Load saved settings from chrome.storage and update the UI
  chrome.storage.local.get(["isEnabled", "timerDuration"], (result) => {
    // Set a default value of true if isEnabled is not set
    enableToggle.checked =
      typeof result.isEnabled === "undefined" ? true : result.isEnabled;
    // Set a default value of 5 minutes if timerDuration is not set
    timerSelect.value = result.timerDuration || "5";
  });

  // Save settings when the toggle is changed
  enableToggle.addEventListener("change", () => {
    const isEnabled = enableToggle.checked;
    chrome.storage.local.set({ isEnabled: isEnabled });
  });

  // Save settings when the timer duration is changed
  timerSelect.addEventListener("change", () => {
    const timerDuration = timerSelect.value;
    chrome.storage.local.set({ timerDuration: timerDuration });
  });
});
