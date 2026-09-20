import { useCallback, useEffect, useRef, useState } from "react";
import {
  BinaryMsgType,
  type ClientJsonMessage,
  type ServerJsonEvent,
  type SessionConfig,
} from "@shared/events";
import { MicrophoneStream } from "../audio/recorder";
import { StreamingAudioPlayer } from "../audio/player";
import { EnergyVad } from "../audio/vad";
import { isPracticeSession, type PracticeSession } from "../progress/practiceHistory";
import { SessionSummaryCollector } from "@shared/sessionSummary";

export interface TranscriptEntry {
  id: string;
  role: "user" | "assistant";
  text: string;
  interim?: boolean;
  interrupted?: boolean;
}

export interface VoiceSessionState {
  connected: boolean;
  sessionActive: boolean;
  isStarting: boolean;
  assistantSpeaking: boolean;
  micMuted: boolean;
  transcripts: TranscriptEntry[];
  interimText: string;
  assistantStreaming: string;
  /** Last utterance identity, retained when playback drains or is interrupted. */
  assistantUtteranceId: string | null;
  activeGenerationId: string | null;
  error: string | null;
  /** On-screen coaching line after a non-fluent event. */
  stutterCue: string | null;
  stutterCueId: number;
  praiseCue: string | null;
  praiseCueId: number;
  wrappingUp: boolean;
}

/**
 * The browser cannot distinguish a stopped server from a network problem, but
 * in development the usual cause is that only the client is running. Naming it
 * saves a debugging detour; end users just get the plain message.
 */
function unreachableMessage(): string {
  return import.meta.env.DEV
    ? "Can’t reach the voice server on port 3001. Start it with `npm run dev` in conversational-ai/ (this runs the server and client together), then try again."
    : "We couldn’t connect to your voice session. Please try again.";
}

function wsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  // Vite proxies /ws → backend in dev
  return `${proto}//${window.location.host}/ws`;
}

const STUTTER_CUES = [
  "Take your time.",
  "There is no hurry.",
  "The words can wait.",
  "You have the floor.",
  "Ease into the next sound.",
  "Stay with the thought.",
  "A pause is allowed.",
  "Finish when you're ready.",
  "Soft start is enough.",
  "We can go slowly.",
];

function nextStutterCue(previous: string | null): string {
  const pool = STUTTER_CUES.filter((line) => line !== previous);
  return pool[Math.floor(Math.random() * pool.length)] ?? STUTTER_CUES[0]!;
}

function encodeMicFrame(pcm: ArrayBuffer): ArrayBuffer {
  const idLen = 0;
  const out = new Uint8Array(2 + idLen + pcm.byteLength);
  out[0] = BinaryMsgType.MIC_AUDIO;
  out[1] = idLen;
  out.set(new Uint8Array(pcm), 2);
  return out.buffer;
}

function decodeAssistantFrame(data: ArrayBuffer): {
  generationId: string;
  pcm: ArrayBuffer;
} | null {
  const view = new Uint8Array(data);
  if (view.length < 2) return null;
  if (view[0] !== BinaryMsgType.ASSISTANT_AUDIO) return null;
  const idLen = view[1]!;
  if (view.length < 2 + idLen) return null;
  const generationId = new TextDecoder().decode(view.subarray(2, 2 + idLen));
  const pcm = data.slice(2 + idLen);
  return { generationId, pcm };
}

export function useVoiceSession(onSessionComplete?: (entry: PracticeSession) => void) {
  const completionRef = useRef(onSessionComplete);
  completionRef.current = onSessionComplete;
  const practiceRef = useRef<{ collector: SessionSummaryCollector; clockStart: number; stoppedAt?: number } | null>(null);
  const practiceModeRef = useRef<PracticeSession["mode"]>("conversation");
  const [isEnding, setIsEnding] = useState(false);
  const endingRef = useRef<{ promise: Promise<void>; resolve: () => void; timer: ReturnType<typeof setTimeout> } | null>(null);
  const [state, setState] = useState<VoiceSessionState>({
    connected: false,
    sessionActive: false,
    isStarting: false,
    assistantSpeaking: false,
    micMuted: false,
    transcripts: [],
    interimText: "",
    assistantStreaming: "",
    assistantUtteranceId: null,
    activeGenerationId: null,
    error: null,
    stutterCue: null,
    stutterCueId: 0,
    praiseCue: null,
    praiseCueId: 0,
    wrappingUp: false,
  });

  const wsRef = useRef<WebSocket | null>(null);
  const micRef = useRef<MicrophoneStream | null>(null);
  const playerRef = useRef<StreamingAudioPlayer | null>(null);
  const vadRef = useRef<EnergyVad | null>(null);
  const activeGenRef = useRef<string | null>(null);
  const sessionVersionRef = useRef(0);
  const startingRef = useRef(false);
  const micMutedRef = useRef(false);
  const mountedRef = useRef(true);
  const cancelConnectRef = useRef<(() => void) | null>(null);
  const sessionReadyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const interruptedGenerationsRef = useRef(new Set<string>());
  const wrappingUpRef = useRef(false);

  const sendJson = useCallback((msg: ClientJsonMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }, []);

  const interruptNow = useCallback(
    (generationId: string | null) => {
      if (!generationId || wrappingUpRef.current) return;
      interruptedGenerationsRef.current.add(generationId);
      console.info("[USER] interruption detected");
      playerRef.current?.clear();
      playerRef.current?.setActiveGeneration(null);
      vadRef.current?.disarm();
      sendJson({ type: "interrupt", generationId });
      activeGenRef.current = null;
      setState((s) => ({
        ...s,
        activeGenerationId: null,
        assistantSpeaking: false,
      }));
    },
    [sendJson],
  );

  const cleanupMedia = useCallback(() => {
    vadRef.current?.detach();
    vadRef.current = null;
    micRef.current?.stop();
    micRef.current = null;
    playerRef.current?.setOnPlaybackState(null);
    playerRef.current?.setOnFirstPlay(null);
    playerRef.current?.setOnDrained(null);
    playerRef.current?.stop();
    playerRef.current = null;
    activeGenRef.current = null;
  }, []);

  const closeConnection = useCallback(() => {
    // Record once, only after the server confirms a real session has started.
    const practice = practiceRef.current;
    practiceRef.current = null;
    if (practice) {
      completionRef.current?.(practice.collector.snapshot(((practice.stoppedAt ?? performance.now()) - practice.clockStart) / 1000, "device"));
    }
    if (endingRef.current) {
      clearTimeout(endingRef.current.timer);
      endingRef.current.resolve();
      endingRef.current = null;
    }
    if (mountedRef.current) setIsEnding(false);
    sessionVersionRef.current += 1;
    startingRef.current = false;
    if (sessionReadyTimerRef.current) clearTimeout(sessionReadyTimerRef.current);
    sessionReadyTimerRef.current = null;
    cancelConnectRef.current?.();
    cancelConnectRef.current = null;
    cleanupMedia();
    const ws = wsRef.current;
    wsRef.current = null;
    if (ws) {
      ws.onmessage = null;
      ws.onclose = null;
      ws.onerror = null;
      try {
        ws.close();
      } catch {
        /* already closed */
      }
    }
  }, [cleanupMedia]);

  const endConversation = useCallback((): Promise<void> => {
    if (endingRef.current) return endingRef.current.promise;
    const canFinish = practiceRef.current && wsRef.current?.readyState === WebSocket.OPEN;
    cleanupMedia(); // Stop capture/playback immediately, but keep final events flowing.
    if (practiceRef.current) practiceRef.current.stoppedAt = performance.now();
    const reset = () => setState(s => ({ ...s, connected: false, sessionActive: false, isStarting: false,
      assistantSpeaking: false, activeGenerationId: null, interimText: "", assistantStreaming: "", stutterCue: null, praiseCue: null, wrappingUp: false }));
    if (!canFinish) {
      sendJson({ type: "end_session" });
      closeConnection();
      reset();
      return Promise.resolve();
    }
    setIsEnding(true);
    let resolve!: () => void;
    const promise = new Promise<void>(done => { resolve = done; });
    endingRef.current = { promise, resolve, timer: setTimeout(() => { closeConnection(); reset(); }, 5000) };
    sendJson({ type: "end_session" });
    return promise;
  }, [cleanupMedia, closeConnection, sendJson]);

  const toggleMicrophone = useCallback(() => {
    const muted = !micMutedRef.current;
    micMutedRef.current = muted;
    micRef.current?.getMediaStream()?.getAudioTracks().forEach((track) => {
      track.enabled = !muted;
    });
    if (muted) vadRef.current?.disarm();
    else if (playerRef.current?.isPlaying) vadRef.current?.arm();
    setState((s) => ({ ...s, micMuted: muted }));
  }, []);

  const handleServerEvent = useCallback(
    (ev: ServerJsonEvent) => {
      if (
        (ev.type === "assistant_text_delta" || ev.type === "assistant_speech_started" || ev.type === "assistant_speech_ended") &&
        interruptedGenerationsRef.current.has(ev.generationId)
      ) return;
      if (endingRef.current && (ev.type.startsWith("assistant_") || ev.type === "user_speech_started")) return;
      switch (ev.type) {
        case "session_started":
          if (!practiceRef.current) practiceRef.current = {
            collector: new SessionSummaryCollector(ev.sessionId, new Date().toISOString(), practiceModeRef.current), clockStart: performance.now(),
          };
          startingRef.current = false;
          if (sessionReadyTimerRef.current) clearTimeout(sessionReadyTimerRef.current);
          sessionReadyTimerRef.current = null;
          setState((s) => ({
            ...s,
            sessionActive: true,
            isStarting: false,
            error: null,
          }));
          break;
        case "session_wrapping_up":
          wrappingUpRef.current = true;
          vadRef.current?.disarm();
          setState((s) => ({ ...s, wrappingUp: true }));
          break;
        case "session_ended": {
          if (ev.summary && isPracticeSession(ev.summary) && ev.summary.id === practiceRef.current?.collector.id) {
            practiceRef.current = null;
            completionRef.current?.(ev.summary);
          }
          const finish = () => {
            closeConnection();
            setState((s) => ({
              ...s,
              connected: false,
              sessionActive: false,
              isStarting: false,
              assistantSpeaking: false,
              activeGenerationId: null,
              assistantStreaming: "",
              interimText: "",
              stutterCue: null,
              praiseCue: null,
              wrappingUp: false,
            }));
          };
          if (playerRef.current?.isPlaying) {
            let settled = false;
            const once = () => {
              if (settled) return;
              settled = true;
              finish();
            };
            playerRef.current.setOnDrained(once);
            window.setTimeout(once, 8_000);
          } else {
            finish();
          }
          break;
        }
        case "transcript_interim":
          setState((s) => ({ ...s, interimText: ev.text }));
          break;
        case "transcript_final":
          practiceRef.current?.collector.addTurn(ev.turnId);
          setState((s) => ({
            ...s,
            interimText: "",
            transcripts: [
              ...s.transcripts,
              { id: ev.turnId, role: "user", text: ev.text },
            ],
          }));
          break;
        case "stutter_analysis": {
          practiceRef.current?.collector.addAnalysis(ev.turnId, ev.analysis);
          const flagged = ev.analysis.events.some((event) => event.detected && event.label !== "Fluent");
          setState((s) => flagged && practiceModeRef.current !== "endless"
            ? { ...s, stutterCue: nextStutterCue(s.stutterCue), stutterCueId: s.stutterCueId + 1 }
            : s);
          break;
        }
        case "praise":
          setState((s) => ({ ...s, praiseCue: ev.text, praiseCueId: s.praiseCueId + 1 }));
          break;
        case "assistant_text_delta":
          if (activeGenRef.current !== ev.generationId) {
            activeGenRef.current = ev.generationId;
            playerRef.current?.setActiveGeneration(ev.generationId);
            setState((s) => ({
              ...s,
              activeGenerationId: ev.generationId,
              assistantUtteranceId: ev.generationId,
              assistantStreaming: ev.text,
            }));
          } else {
            setState((s) => ({
              ...s,
              assistantUtteranceId: ev.generationId,
              assistantStreaming:
                (s.assistantUtteranceId === ev.generationId ? s.assistantStreaming : "") + ev.text,
            }));
          }
          break;
        case "assistant_text_final": {
          const interrupted = ev.interrupted || interruptedGenerationsRef.current.has(ev.generationId);
          setState((s) => {
            const isCurrentUtterance = s.assistantUtteranceId === ev.generationId;
            const text = ev.text || (isCurrentUtterance ? s.assistantStreaming : "");
            return {
              ...s,
              assistantStreaming: isCurrentUtterance ? "" : s.assistantStreaming,
              activeGenerationId: interrupted && s.activeGenerationId === ev.generationId
                ? null : s.activeGenerationId,
              transcripts: text
                ? [
                    ...s.transcripts,
                    {
                      id: ev.generationId,
                      role: "assistant",
                      text,
                      interrupted,
                    },
                  ]
                : s.transcripts,
            };
          });
          if (interrupted && activeGenRef.current === ev.generationId) {
            playerRef.current?.clear();
            playerRef.current?.setActiveGeneration(null);
            activeGenRef.current = null;
            vadRef.current?.disarm();
          }
          break;
        }
        case "assistant_speech_started":
          activeGenRef.current = ev.generationId;
          playerRef.current?.setActiveGeneration(ev.generationId);
          setState((s) => ({
            ...s,
            activeGenerationId: ev.generationId,
            assistantUtteranceId: ev.generationId,
            assistantStreaming: s.assistantUtteranceId === ev.generationId ? s.assistantStreaming : "",
          }));
          break;
        case "assistant_speech_ended":
          if (activeGenRef.current !== ev.generationId) break;
          // The server is done sending, but playback may still have seconds of
          // queued audio. Keep barge-in armed until the queue actually drains.
          playerRef.current?.setOnDrained(() => {
            playerRef.current?.setOnDrained(null);
            vadRef.current?.disarm();
            if (activeGenRef.current === ev.generationId) {
              activeGenRef.current = null;
            }
            setState((s) => ({
              ...s,
              activeGenerationId:
                s.activeGenerationId === ev.generationId
                  ? null
                  : s.activeGenerationId,
            }));
          });
          playerRef.current?.markNoMoreAudio();
          break;
        case "interrupted":
          interruptedGenerationsRef.current.add(ev.generationId);
          if (activeGenRef.current !== ev.generationId) break;
          playerRef.current?.clear();
          playerRef.current?.setActiveGeneration(null);
          vadRef.current?.disarm();
          if (activeGenRef.current === ev.generationId) {
            activeGenRef.current = null;
          }
          setState((s) => ({
            ...s,
            activeGenerationId: null,
            assistantSpeaking: false,
          }));
          break;
        case "error":
          // Startup cannot progress after a provider failure. Release the mic
          // and socket so Start can be retried immediately.
          if (startingRef.current || ev.recoverable === false) {
            closeConnection();
            setState((s) => ({
              ...s,
              connected: false,
              sessionActive: false,
              isStarting: false,
              assistantSpeaking: false,
              activeGenerationId: null,
              assistantStreaming: "",
            }));
          }
          setState((s) => ({ ...s, error: ev.message }));
          break;
        default:
          break;
      }
    },
    [closeConnection, interruptNow],
  );

  const startConversation = useCallback(
    async (config: SessionConfig) => {
      if (startingRef.current || wsRef.current || endingRef.current) return;
      const version = ++sessionVersionRef.current;
      const isCurrent = () => mountedRef.current && version === sessionVersionRef.current;
      startingRef.current = true;
      wrappingUpRef.current = false;
      practiceModeRef.current = config.conversationMode ?? "conversation";
      interruptedGenerationsRef.current.clear();
      setState((s) => ({
        ...s,
        isStarting: true,
        assistantSpeaking: false,
        activeGenerationId: null,
        assistantUtteranceId: null,
        error: null,
        transcripts: [],
        interimText: "",
        assistantStreaming: "",
        stutterCue: null,
        praiseCue: null,
        wrappingUp: false,
      }));
      const player = new StreamingAudioPlayer();
      const mic = new MicrophoneStream();
      try {
        playerRef.current = player;
        player.setOnPlaybackState((playing) => {
          if (!isCurrent()) return;
          if (playing && !micMutedRef.current) vadRef.current?.arm();
          else vadRef.current?.disarm();
          setState((s) => ({ ...s, assistantSpeaking: playing }));
        });
        await player.ensureReady();
        if (!isCurrent()) return;

        const ws = new WebSocket(wsUrl());
        ws.binaryType = "arraybuffer";
        wsRef.current = ws;
        await new Promise<void>((resolve, reject) => {
          const cleanup = () => {
            clearTimeout(timer);
            ws.removeEventListener("open", opened);
            ws.removeEventListener("error", failed);
            ws.removeEventListener("close", failed);
            if (cancelConnectRef.current === cancelled) cancelConnectRef.current = null;
          };
          const opened = () => { cleanup(); resolve(); };
          const failed = () => { cleanup(); reject(new Error("Voice connection unavailable")); };
          const cancelled = () => { cleanup(); reject(new Error("Voice session cancelled")); };
          const timer = setTimeout(failed, 10_000);
          cancelConnectRef.current = cancelled;
          ws.addEventListener("open", opened);
          ws.addEventListener("error", failed);
          ws.addEventListener("close", failed);
        });
        if (!isCurrent()) return;
        setState((s) => ({ ...s, connected: true }));

        ws.onmessage = (evt) => {
          if (!isCurrent()) return;
          if (typeof evt.data !== "string") {
            if (endingRef.current) return;
            const decoded = decodeAssistantFrame(evt.data as ArrayBuffer);
            if (!decoded || decoded.generationId !== activeGenRef.current) return;
            void player.playChunk(decoded.pcm, decoded.generationId).catch(() => {
              if (!isCurrent()) return;
              if (activeGenRef.current === decoded.generationId) interruptNow(decoded.generationId);
              setState((s) => ({ ...s, error: "Audio playback stopped. Please restart your session." }));
            });
            return;
          }
          try {
            handleServerEvent(JSON.parse(evt.data) as ServerJsonEvent);
          } catch {
            // A single unparseable frame is not worth interrupting the session.
          }
        };
        ws.onclose = () => {
          if (!isCurrent()) return;
          closeConnection();
          setState((s) => ({
            ...s,
            connected: false,
            sessionActive: false,
            isStarting: false,
            assistantSpeaking: false,
            activeGenerationId: null,
            assistantStreaming: "",
            interimText: "",
            error: "The voice connection closed. You can start again when you’re ready.",
          }));
        };

        micRef.current = mic;
        await mic.start();
        if (!isCurrent()) return;
        const media = mic.getMediaStream();
        media?.getAudioTracks().forEach((track) => { track.enabled = !micMutedRef.current; });
        mic.subscribe((pcm) => {
          if (isCurrent() && !micMutedRef.current && ws.readyState === WebSocket.OPEN) {
            ws.send(encodeMicFrame(pcm));
          }
        });

        const vad = new EnergyVad();
        vadRef.current = vad;
        if (media) {
          await vad.attach(media, () => {
            if (isCurrent() && !micMutedRef.current && activeGenRef.current) {
              interruptNow(activeGenRef.current);
            }
          });
          if (!isCurrent()) { vad.detach(); return; }
        }
        sessionReadyTimerRef.current = setTimeout(() => {
          if (!isCurrent() || !startingRef.current) return;
          closeConnection();
          setState((s) => ({
            ...s,
            connected: false,
            sessionActive: false,
            isStarting: false,
            assistantSpeaking: false,
            activeGenerationId: null,
            error: "Your voice session took too long to start. Please try again.",
          }));
        }, 30_000);
        sendJson({ type: "start_session", config });
      } catch (err) {
        if (!isCurrent()) return;
        const detail = err instanceof Error ? err.message : String(err);
        closeConnection();
        setState((s) => ({
          ...s,
          connected: false,
          sessionActive: false,
          isStarting: false,
          assistantSpeaking: false,
          activeGenerationId: null,
          error: detail.startsWith("Microphone") ? detail : unreachableMessage(),
        }));
      } finally {
        // A permission prompt can resolve after Stop or navigation. Release
        // these local resources without touching a newer session’s refs.
        if (!isCurrent()) {
          mic.stop();
          player.stop();
        }
      }
    },
    [
      closeConnection,
      handleServerEvent,
      interruptNow,
      sendJson,
    ],
  );

  const manualInterrupt = useCallback(() => {
    interruptNow(activeGenRef.current);
  }, [interruptNow]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      closeConnection();
    };
  }, [closeConnection]);

  return {
    ...state,
    isEnding,
    startConversation,
    endConversation,
    manualInterrupt,
    toggleMicrophone,
  };
}
