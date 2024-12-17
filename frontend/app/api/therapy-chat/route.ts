import { NextResponse } from 'next/server';
import axios from 'axios';

interface ChatResponse {
  text: string;
  audio?: string;
}

export async function POST(request: Request) {
  try {
    const formData = await request.formData();
    const message = formData.get('message');
    
    if (!message || typeof message !== 'string') {
      return NextResponse.json(
        { error: "Valid message is required" },
        { status: 400 }
      );
    }

    const response = await axios.post<ChatResponse>(
      'http://127.0.0.1:8000/chat',
      {
        message: message.trim(),
        audio: true
      },
      {
        headers: {
          'Content-Type': 'application/json',
        }
      }
    );

    if (!response.data.text) {
      throw new Error('Invalid response from AI service');
    }

    return NextResponse.json({
      text: response.data.text,
      audio: response.data.audio
    });

  } catch (error) {
    console.error('Error:', error);
    return NextResponse.json(
      { error: "AI service unavailable" },
      { status: 500 }
    );
  }
}