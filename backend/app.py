import os
from flask import Flask, request, jsonify
from flask_cors import CORS
import google.generativeai as genai
from dotenv import load_dotenv
import logging

# --- Initialization ---
load_dotenv()

app = Flask(__name__)
# Enable CORS for all domains on all routes
CORS(app)

# Configure logging
logging.basicConfig(level=logging.INFO, format='%(asctime)s - %(levelname)s - %(message)s')

# --- Gemini API Configuration ---
try:
    api_key = os.getenv("GEMINI_API_KEY")
    if not api_key or api_key == "YOUR_NEW_API_KEY_HERE":
        logging.error("GEMINI_API_KEY not found or is a placeholder in .env file.")
    else:
        genai.configure(api_key=api_key)
except Exception as e:
    logging.error(f"Error configuring Gemini API: {e}")

# --- API Endpoint ---
@app.route('/get-hint', methods=['POST'])
def get_hint():
    """
    Endpoint to get a conceptual hint for a LeetCode problem.
    """
    # 1. Check for API Key at the time of request
    if not api_key or api_key == "YOUR_NEW_API_KEY_HERE":
        logging.error("API call failed: GEMINI_API_KEY is not configured.")
        return jsonify({"error": "The server's API key is missing or invalid. Please check the backend configuration."}), 500

    # 2. Validate Request Data
    try:
        data = request.get_json()
        if not data:
            return jsonify({"error": "Invalid request: No JSON payload received."}), 400
        
        problem_title = data.get('problem_title')
        problem_description = data.get('problem_description')
        chat_history = data.get('chat_history', [])

        if not all([problem_title, problem_description]):
            return jsonify({"error": "Invalid request: 'problem_title' and 'problem_description' are required."}), 400

    except Exception as e:
        logging.error(f"Error parsing request JSON: {e}")
        return jsonify({"error": "Invalid request: Could not parse JSON payload."}), 400

    # 3. Construct the Prompt for Gemini
    try:
        system_instruction = (
            "You are an expert programming tutor specializing in LeetCode problems. "
            "Your goal is to guide the user towards the solution without giving it away. "
            "You must not provide any code snippets, complete functions, or direct implementation details. "
            "Focus on high-level concepts, data structures, algorithms, and thought processes."
        )
        
        model = genai.GenerativeModel(
            model_name='gemini-1.5-flash-latest',
            system_instruction=system_instruction
        )

        model_conversation = []
        model_conversation.append({
            "role": "user",
            "parts": [f"Here is the LeetCode problem I'm working on:\n\nTITLE: {problem_title}\n\nDESCRIPTION: {problem_description}"]
        })
        model_conversation.append({"role": "model", "parts": ["Understood. I'm ready to help you think through this problem. What's on your mind?"]})

        if chat_history:
            model_conversation.extend(chat_history)
        
        if not chat_history:
            final_prompt = "I'm feeling a bit stuck. Can you give me a high-level, conceptual first hint to get me started? Remember, please don't provide any code."
        else:
            # **FIXED**: Correctly access the 'text' field from the last user message.
            final_prompt = chat_history[-1]['parts'][0]['text']

        logging.info(f"Generating hint for: {problem_title}")
        
        chat = model.start_chat(history=model_conversation)
        response = chat.send_message(final_prompt)
        
        # 4. Return the Response
        return jsonify({"hint": response.text})

    except Exception as e:
        logging.error(f"An error occurred while generating a hint: {e}")
        error_message = str(e)
        if "API_KEY_INVALID" in error_message:
             return jsonify({"error": "The provided Gemini API Key is invalid."}), 500
        return jsonify({"error": f"An unexpected error occurred on the server: {error_message}"}), 500

# --- Main Execution ---
if __name__ == '__main__':
    app.run(host='0.0.0.0', port=5000, debug=True)

