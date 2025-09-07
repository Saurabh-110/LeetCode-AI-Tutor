/**
 * LeetCode AI Tutor - Background Service Worker
 * This script handles communication between the content script and the backend server.
 */

// Listen for messages from the content script
chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  // Check if the message is a request to get a hint
  if (request.type === "getHint") {
    // Use an immediately-invoked async function to handle the fetch request.
    // This is a robust pattern for Manifest V3 service workers to prevent them
    // from becoming inactive before the async operation completes.
    (async () => {
      const backendUrl = "http://127.0.0.1:5000/get-hint";
      try {
        const response = await fetch(backendUrl, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify(request.payload),
        });

        // If the server responds with an error status (e.g., 400, 500),
        // try to parse the JSON error message and throw an error.
        if (!response.ok) {
          let errorMsg = `Server returned status ${response.status}. Check backend logs.`;
          try {
            const errorData = await response.json();
            if (errorData && errorData.error) {
              errorMsg = errorData.error;
            }
          } catch (e) {
            // The error response was not valid JSON.
            console.error("Could not parse error response JSON.", e);
          }
          throw new Error(errorMsg);
        }

        // If the response is successful, parse the JSON and send it back.
        const data = await response.json();
        sendResponse(data);
      } catch (error) {
        // This block catches network errors (e.g., server not running)
        // or errors thrown from the !response.ok block above.
        console.error("Error in background script fetch:", error);

        let userFriendlyError = error.message;
        // Provide a more helpful message for the most common network failure.
        if (error instanceof TypeError && error.message === "Failed to fetch") {
          userFriendlyError =
            "Could not connect to the backend. Please ensure the Python server is running and try again.";
        }

        // Send a structured error object back to the content script.
        sendResponse({ error: userFriendlyError });
      }
    })();

    // Return true to indicate that the response will be sent asynchronously.
    // This is crucial to keep the message channel open.
    return true;
  }
});
