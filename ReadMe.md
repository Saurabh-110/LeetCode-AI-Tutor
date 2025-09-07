How to Run the LeetCode AI Tutor Project
This guide provides the full instructions to set up and run both the backend Flask server and the frontend Chrome extension.

Prerequisites
Before you begin, make sure you have the following installed:

Python 3.x and pip (the Python package installer).

Google Chrome.

A Google Gemini API Key. You can get one from Google AI Studio.

Part 1: Running the Backend Server
The backend is a Python Flask server that handles the AI logic.

Navigate to the Backend Directory:
Open your terminal or command prompt and change into the backend directory.

cd path/to/your/project/backend

Create and Activate a Virtual Environment (Recommended):
This isolates the project's dependencies.

On macOS/Linux:

python3 -m venv venv
source venv/bin/activate

On Windows:

python -m venv venv
.\venv\Scripts\activate

Your terminal prompt should now be prefixed with (venv).

Install Required Python Packages:
Run the following command to install all the necessary packages from the requirements.txt file.

pip install -r requirements.txt

Add Your API Key:
Open the .env file inside the backend directory. Replace YOUR_API_KEY_HERE with your actual Google Gemini API key.

GEMINI_API_KEY="AIz...your...actual...key"

Start the Server:
Run the app.py script.

python app.py

Verify the Server is Running:
You should see output in your terminal indicating the server is running, similar to this:

 * Serving Flask app 'app'
 * Running on [http://127.0.0.1:5000](http://127.0.0.1:5000)
Press CTRL+C to quit

Keep this terminal window open. The server must be running for the extension to work.

Part 2: Loading the Frontend Chrome Extension
Now, you will load the unpacked extension into Google Chrome.

Open Chrome Extensions Page:
Open Google Chrome and navigate to chrome://extensions in the address bar.

Enable Developer Mode:
In the top-right corner of the Extensions page, find the "Developer mode" toggle and turn it ON.

Load the Extension:
Once Developer mode is on, a new menu with a button named "Load unpacked" will appear on the left. Click it.

Select the frontend Directory:
A file dialog will open. Navigate to your project folder and select the entire frontend directory. Do not select individual files. Click "Select Folder".

Verify the Extension is Loaded:
The "LeetCode AI Tutor" extension should now appear in your list of extensions. It's helpful to click the puzzle piece icon in your Chrome toolbar and "pin" the extension for easy access to the settings popup.

Part 3: How to Use
Navigate to any problem page on LeetCode (e.g., https://leetcode.com/problems/two-sum/).

Click inside the code editor and start typing.

The timer will begin. After the configured duration (default is 5 minutes, but it's set to 30 seconds initially in content.js for easy testing), the "Are you stuck?" modal will slide in from the top right.

Interact with the modal to get your first hint and start a conversation with your AI Tutor!