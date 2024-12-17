'use client';

import { useState, useEffect, useRef } from 'react';
import { FaMicrophone, FaStop } from 'react-icons/fa';
import { IconContext } from 'react-icons';
import axios from 'axios';

interface Message {
  text: string;
  type: 'user' | 'assistant';
}

type ModelType = 'gpt4' | 'gemini';

const WaveAnimation = ({ isAI }: { isAI: boolean }) => {
  return (
    <div className="wave-animation">
      <div className={`wave ${isAI ? 'ai-wave' : 'user-wave'}`} style={{ '--i': 1 } as React.CSSProperties}></div>
      <div className={`wave ${isAI ? 'ai-wave' : 'user-wave'}`} style={{ '--i': 2 } as React.CSSProperties}></div>
      <div className={`wave ${isAI ? 'ai-wave' : 'user-wave'}`} style={{ '--i': 3 } as React.CSSProperties}></div>
    </div>
  );
};

export default function TherapistPage() {
  const [isConversationActive, setIsConversationActive] = useState(false);
  const [isConnected, setIsConnected] = useState(false);
  const [messages, setMessages] = useState<Message[]>([]);
  const [transcript, setTranscript] = useState('');
  const [isAISpeaking, setIsAISpeaking] = useState(false);
  const [clientId, setClientId] = useState<string>('');
  const [currentModel, setCurrentModel] = useState<ModelType>('gemini'); // Set Gemini as default

  const currentUtterance = useRef<SpeechSynthesisUtterance | null>(null);
  const recognitionRef = useRef<SpeechRecognition | null>(null);
  const audioContext = useRef<AudioContext | null>(null);
  const analyser = useRef<AnalyserNode | null>(null);

  const debugLog = (message: string, data?: any) => {
    console.log(`[Debug] ${message}`, data || '');
  };

  // Check backend connectivity on mount using /ping
  useEffect(() => {
    const checkBackend = async () => {
      try {
        await axios.get('http://127.0.0.1:8000/ping');
        setIsConnected(true);
        debugLog('Backend connected');
      } catch (error) {
        setIsConnected(false);
        debugLog('Backend connection failed');
      }
    };
    checkBackend();
  }, []);

  // Start a new conversation with selected model
  const handleStartConversation = async () => {
    if (isConversationActive) return;

    try {
      const permissionStatus = await navigator.permissions.query({ name: 'microphone' as PermissionName });

      if (permissionStatus.state === 'denied') {
        alert('Microphone access is denied. Please enable it in your browser settings.');
        return;
      }

      const response = await axios.post<{ client_id: string; model: ModelType }>('http://127.0.0.1:8000/start', {
        model: currentModel, // Ensure this reflects the selected model
      });
      setClientId(response.data.client_id);
      setIsConversationActive(true);
      setMessages([]);

      // Initialize audio context
      if (!audioContext.current) {
        audioContext.current = new AudioContext();
        analyser.current = audioContext.current.createAnalyser();
        analyser.current.fftSize = 256;
      }

      debugLog('Conversation started with model:', response.data.model);
    } catch (error) {
      console.error('Failed to start conversation:', error);
      alert('Failed to start conversation. Please try again.');
    }
  };

  // End the current conversation
  const handleEndConversation = async () => {
    if (!isConversationActive || !clientId) return;

    try {
      await axios.delete(`http://127.0.0.1:8000/end/${clientId}`);

      if (window.speechSynthesis.speaking) {
        window.speechSynthesis.cancel();
      }

      if (currentUtterance.current) {
        currentUtterance.current.onend = null;
        currentUtterance.current.onerror = null;
        currentUtterance.current = null;
      }

      if (recognitionRef.current) {
        recognitionRef.current.stop();
        recognitionRef.current = null;
      }

      if (audioContext.current) {
        await audioContext.current.close();
        audioContext.current = null;
        analyser.current = null;
      }

      setIsConversationActive(false);
      setClientId('');
      setMessages([]);
      setTranscript('');
      setIsAISpeaking(false); // Ensure AI speaking state is reset
      debugLog('Conversation ended');
    } catch (error) {
      console.error('Failed to end conversation:', error);
      alert('Failed to end conversation. Please try again.');
    }
  };

  // Send a message to the backend
  const sendMessage = async (message: string) => {
    if (!clientId || !isConversationActive) return;

    try {
      const response = await axios.post<{ response: string; model: ModelType }>('http://127.0.0.1:8000/message', {
        client_id: clientId,
        message: message,
        // Removed 'model' parameter
      });

      setMessages((prev) => [
        ...prev,
        { text: message, type: 'user' },
        { text: response.data.response, type: 'assistant' },
      ]);

      // Handle speech synthesis
      if ('speechSynthesis' in window) {
        const utterance = new SpeechSynthesisUtterance(response.data.response);
        currentUtterance.current = utterance;

        utterance.onstart = () => setIsAISpeaking(true);
        utterance.onend = () => {
          setIsAISpeaking(false);
          currentUtterance.current = null;
        };
        utterance.onerror = () => {
          setIsAISpeaking(false);
          currentUtterance.current = null;
        };

        window.speechSynthesis.speak(utterance);
      }
    } catch (error) {
      console.error('Failed to send message:', error);
      alert('Failed to send message. Please try again.');
    }
  };

  // Speech Recognition Setup
  useEffect(() => {
    if (!isConversationActive) return;

    const SpeechRecognitionAPI = (window as any).SpeechRecognition || (window as any).webkitSpeechRecognition;
    if (!SpeechRecognitionAPI) {
      console.error('Speech recognition not supported');
      return;
    }

    const recognition = new SpeechRecognitionAPI();
    recognition.continuous = true;
    recognition.interimResults = true;
    recognition.lang = 'en-US';

    recognition.onresult = (event: SpeechRecognitionEvent) => {
      const transcript = Array.from(event.results)
        .map((result) => result[0].transcript)
        .join('')
        .trim();

      if (transcript && isConversationActive) {
        setTranscript(transcript);

        if (window.speechSynthesis.speaking) {
          window.speechSynthesis.cancel();
          setIsAISpeaking(false);
        }

        if (event.results[event.results.length - 1].isFinal) {
          sendMessage(transcript);
          setTranscript('');
        }
      }
    };

    recognition.onaudiostart = () => {
      if (window.speechSynthesis.speaking) {
        window.speechSynthesis.cancel();
        setIsAISpeaking(false);
      }
    };

    recognition.onend = () => {
      if (isConversationActive && recognitionRef.current) {
        recognition.start();
      }
    };

    recognition.start();
    recognitionRef.current = recognition;

    return () => {
      recognition.stop();
      recognitionRef.current = null;
    };
  }, [isConversationActive]);

  // Debugging: Log current model whenever it changes
  useEffect(() => {
    debugLog('Current Model:', currentModel);
  }, [currentModel]);

  return (
    <IconContext.Provider value={{ size: '1.5em' }}>
      <div className="relative min-h-screen bg-gradient-to-b from-blue-50 to-white">
        {/* Model Selection & Start Conversation */}
        {!isConversationActive && (
          <div className="flex flex-col items-center space-y-4 mb-8 p-8">
            <h1 className="text-4xl font-bold text-center mb-4 text-purple-600">AI Therapist</h1>

            {/* Model Selection */}
            <div className="flex flex-col items-center space-y-2">
              <label className="text-gray-700 font-medium mb-2">Select AI Model:</label>
              <div className="flex space-x-4">
                <label className="flex items-center space-x-2">
                  <input
                    type="radio"
                    name="model"
                    value="gpt4"
                    checked={currentModel === 'gpt4'}
                    onChange={() => setCurrentModel('gpt4')}
                    className="form-radio h-4 w-4 text-purple-600"
                  />
                  <span className="text-gray-700">GPT-4</span>
                </label>
                <label className="flex items-center space-x-2">
                  <input
                    type="radio"
                    name="model"
                    value="gemini"
                    checked={currentModel === 'gemini'}
                    onChange={() => setCurrentModel('gemini')}
                    className="form-radio h-4 w-4 text-green-600"
                  />
                  <span className="text-gray-700">Gemini</span>
                </label>
              </div>
            </div>

            {/* Start Conversation Button */}
            <button
              onClick={handleStartConversation}
              disabled={!isConnected}
              className={`flex items-center space-x-2 px-6 py-3 rounded-full text-white transition-all ${
                isConnected ? 'bg-green-500 hover:bg-green-600' : 'bg-gray-300 cursor-not-allowed'
              }`}
              aria-label="Start Conversation"
            >
              <FaMicrophone className="mr-2" />
              <span>Start Conversation</span>
            </button>

            {/* Connection Status */}
            <div className="flex space-x-4 text-sm">
              <span className="text-gray-500">{isConnected ? 'Connected to Backend' : 'Connecting...'}</span>
            </div>
          </div>
        )}

        {/* Active Conversation Controls */}
        {isConversationActive && (
          <div className="fixed bottom-8 right-8 z-30 flex space-x-4">
            {/* End Conversation Button */}
            <button
              onClick={handleEndConversation}
              className="flex items-center space-x-2 px-6 py-3 rounded-full text-white bg-red-500 hover:bg-red-600 transition-all"
              aria-label="End Conversation"
            >
              <FaStop className="mr-2" />
              <span>End Conversation</span>
            </button>
          </div>
        )}

        {/* Main Content */}
        <main
          className={`min-h-screen bg-gradient-to-b from-blue-50 to-white p-8 transition-filter duration-500 ${
            isConversationActive ? 'custom-blur-sm' : ''
          }`}
        >
          {isConversationActive && (
            <div className="max-w-4xl mx-auto relative z-10">
              <div className="space-y-4 mb-8">
                {transcript && (
                  <div className="mb-4 p-4 bg-gray-100 rounded-lg animate-pulse">
                    <p className="text-gray-600 italic">{transcript}</p>
                  </div>
                )}

                <div className="space-y-4">
                  {messages.map((msg, idx) => (
                    <div
                      key={idx}
                      className={`p-4 rounded-lg shadow-lg transition-transform duration-300 ${
                        msg.type === 'user'
                          ? 'bg-blue-50 ml-12 transform hover:scale-105 text-gray-700'
                          : 'bg-white mr-12 transform hover:scale-105 text-gray-700'
                      }`}
                    >
                      <strong className="text-gray-700">{msg.type === 'user' ? 'You:' : 'Therapist:'}</strong>
                      <p className="mt-1 text-gray-600">{msg.text}</p>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}
        </main>

        {/* Wave Animation Overlay */}
        {isConversationActive && (
          <div className="absolute inset-0 bg-transparent flex items-center justify-center pointer-events-none">
            <WaveAnimation isAI={isAISpeaking} />
          </div>
        )}
      </div>
    </IconContext.Provider>
  );
}