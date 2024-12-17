# backend/test_gemini.py
import os
import google.generativeai as genai
from dotenv import load_dotenv

# Load environment variables
load_dotenv()

# Configure Gemini
GOOGLE_API_KEY = os.getenv('GOOGLE_API_KEY')
genai.configure(api_key=GOOGLE_API_KEY)

# Initialize Gemini
model = genai.GenerativeModel('gemini-2.0-flash-exp')

# Define therapist personality
system_prompt = """You are an empathetic and professional therapist. 
Your responses should be:
- Compassionate and understanding
- Non-judgmental
- Focused on active listening
- Professional but warm
- Encouraging but not dismissive
Never give medical advice or diagnoses."""

try:
    # Start conversation
    chat = model.start_chat(history=[])
    
    # Add system prompt
    response = chat.send_message(system_prompt)
    print("System configured:", response.text)
    
    # Test conversation
    user_message = "I've been feeling really anxious lately and I can't sleep."
    response = chat.send_message(user_message)
    print("\nUser:", user_message)
    print("Therapist:", response.text)
    
    # Follow-up question
    follow_up = "can you draw an iamge for me ?"
    response = chat.send_message(follow_up)
    print("\nUser:", follow_up)
    print("Therapist:", response.text)

except Exception as e:
    print(f"Error: {str(e)}")
    print("\nPlease ensure GOOGLE_API_KEY is set in your .env file")