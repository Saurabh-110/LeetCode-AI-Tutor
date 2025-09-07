<div align="center"><b>LeetCode AI Tutor - Chrome Extension</b></div>
<p align="center">


An intelligent Chrome extension that acts as a personal AI tutor for users practicing on LeetCode. It proactively offers conceptual hints after a set time, provides a fully interactive chat UI for follow-up questions, and helps users develop problem-solving skills without giving away the solution.

✨ Features
💡 Proactive Assistance: A timer starts when you begin coding and offers help if you seem stuck.

⏱️ Configurable Timer: Easily set the help interval (1 to 30 minutes) from the extension's settings.

🎨 Non-Intrusive UI: The hint modal slides in from the top-right and does not block interaction with the LeetCode page.

🧠 Conceptual Hints: The AI is specifically prompted to act as a tutor, providing high-level guidance rather than ready-made code.

💬 Interactive Chat: Ask follow-up questions in a persistent chat interface to dive deeper into the problem.

💾 Persistent Settings: Your preferences are saved locally and persist across browser sessions using the chrome.storage API.

🔒 Secure by Design: API keys are loaded securely from a backend .env file and are never exposed on the frontend.

🛠️ Tech Stack & Architecture
This project uses a decoupled architecture with a lightweight frontend and a separate backend server to handle the AI logic securely.

Frontend (Chrome Extension):

HTML5, CSS3, JavaScript (ES6+)

Chrome Extension Manifest V3

Backend (AI Server):

Python 3 & Flask

Google Gemini API (gemini-1.5-flash-latest)

<details>
<summary><b>Click to see the Architecture Diagram and Data Flow</b></summary>

The communication flow is designed to be secure and efficient, following Chrome's Manifest V3 best practices:

UI & Timer (content.js): The content script, injected into the LeetCode page, monitors user activity and manages the timer and the UI modal.

Message Passing (content.js -> background.js): When a hint is requested, the content script sends a message with the problem data to the background service worker.

Secure API Call (background.js -> Flask Server): The service worker makes a fetch request to the local Flask server. It is the only part of the extension that communicates with the backend.

AI Processing (Flask Server -> Gemini API): The Flask server receives the request, constructs a detailed prompt, and securely calls the Google Gemini API.

Response Relay: The response is passed back through the same chain: Gemini -> Flask -> Background Script -> Content Script, where it is finally displayed to the user.

</details>

🚀 Getting Started
<details>
<summary><b>Click to see the setup and installation instructions</b></summary>

Prerequisites
Google Chrome

Python 3.8+ and pip

Git

A valid Google Gemini API Key. You can get one from Google AI Studio.

1. Backend Setup
First, set up the Python server that will power the AI.

# 1. Clone your repository
git clone <your-repo-url>
cd your-project-folder/backend

# 2. Create and activate a virtual environment
# On macOS/Linux:
python3 -m venv venv
source venv/bin/activate
# On Windows:
python -m venv venv
.\\venv\\Scripts\\activate

# 3. Install the required Python packages
pip install -r requirements.txt

# 4. Create the environment file
# Create a new file named .env in the 'backend' directory
# and add your Gemini API key to it:
GEMINI_API_KEY="YOUR_GEMINI_API_KEY_HERE"

# 5. Run the Flask server
flask run

Your backend is now running at http://127.0.0.1:5000. Keep this terminal window open.

2. Frontend Setup
Next, load the Chrome extension into your browser.

Open Google Chrome and navigate to chrome://extensions.

Enable "Developer mode" using the toggle switch in the top-right corner.

Click the "Load unpacked" button.

Select the frontend folder from your project directory.

The LeetCode AI Tutor extension should now appear in your list of extensions!

3. Usage
Navigate to any LeetCode problem page (e.g., https://leetcode.com/problems/two-sum/).

Start typing in the code editor. The timer will begin automatically.

After your configured time, the help modal will appear.

</details>
