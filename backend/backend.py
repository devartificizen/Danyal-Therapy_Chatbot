import os
import logging
import asyncio
from typing import List, Dict
from enum import Enum
from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from openai import AzureOpenAI
import google.generativeai as genai
from dotenv import load_dotenv
import uuid
from pydantic import BaseModel

# Setup logging and env
logging.basicConfig(level=logging.INFO)
logger = logging.getLogger(__name__)
load_dotenv()

# Initialize FastAPI
app = FastAPI()
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# AI Model Selection
class AIModel(str, Enum):
    GPT4 = "gpt4"
    GEMINI = "gemini"

# Initialize AI Clients
azure_client = AzureOpenAI(
    api_version="2024-08-01-preview",
    api_key=os.getenv("AZURE_OPENAI_API_KEY"),
    azure_endpoint="https://langrag.openai.azure.com/"
)

genai.configure(api_key=os.getenv("GOOGLE_API_KEY"))
gemini_model = genai.GenerativeModel('gemini-2.0-flash-exp')

SYSTEM_PROMPT = """You are an empathetic and professional therapist.
Your responses should be:
- Compassionate and understanding
- Non-judgmental and supportive
- Professional yet warm
- Using reflective listening
- Asking open-ended questions"""

# Pydantic Models
class StartRequest(BaseModel):
    model: AIModel

class UserMessage(BaseModel):
    client_id: str
    message: str  # Removed 'model' field

class AIResponse(BaseModel):
    response: str
    model: AIModel

class StartResponse(BaseModel):
    client_id: str
    model: AIModel

class ModelSwitch(BaseModel):
    client_id: str
    model: AIModel

# Connection Manager
class ConnectionManager:
    def __init__(self):
        self.chat_histories: Dict[str, List[Dict]] = {}
        self.gemini_chats: Dict[str, any] = {}
        self.client_models: Dict[str, AIModel] = {}

    def create_session(self, model: AIModel = AIModel.GPT4) -> tuple[str, AIModel]:
        client_id = str(uuid.uuid4())
        self.client_models[client_id] = model

        if model == AIModel.GEMINI:
            chat = gemini_model.start_chat(history=[])
            chat.send_message(SYSTEM_PROMPT)
            self.gemini_chats[client_id] = chat
            logger.info(f"Gemini session started for client_id: {client_id}")
        else:
            self.chat_histories[client_id] = [{"role": "system", "content": SYSTEM_PROMPT}]
            logger.info(f"GPT-4 session started for client_id: {client_id}")

        logger.info(f"Session {client_id} created with {model}")
        return client_id, model

    async def get_ai_response(self, client_id: str, message: str) -> tuple[str, AIModel]:
        model = self.client_models.get(client_id, AIModel.GPT4)
        logger.info(f"Received message from client {client_id} using model {model}: {message}")

        try:
            if model == AIModel.GEMINI:
                chat = self.gemini_chats.get(client_id)
                if not chat:
                    logger.error(f"No Gemini chat found for client_id: {client_id}")
                    raise HTTPException(status_code=400, detail="Invalid client_id for Gemini.")

                logger.info(f"Sending message to Gemini for client {client_id}: {message}")
                loop = asyncio.get_event_loop()
                response = await loop.run_in_executor(None, chat.send_message, message)
                logger.info(f"Received response from Gemini for client {client_id}: {response.text}")
                return response.text, model
            else:
                messages = self.get_history(client_id)
                messages.append({"role": "user", "content": message})
                logger.info(f"Sending message to GPT-4 for client {client_id}: {message}")
                completion = azure_client.chat.completions.create(
                    model="gpt-4",
                    messages=messages,
                    temperature=0.7,
                    max_tokens=150
                )
                response = completion.choices[0].message.content.strip()
                self.add_message(client_id, "assistant", response)
                logger.info(f"Received response from GPT-4 for client {client_id}: {response}")
                return response, model
        except Exception as e:
            logger.error(f"AI response error for client {client_id} using model {model}: {str(e)}")
            raise HTTPException(status_code=500, detail="Internal Server Error")

    def get_history(self, client_id: str) -> List[Dict]:
        return self.chat_histories.get(client_id, [{"role": "system", "content": SYSTEM_PROMPT}])

    def add_message(self, client_id: str, role: str, content: str):
        if client_id in self.chat_histories:
            self.chat_histories[client_id].append({"role": role, "content": content})
            logger.info(f"Added message to history for client {client_id}: [{role}] {content}")

    def switch_model(self, client_id: str, new_model: AIModel) -> AIModel:
        if client_id not in self.client_models:
            logger.error(f"Invalid client_id for model switch: {client_id}")
            raise HTTPException(status_code=400, detail="Invalid client_id")
        self.client_models[client_id] = new_model

        if new_model == AIModel.GEMINI:
            chat = gemini_model.start_chat(history=[])
            chat.send_message(SYSTEM_PROMPT)
            self.gemini_chats[client_id] = chat
            logger.info(f"Gemini session restarted for client_id: {client_id}")
            # Clear GPT-4 history if exists
            self.chat_histories.pop(client_id, None)
        else:
            self.chat_histories[client_id] = [{"role": "system", "content": SYSTEM_PROMPT}]
            logger.info(f"GPT-4 session restarted for client_id: {client_id}")
            # Clear Gemini chat if exists
            self.gemini_chats.pop(client_id, None)

        logger.info(f"Switched model for client {client_id} to {new_model}")
        return new_model

    def end_session(self, client_id: str):
        self.chat_histories.pop(client_id, None)
        self.gemini_chats.pop(client_id, None)
        self.client_models.pop(client_id, None)
        logger.info(f"Session {client_id} ended and data cleared.")

# Initialize manager
manager = ConnectionManager()

# Add the /ping endpoint here
@app.get("/ping")
async def ping():
    return {"status": "alive"}

# API Endpoints
@app.post("/start", response_model=StartResponse)
async def start_conversation(start_request: StartRequest):
    client_id, model = manager.create_session(start_request.model)
    logger.info(f"Conversation started for client_id: {client_id} with model: {model}")
    return StartResponse(client_id=client_id, model=model)

@app.post("/message", response_model=AIResponse)
async def get_message(user_message: UserMessage):
    try:
        response, model = await manager.get_ai_response(
            user_message.client_id,
            user_message.message.strip()
        )
        logger.info(f"Responding to client {user_message.client_id} using model {model}")
        return AIResponse(response=response, model=model)
    except HTTPException as http_exc:
        raise http_exc
    except Exception as e:
        logger.error(f"Message processing error: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal Server Error")

@app.post("/switch-model", response_model=AIResponse)
async def switch_model(switch: ModelSwitch):
    try:
        new_model = manager.switch_model(switch.client_id, switch.model)
        return AIResponse(
            response=f"Switched to {new_model.value} model",
            model=new_model
        )
    except HTTPException as http_exc:
        raise http_exc
    except Exception as e:
        logger.error(f"Model switch error: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal Server Error")

@app.delete("/end/{client_id}")
async def end_conversation(client_id: str):
    try:
        manager.end_session(client_id)
        logger.info(f"Conversation ended for client_id: {client_id}")
        return {"detail": "Conversation ended"}
    except Exception as e:
        logger.error(f"End conversation error for client_id {client_id}: {str(e)}")
        raise HTTPException(status_code=500, detail="Internal Server Error")