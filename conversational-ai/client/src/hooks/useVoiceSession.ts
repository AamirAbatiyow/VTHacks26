import { useCallback, useEffect, useRef, useState } from "react";
import {
  BinaryMsgType,
  type ClientJsonMessage,
  type ProviderStatus,
  type ServerJsonEvent,
  type SessionConfig,
  type SpeechSignal,
  type StutterAnalysis,
  type TurnMetrics,
} from "@shared/events";
import { MicrophoneStream } from "../audio/recorder";
import { StreamingAudioPlayer } from "../audio/player";
import { EnergyVad } from "../audio/vad";
import type { PracticeSession } from "../progress/practiceHistory";

export interface TranscriptEntry {
  id: string;
  role: "user" | "assistant";
  text: string;
  interim?: boolean;
  interrupted?: boolean;
  signal?: SpeechSignal;
  stutter?: StutterAnalysis;
}

export interface ProviderStatuses {
  session: ProviderStatus;
  scribe: ProviderStatus;
  gemini: ProviderStatus;
  elevenlabs: ProviderStatus;
}

export interface VoiceSessionState {
  connected: boolean;
  sessionActive: boolean;
  isStarting: boolean;
  assistantSpeaking: boolean;
  micMuted: boolean;
  statuses: ProviderStatuses;
  transcripts: TranscriptEntry[];
  interimText: string;
  assistantStreaming: string;
  /** Last utterance identity, retained when playback drains or is interrupted. */
  assistantUtteranceId: string | null;
  activeGenerationId: string | null;
  metrics: TurnMetrics | null;
  error: string | null;
  logs: string[];
}

function wsUrl(): string {
  const proto = window.location.protocol === "https:" ? "wss:" : "ws:";
  // Vite proxies /ws → backend in dev
  return `${proto}//${window.location.host}/ws`;
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

const initialStatuses: ProviderStatuses = {
  session: "idle",
  scribe: "idle",
  gemini: "idle",
  elevenlabs: "idle",
};

export function useVoiceSession(onSessionComplete?: (entry: PracticeSession) => void) {
  const completionRef = useRef(onSessionComplete);
  completionRef.current = onSessionComplete;
  const practiceRef = useRef<(PracticeSession & { clockStart: number }) | null>(null);
  const practiceModeRef = useRef<PracticeSession["mode"]>("default");
  const [state, setState] = useState<VoiceSessionState>({
    connected: false,
    sessionActive: false,
    isStarting: false,
    assistantSpeaking: false,
    micMuted: false,
    statuses: initialStatuses,
    transcripts: [],
    interimText: "",
    assistantStreaming: "",
    assistantUtteranceId: null,
    activeGenerationId: null,
    metrics: null,
    error: null,
    logs: [],
  });

  const wsRef = useRef<WebSocket | null>(null);
  const micRef = useRef<MicrophoneStream | null>(null);
  const playerRef = useRef<StreamingAudioPlayer | null>(null);
  const vadRef = useRef<EnergyVad | null>(null);
  const activeGenRef = useRef<string | null>(null);
  const audioRecvAtRef = useRef<number | null>(null);
  const sessionVersionRef = useRef(0);
  const startingRef = useRef(false);
  const micMutedRef = useRef(false);
  const mountedRef = useRef(true);
  const cancelConnectRef = useRef<(() => void) | null>(null);
  const sessionReadyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const interruptedGenerationsRef = useRef(new Set<string>());

  const pushLog = useCallback((line: string) => {
    setState((s) => ({
      ...s,
      logs: [...s.logs.slice(-200), line],
    }));
  }, []);

  const sendJson = useCallback((msg: ClientJsonMessage) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }, []);

  const interruptNow = useCallback(
    (generationId: string | null) => {
      if (!generationId) return;
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
    audioRecvAtRef.current = null;
  }, []);

  const closeConnection = useCallback(() => {
    // Record once, only after the server confirms a real session has started.
    const practice = practiceRef.current;
    practiceRef.current = null;
    if (practice) {
      const { clockStart, ...summary } = practice;
      completionRef.current?.({ ...summary, seconds: Math.max(0, Math.round((performance.now() - clockStart) / 1000)) });
    }
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

  const endConversation = useCallback(() => {
    sendJson({ type: "end_session" });
    closeConnection();
    setState((s) => ({
      ...s,
      connected: false,
      sessionActive: false,
      isStarting: false,
      assistantSpeaking: false,
      activeGenerationId: null,
      interimText: "",
      assistantStreaming: "",
      statuses: initialStatuses,
    }));
  }, [closeConnection, sendJson]);

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
      switch (ev.type) {
        case "session_started":
          if (!practiceRef.current) practiceRef.current = {
            id: ev.sessionId, startedAt: new Date().toISOString(), seconds: 0,
            turns: 0, mode: practiceModeRef.current, clockStart: performance.now(),
          };
          startingRef.current = false;
          if (sessionReadyTimerRef.current) clearTimeout(sessionReadyTimerRef.current);
          sessionReadyTimerRef.current = null;
          setState((s) => ({
            ...s,
            sessionActive: true,
            isStarting: false,
            error: null,
            statuses: { ...s.statuses, session: "ready" },
          }));
          pushLog(`[SESSION] started ${ev.sessionId}`);
          break;
        case "session_ended":
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
            statuses: { ...initialStatuses, session: "closed" },
          }));
          pushLog("[SESSION] ended");
          break;
        case "provider_status":
          setState((s) => ({
            ...s,
            statuses: { ...s.statuses, [ev.provider]: ev.status },
          }));
          pushLog(
            `[${ev.provider.toUpperCase()}] ${ev.status}${ev.detail ? `: ${ev.detail}` : ""}`,
          );
          break;
        case "transcript_interim":
          setState((s) => ({ ...s, interimText: ev.text }));
          break;
        case "transcript_final":
          if (practiceRef.current) practiceRef.current.turns += 1;
          setState((s) => ({
            ...s,
            interimText: "",
            transcripts: [
              ...s.transcripts,
              {
                id: ev.turnId,
                role: "user",
                text: ev.text,
                signal: ev.signal,
              },
            ],
          }));
          pushLog(
            `[USER] final: "${ev.text}"${
              ev.signal
                ? ` [${ev.signal.samples.length} pts, ${ev.signal.durationMs}ms]`
                : ""
            }`,
          );
          break;
        case "stutter_analysis": {
          // Arrives after transcript_final; attach to the matching user turn.
          setState((s) => ({
            ...s,
            transcripts: s.transcripts.map((t) =>
              t.id === ev.turnId ? { ...t, stutter: ev.analysis } : t,
            ),
          }));
          const hits = ev.analysis.events
            .filter((e) => e.detected && e.label !== "Fluent")
            .map((e) => `${e.label} ${e.probability.toFixed(2)}`);
          pushLog(
            `[STUTTER] ${hits.length ? hits.join(", ") : "none detected"} ` +
              `(fluency ${ev.analysis.fluency.toFixed(2)}, ${ev.analysis.inferenceMs}ms)`,
          );
          break;
        }
        case "user_speech_started":
          // Server-side barge-in may also fire; client VAD usually already cleared.
          if (!micMutedRef.current && activeGenRef.current) {
            interruptNow(activeGenRef.current);
          }
          break;
        case "assistant_text_delta":
          if (activeGenRef.current !== ev.generationId) {
            activeGenRef.current = ev.generationId;
            playerRef.current?.setActiveGeneration(ev.generationId);
            audioRecvAtRef.current = null;
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
          if (activeGenRef.current !== ev.generationId) audioRecvAtRef.current = null;
          activeGenRef.current = ev.generationId;
          playerRef.current?.setActiveGeneration(ev.generationId);
          setState((s) => ({
            ...s,
            activeGenerationId: ev.generationId,
            assistantUtteranceId: ev.generationId,
            assistantStreaming: s.assistantUtteranceId === ev.generationId ? s.assistantStreaming : "",
          }));
          pushLog("[PLAYBACK] assistant speech started");
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
            pushLog("[PLAYBACK] finished");
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
          pushLog(`[USER] interrupted ${ev.generationId.slice(0, 8)}`);
          break;
        case "turn_metrics": {
          const m = { ...ev.metrics };
          if (
            audioRecvAtRef.current != null &&
            m.playbackDelayMs == null
          ) {
            // playback delay filled on first play if not already
          }
          setState((s) => ({ ...s, metrics: m }));
          break;
        }
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
              statuses: { ...initialStatuses, session: "error" },
            }));
          }
          setState((s) => ({ ...s, error: ev.message }));
          pushLog(`[ERROR] ${ev.code}: ${ev.message}`);
          break;
        case "log":
          pushLog(`[${ev.tag}] ${ev.message}`);
          break;
        default:
          break;
      }
    },
    [closeConnection, interruptNow, pushLog],
  );

  const startConversation = useCallback(
    async (config: SessionConfig) => {
      if (startingRef.current || wsRef.current) return;
      const version = ++sessionVersionRef.current;
      const isCurrent = () => mountedRef.current && version === sessionVersionRef.current;
      startingRef.current = true;
      practiceModeRef.current = config.conversationMode ?? "default";
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
        metrics: null,
        logs: [],
        statuses: {
          session: "connecting",
          scribe: "idle",
          gemini: "idle",
          elevenlabs: "idle",
        },
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
        pushLog("[SESSION] connected");

        ws.onmessage = (evt) => {
          if (!isCurrent()) return;
          if (typeof evt.data !== "string") {
            const decoded = decodeAssistantFrame(evt.data as ArrayBuffer);
            if (!decoded || decoded.generationId !== activeGenRef.current) return;
            if (audioRecvAtRef.current == null) audioRecvAtRef.current = performance.now();
            player.setOnFirstPlay(() => {
              if (!isCurrent()) return;
              const recv = audioRecvAtRef.current;
              if (recv != null) {
                const playbackDelayMs = Math.round(performance.now() - recv);
                setState((s) => {
                  if (!s.metrics) return s;
                  const totalMs = s.metrics.serverToFirstAudioMs != null
                    ? s.metrics.serverToFirstAudioMs + playbackDelayMs : null;
                  return { ...s, metrics: { ...s.metrics, playbackDelayMs, totalMs } };
                });
                pushLog(`[PLAYBACK] started (+${playbackDelayMs}ms after recv)`);
              }
              player.setOnFirstPlay(null);
            });
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
            pushLog("[ERROR] malformed server event");
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
            statuses: { ...initialStatuses, session: "closed" },
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
            statuses: { ...initialStatuses, session: "error" },
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
          error: detail.startsWith("Microphone") ? detail
            : "We couldn’t connect to your voice session. Please try again.",
          statuses: { ...initialStatuses, session: "error" },
        }));
        pushLog(`[ERROR] ${detail}`);
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
      pushLog,
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
    startConversation,
    endConversation,
    manualInterrupt,
    toggleMicrophone,
  };
}
