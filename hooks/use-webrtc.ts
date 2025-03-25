"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import { v4 as uuidv4 } from "uuid";
import { Conversation } from "@/lib/conversations";
import { useTranslations } from "@/components/translations-context";

export interface Tool {
  name: string;
  description: string;
  parameters?: Record<string, any>;
}

/**
 * The return type for the hook, matching Approach A
 * (RefObject<HTMLDivElement | null> for the audioIndicatorRef).
 */
interface UseWebRTCAudioSessionReturn {
  status: string;
  isSessionActive: boolean;
  isMicMuted: boolean;
  audioIndicatorRef: React.RefObject<HTMLDivElement | null>;
  startSession: () => Promise<void>;
  stopSession: () => void;
  handleStartStopClick: () => void;
  toggleMic: () => void;
  registerFunction: (name: string, fn: Function) => void;
  msgs: any[];
  currentVolume: number;
  conversation: Conversation[];
  sendTextMessage: (text: string) => void;
}

/**
 * Hook to manage a real-time session with OpenAI's Realtime endpoints.
 */
export default function useWebRTCAudioSession(
  voice: string,
  tools?: Tool[],
): UseWebRTCAudioSessionReturn {
  const { t, locale } = useTranslations();
  // Connection/session states
  const [status, setStatus] = useState("");
  const [isSessionActive, setIsSessionActive] = useState(false);
  const [isMicMuted, setIsMicMuted] = useState(false);

  // Audio references for local mic
  // Approach A: explicitly typed as HTMLDivElement | null
  const audioIndicatorRef = useRef<HTMLDivElement | null>(null);
  const audioContextRef = useRef<AudioContext | null>(null);
  const audioStreamRef = useRef<MediaStream | null>(null);

  // WebRTC references
  const peerConnectionRef = useRef<RTCPeerConnection | null>(null);
  const dataChannelRef = useRef<RTCDataChannel | null>(null);
  const mediaRecorderRef = useRef<MediaRecorder | null>(null);

  // Keep track of all raw events/messages
  const [msgs, setMsgs] = useState<any[]>([]);

  // Main conversation state
  const [conversation, setConversation] = useState<Conversation[]>([]);

  // For function calls (AI "tools")
  const functionRegistry = useRef<Record<string, Function>>({});

  // Volume analysis (assistant inbound audio)
  const [currentVolume, setCurrentVolume] = useState(0);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const volumeIntervalRef = useRef<number | null>(null);
  const timeoutRef = useRef<number | null>(null);

  /**
   * We track only the ephemeral user message **ID** here.
   * While user is speaking, we update that conversation item by ID.
   */
  const ephemeralUserMessageIdRef = useRef<string | null>(null);

  /**
   * Register a function (tool) so the AI can call it.
   */
  function registerFunction(name: string, fn: Function) {
    functionRegistry.current[name] = fn;
  }

  /**
   * Configure the data channel on open, sending a session update to the server.
   */
  function configureDataChannel(dataChannel: RTCDataChannel) {
    // Send session update
    const sessionUpdate = {
      type: "session.update",
      session: {
        modalities: ["text", "audio"],
        tools: tools || [],
        input_audio_transcription: {
          model: "whisper-1", // Use OpenAI's model name for the realtime API
        },
      },
    };
    dataChannel.send(JSON.stringify(sessionUpdate));

    console.log("Session update sent:", sessionUpdate);
    console.log("Setting locale: " + t("language") + " : " + locale);

    // Send language preference message
    const languageMessage = {
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: t("languagePrompt"),
          },
        ],
      },
    };
    dataChannel.send(JSON.stringify(languageMessage));
  }

  /**
   * Return an ephemeral user ID, creating a new ephemeral message in conversation if needed.
   */
  function getOrCreateEphemeralUserId(): string {
    let ephemeralId = ephemeralUserMessageIdRef.current;
    if (!ephemeralId) {
      // Use uuidv4 for a robust unique ID
      ephemeralId = uuidv4();
      ephemeralUserMessageIdRef.current = ephemeralId;

      const newMessage: Conversation = {
        id: ephemeralId,
        role: "user",
        text: "",
        timestamp: new Date().toISOString(),
        isFinal: false,
        status: "speaking",
      };

      // Append the ephemeral item to conversation
      setConversation((prev) => [...prev, newMessage]);
    }
    return ephemeralId;
  }

  /**
   * Update the ephemeral user message (by ephemeralUserMessageIdRef) with partial changes.
   */
  function updateEphemeralUserMessage(partial: Partial<Conversation>) {
    const ephemeralId = ephemeralUserMessageIdRef.current;
    if (!ephemeralId) return; // no ephemeral user message to update

    setConversation((prev) =>
      prev.map((msg) => {
        if (msg.id === ephemeralId) {
          return { ...msg, ...partial };
        }
        return msg;
      }),
    );
  }

  /**
   * Clear ephemeral user message ID so the next user speech starts fresh.
   */
  function clearEphemeralUserMessage() {
    ephemeralUserMessageIdRef.current = null;
  }

  /**
   * Function to transcribe audio using Groq API
   * This is our main transcription function
   */
  async function transcribeAudioWithGroq(audioBlob: Blob): Promise<string> {
    try {
      console.log(`📣 Transcribing with Groq: ${audioBlob.size} bytes, type: ${audioBlob.type}`);
      
      // Make sure we have a valid audio blob
      if (audioBlob.size === 0) {
        console.error("Empty audio blob, cannot transcribe");
        return "No speech detected";
      }
      
      // Create form data for the API request
      const formData = new FormData();
      
      // Use an appropriate filename with extension matching the MIME type
      let filename = "audio.webm";
      if (audioBlob.type.includes("mp4")) {
        filename = "audio.mp4";
      } else if (audioBlob.type.includes("mp3")) {
        filename = "audio.mp3";
      } else if (audioBlob.type.includes("wav")) {
        filename = "audio.wav";
      }
      
      formData.append("audio", audioBlob, filename);
      console.log(`Sending audio to Groq API as ${filename}`);

      // Post to our Next.js API route
      const response = await fetch("/api/transcribe-audio", {
        method: "POST",
        body: formData,
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error(`🔴 Groq transcription error (${response.status}):`, errorText);
        throw new Error(`Failed to transcribe audio: ${response.status} - ${errorText}`);
      }

      const data = await response.json();
      console.log("✅ Groq transcription success:", data);
      
      if (!data.text) {
        console.warn("Groq returned empty transcription");
        return "No speech detected";
      }
      
      return data.text;
    } catch (error) {
      console.error("🔴 Error transcribing with Groq:", error);
      
      // If this is during development, log a reminder about the API key
      if (process.env.NODE_ENV === 'development') {
        console.log("Remember to check that GROQ_API_KEY is set in your .env file");
      }
      
      return "Transcription failed. Please try again.";
    }
  }

  // Audio chunks storage for local transcription
  const audioChunksRef = useRef<Blob[]>([]);
  
  /**
   * Main data channel message handler: interprets events from the server.
   */
  async function handleDataChannelMessage(event: MessageEvent) {
    try {
      const msg = JSON.parse(event.data);
      // console.log("Incoming dataChannel message:", msg);

      switch (msg.type) {
        /**
         * User speech started
         */
        case "input_audio_buffer.speech_started": {
          getOrCreateEphemeralUserId();
          updateEphemeralUserMessage({ 
            status: "speaking",
            text: "Listening..." 
          });
          // Clear audio chunks when speech starts
          audioChunksRef.current = [];
          console.log("User started speaking, recording audio...");
          break;
        }

        /**
         * User speech stopped - ideal time to start transcription
         */
        case "input_audio_buffer.speech_stopped": {
          updateEphemeralUserMessage({ 
            status: "processing",
            text: "Processing speech..." 
          });
          
          // Force the mediaRecorder to capture whatever it has buffered
          if (mediaRecorderRef.current && mediaRecorderRef.current.state === "recording") {
            // Request immediate data without stopping
            mediaRecorderRef.current.requestData();
            
            // Small delay to ensure we get the latest data
            setTimeout(async () => {
              if (audioChunksRef.current.length > 0) {
                // Create a single audio blob from all chunks
                const mimeType = mediaRecorderRef.current?.mimeType || 'audio/webm';
                console.log(`Creating audio blob with type: ${mimeType} from ${audioChunksRef.current.length} chunks`);
                
                // Try to create the blob with a more compatible MIME type
                let audioBlob;
                
                // If we're using webm, try to specify the codec explicitly
                if (mimeType === 'audio/webm') {
                  audioBlob = new Blob(audioChunksRef.current, { type: 'audio/webm;codecs=opus' });
                } else {
                  audioBlob = new Blob(audioChunksRef.current, { type: mimeType });
                }
                
                // Transcribe with Groq
                const transcript = await transcribeAudioWithGroq(audioBlob);
                
                // Update the message with Groq's transcription
                updateEphemeralUserMessage({
                  text: transcript,
                  isFinal: true,
                  status: "final",
                });
                
                // Clear for next speech
                clearEphemeralUserMessage();
                audioChunksRef.current = [];
                
                // Send the transcribed message to LLM through data channel
                if (dataChannelRef.current && dataChannelRef.current.readyState === "open") {
                  const message = {
                    type: "conversation.item.create",
                    item: {
                      type: "message",
                      role: "user",
                      content: [
                        {
                          type: "input_text",
                          text: transcript,
                        },
                      ],
                    },
                  };
                  
                  dataChannelRef.current.send(JSON.stringify(message));
                  
                  // Request a response
                  const responseCreate = {
                    type: "response.create",
                  };
                  dataChannelRef.current.send(JSON.stringify(responseCreate));
                }
              }
            }, 300); // Short delay to collect final audio
          }
          
          break;
        }

        /**
         * Audio buffer committed
         * We don't need to handle this as we're already transcribing in speech_stopped
         */
        case "input_audio_buffer.committed": {
          // Just log that we received the event, but we're not using it
          console.log("Audio buffer committed event received, using speech_stopped for transcription instead");
          break;
        }

        /**
         * Partial user transcription (from OpenAI) - we're not using this since we use Groq
         */
        case "conversation.item.input_audio_transcription": {
          // We're using Groq for transcription now, so just log this
          console.log("Received OpenAI partial transcription, but we're using Groq instead");
          break;
        }

        /**
         * Final user transcription (from OpenAI) - we're not using this since we use Groq
         */
        case "conversation.item.input_audio_transcription.completed": {
          // We're using Groq for transcription now, so we don't need to handle this OpenAI event
          console.log("Received OpenAI transcription, but we're using Groq instead");
          
          // Don't clear the Groq timeout, we're intentionally using Groq
          
          break;
        }

        /**
         * Streaming AI transcripts (assistant partial)
         */
        case "response.audio_transcript.delta": {
          const newMessage: Conversation = {
            id: uuidv4(), // generate a fresh ID for each assistant partial
            role: "assistant",
            text: msg.delta,
            timestamp: new Date().toISOString(),
            isFinal: false,
          };

          setConversation((prev) => {
            const lastMsg = prev[prev.length - 1];
            if (lastMsg && lastMsg.role === "assistant" && !lastMsg.isFinal) {
              // Append to existing assistant partial
              const updated = [...prev];
              updated[updated.length - 1] = {
                ...lastMsg,
                text: lastMsg.text + msg.delta,
              };
              return updated;
            } else {
              // Start a new assistant partial
              return [...prev, newMessage];
            }
          });
          break;
        }

        /**
         * Mark the last assistant message as final
         */
        case "response.audio_transcript.done": {
          setConversation((prev) => {
            if (prev.length === 0) return prev;
            const updated = [...prev];
            updated[updated.length - 1].isFinal = true;
            return updated;
          });
          break;
        }

        /**
         * AI calls a function (tool)
         */
        case "response.function_call_arguments.done": {
          const fn = functionRegistry.current[msg.name];
          if (fn) {
            const args = JSON.parse(msg.arguments);
            const result = await fn(args);

            // Respond with function output
            const response = {
              type: "conversation.item.create",
              item: {
                type: "function_call_output",
                call_id: msg.call_id,
                output: JSON.stringify(result),
              },
            };
            dataChannelRef.current?.send(JSON.stringify(response));

            const responseCreate = {
              type: "response.create",
            };
            dataChannelRef.current?.send(JSON.stringify(responseCreate));
          }
          break;
        }

        default: {
          // console.warn("Unhandled message type:", msg.type);
          break;
        }
      }

      // Always log the raw message
      setMsgs((prevMsgs) => [...prevMsgs, msg]);
      return msg;
    } catch (error) {
      console.error("Error handling data channel message:", error);
    }
  }

  /**
   * Fetch ephemeral token from your Next.js endpoint
   */
  async function getEphemeralToken() {
    try {
      const response = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!response.ok) {
        throw new Error(`Failed to get ephemeral token: ${response.status}`);
      }
      const data = await response.json();
      return data.client_secret.value;
    } catch (err) {
      console.error("getEphemeralToken error:", err);
      throw err;
    }
  }

  /**
   * Sets up a local audio visualization for mic input (toggle wave CSS).
   */
  function setupAudioVisualization(stream: MediaStream) {
    const audioContext = new AudioContext();
    const source = audioContext.createMediaStreamSource(stream);
    const analyzer = audioContext.createAnalyser();
    analyzer.fftSize = 256;
    source.connect(analyzer);

    const bufferLength = analyzer.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);

    const updateIndicator = () => {
      if (!audioContext) return;
      analyzer.getByteFrequencyData(dataArray);
      const average = dataArray.reduce((a, b) => a + b) / bufferLength;

      // Toggle an "active" class if volume is above a threshold
      if (audioIndicatorRef.current) {
        audioIndicatorRef.current.classList.toggle("active", average > 30);
      }
      requestAnimationFrame(updateIndicator);
    };
    updateIndicator();

    audioContextRef.current = audioContext;
  }

  /**
   * Calculate RMS volume from inbound assistant audio
   */
  function getVolume(): number {
    if (!analyserRef.current) return 0;
    const dataArray = new Uint8Array(analyserRef.current.frequencyBinCount);
    analyserRef.current.getByteTimeDomainData(dataArray);

    let sum = 0;
    for (let i = 0; i < dataArray.length; i++) {
      const float = (dataArray[i] - 128) / 128;
      sum += float * float;
    }
    return Math.sqrt(sum / dataArray.length);
  }

  /**
   * Start a new session:
   */
  async function startSession() {
    try {
      setStatus("Requesting microphone access...");
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      audioStreamRef.current = stream;
      setupAudioVisualization(stream);

      setStatus("Fetching ephemeral token...");
      const ephemeralToken = await getEphemeralToken();

      setStatus("Establishing connection...");
      const pc = new RTCPeerConnection();
      peerConnectionRef.current = pc;

      // Hidden <audio> element for inbound assistant TTS
      const audioEl = document.createElement("audio");
      audioEl.autoplay = true;

      // Inbound track => assistant's TTS
      pc.ontrack = (event) => {
        audioEl.srcObject = event.streams[0];

        // Optional: measure inbound volume
        const audioCtx = new (window.AudioContext || window.AudioContext)();
        const src = audioCtx.createMediaStreamSource(event.streams[0]);
        const inboundAnalyzer = audioCtx.createAnalyser();
        inboundAnalyzer.fftSize = 256;
        src.connect(inboundAnalyzer);
        analyserRef.current = inboundAnalyzer;

        // Start volume monitoring
        volumeIntervalRef.current = window.setInterval(() => {
          setCurrentVolume(getVolume());
        }, 100);
      };

      // Data channel for transcripts
      const dataChannel = pc.createDataChannel("response");
      dataChannelRef.current = dataChannel;

      dataChannel.onopen = () => {
        // console.log("Data channel open");
        configureDataChannel(dataChannel);
      };
      dataChannel.onmessage = handleDataChannelMessage;

      // Set up audio recording for Groq transcription
      // Find the most compatible format for Groq API
      const mimeTypeOptions = [
        'audio/mp3',
        'audio/mp4',
        'audio/wav',
        'audio/webm;codecs=opus',
        'audio/webm'
      ];
      
      let selectedMimeType = 'audio/webm';
      for (const mimeType of mimeTypeOptions) {
        if (MediaRecorder.isTypeSupported(mimeType)) {
          selectedMimeType = mimeType;
          break;
        }
      }
      
      console.log("Using MIME type for recording:", selectedMimeType);
      
      const mediaRecorder = new MediaRecorder(stream, { 
        mimeType: selectedMimeType,
        audioBitsPerSecond: 128000 // 128 kbps for good quality/size balance
      });
      
      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          console.log("Audio data received, size:", event.data.size);
          audioChunksRef.current.push(event.data);
        }
      };
      
      // Handle errors
      mediaRecorder.onerror = (event) => {
        console.error("MediaRecorder error:", event);
      };
      
      // Store the MediaRecorder for later use
      mediaRecorderRef.current = mediaRecorder;
      
      // Start recording - collect smaller chunks for better quality
      mediaRecorder.start(500); // Collect data every 500ms
      
      // Add local (mic) track
      pc.addTrack(stream.getTracks()[0]);

      // Create offer & set local description
      const offer = await pc.createOffer();
      await pc.setLocalDescription(offer);

      // Send SDP offer to OpenAI Realtime
      const baseUrl = "https://api.openai.com/v1/realtime";
      const model = "gpt-4o-realtime-preview-2024-12-17";
      const response = await fetch(`${baseUrl}?model=${model}&voice=${voice}`, {
        method: "POST",
        body: offer.sdp,
        headers: {
          Authorization: `Bearer ${ephemeralToken}`,
          "Content-Type": "application/sdp",
        },
      });

      // Set remote description
      const answerSdp = await response.text();
      await pc.setRemoteDescription({ type: "answer", sdp: answerSdp });

      setIsSessionActive(true);
      setStatus("Session established successfully!");
    } catch (err) {
      console.error("startSession error:", err);
      setStatus(`Error: ${err}`);
      stopSession();
    }
  }

  /**
   * Stop the session & cleanup
   */
  function stopSession() {
    if (dataChannelRef.current) {
      dataChannelRef.current.close();
      dataChannelRef.current = null;
    }
    if (peerConnectionRef.current) {
      peerConnectionRef.current.close();
      peerConnectionRef.current = null;
    }
    if (audioContextRef.current) {
      audioContextRef.current.close();
      audioContextRef.current = null;
    }
    if (audioStreamRef.current) {
      audioStreamRef.current.getTracks().forEach((track) => track.stop());
      audioStreamRef.current = null;
    }
    if (audioIndicatorRef.current) {
      audioIndicatorRef.current.classList.remove("active");
    }
    if (volumeIntervalRef.current) {
      clearInterval(volumeIntervalRef.current);
      volumeIntervalRef.current = null;
    }
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
      timeoutRef.current = null;
    }
    if (mediaRecorderRef.current) {
      if (mediaRecorderRef.current.state !== 'inactive') {
        mediaRecorderRef.current.stop();
      }
      mediaRecorderRef.current = null;
    }
    analyserRef.current = null;
    
    // Clear collected audio chunks
    audioChunksRef.current = [];
    ephemeralUserMessageIdRef.current = null;

    setCurrentVolume(0);
    setIsSessionActive(false);
    setStatus("Session stopped");
    setMsgs([]);
    setConversation([]);
  }

  /**
   * Toggle start/stop from a single button
   */
  function handleStartStopClick() {
    if (isSessionActive) {
      stopSession();
    } else {
      startSession();
    }
  }

  /**
   * Send a text message through the data channel
   */
  function sendTextMessage(text: string) {
    if (!dataChannelRef.current || dataChannelRef.current.readyState !== "open") {
      console.error("Data channel not ready");
      return;
    }

    const messageId = uuidv4();
    
    // Add message to conversation immediately
    const newMessage: Conversation = {
      id: messageId,
      role: "user",
      text,
      timestamp: new Date().toISOString(),
      isFinal: true,
      status: "final",
    };
    
    setConversation(prev => [...prev, newMessage]);

    // Send message through data channel
    const message = {
      type: "conversation.item.create",
      item: {
        type: "message",
        role: "user",
        content: [
          {
            type: "input_text",
            text: text,
          },
        ],
      },
    };

    const response = {
      type: "response.create",
    };
    
    dataChannelRef.current.send(JSON.stringify(message));
    dataChannelRef.current.send(JSON.stringify(response));}

  // Add toggle mic function
  const toggleMic = useCallback(() => {
    if (audioStreamRef.current) {
      const audioTrack = audioStreamRef.current.getAudioTracks()[0];
      if (audioTrack) {
        audioTrack.enabled = !audioTrack.enabled;
        setIsMicMuted(!audioTrack.enabled);
      }
    }
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => stopSession();
  }, []);

  return {
    status,
    isSessionActive,
    isMicMuted,
    audioIndicatorRef,
    startSession,
    stopSession,
    handleStartStopClick,
    toggleMic,
    registerFunction,
    msgs,
    currentVolume,
    conversation,
    sendTextMessage,
  };
}
