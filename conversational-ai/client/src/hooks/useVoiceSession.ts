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
  statuses: ProviderStatuses;
  transcripts: TranscriptEntry[];
  interimText: string;
  assistantStreaming: string;
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

export function useVoiceSession() {
  const [state, setState] = useState<VoiceSessionState>({
    connected: false,
    sessionActive: false,
    statuses: initialStatuses,
    transcripts: [],
    interimText: "",
    assistantStreaming: "",
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
  const pendingConfigRef = useRef<SessionConfig>({});

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
      console.info("[USER] interruption detected");
      playerRef.current?.clear();
      playerRef.current?.setActiveGeneration(null);
      vadRef.current?.disarm();
      sendJson({ type: "interrupt", generationId });
      activeGenRef.current = null;
      setState((s) => ({
        ...s,
        activeGenerationId: null,
        assistantStreaming: s.assistantStreaming
          ? s.assistantStreaming
          : s.assistantStreaming,
      }));
    },
    [sendJson],
  );

  const handleServerEvent = useCallback(
    (ev: ServerJsonEvent) => {
      switch (ev.type) {
        case "session_started":
          setState((s) => ({
            ...s,
            sessionActive: true,
            error: null,
            statuses: { ...s.statuses, session: "ready" },
          }));
          pushLog(`[SESSION] started ${ev.sessionId}`);
          break;
        case "session_ended":
          setState((s) => ({
            ...s,
            sessionActive: false,
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
          if (activeGenRef.current) {
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
              assistantStreaming: ev.text,
            }));
          } else {
            setState((s) => ({
              ...s,
              assistantStreaming: s.assistantStreaming + ev.text,
            }));
          }
          break;
        case "assistant_text_final":
          setState((s) => {
            const text = ev.text || s.assistantStreaming;
            return {
              ...s,
              assistantStreaming: "",
              activeGenerationId: ev.interrupted ? null : s.activeGenerationId,
              transcripts: text
                ? [
                    ...s.transcripts,
                    {
                      id: ev.generationId,
                      role: "assistant",
                      text,
                      interrupted: ev.interrupted,
                    },
                  ]
                : s.transcripts,
            };
          });
          if (ev.interrupted) {
            activeGenRef.current = null;
            vadRef.current?.disarm();
          }
          break;
        case "assistant_speech_started":
          activeGenRef.current = ev.generationId;
          playerRef.current?.setActiveGeneration(ev.generationId);
          vadRef.current?.arm();
          setState((s) => ({ ...s, activeGenerationId: ev.generationId }));
          pushLog("[PLAYBACK] assistant speech started");
          break;
        case "assistant_speech_ended":
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
          playerRef.current?.clear();
          playerRef.current?.setActiveGeneration(null);
          vadRef.current?.disarm();
          if (activeGenRef.current === ev.generationId) {
            activeGenRef.current = null;
          }
          setState((s) => ({
            ...s,
            activeGenerationId: null,
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
    [interruptNow, pushLog],
  );

  const cleanupMedia = useCallback(() => {
    vadRef.current?.detach();
    vadRef.current = null;
    micRef.current?.stop();
    micRef.current = null;
    playerRef.current?.stop();
    playerRef.current = null;
    activeGenRef.current = null;
  }, []);

  const endConversation = useCallback(() => {
    sendJson({ type: "end_session" });
    cleanupMedia();
    const ws = wsRef.current;
    wsRef.current = null;
    try {
      ws?.close();
    } catch {
      /* ignore */
    }
    setState((s) => ({
      ...s,
      connected: false,
      sessionActive: false,
      activeGenerationId: null,
      interimText: "",
      assistantStreaming: "",
      statuses: initialStatuses,
    }));
  }, [cleanupMedia, sendJson]);

  const startConversation = useCallback(
    async (config: SessionConfig) => {
      setState((s) => ({
        ...s,
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
      pendingConfigRef.current = config;

      const player = new StreamingAudioPlayer();
      await player.ensureReady();
      playerRef.current = player;

      const mic = new MicrophoneStream();
      micRef.current = mic;

      const ws = new WebSocket(wsUrl());
      ws.binaryType = "arraybuffer";
      wsRef.current = ws;

      await new Promise<void>((resolve, reject) => {
        const t = window.setTimeout(
          () => reject(new Error("WebSocket connect timeout")),
          10_000,
        );
        ws.onopen = () => {
          window.clearTimeout(t);
          resolve();
        };
        ws.onerror = () => {
          window.clearTimeout(t);
          reject(new Error("WebSocket connection failed"));
        };
      });

      setState((s) => ({ ...s, connected: true }));
      pushLog("[SESSION] connected");

      ws.onmessage = (evt) => {
        if (typeof evt.data !== "string") {
          const decoded = decodeAssistantFrame(evt.data as ArrayBuffer);
          if (!decoded) return;
          if (
            activeGenRef.current &&
            decoded.generationId !== activeGenRef.current
          ) {
            return; // drop late audio
          }
          if (audioRecvAtRef.current == null) {
            audioRecvAtRef.current = performance.now();
          }
          player.setOnFirstPlay(() => {
            const recv = audioRecvAtRef.current;
            if (recv != null) {
              const playbackDelayMs = Math.round(performance.now() - recv);
              setState((s) => {
                if (!s.metrics) return s;
                const totalMs =
                  s.metrics.serverToFirstAudioMs != null
                    ? s.metrics.serverToFirstAudioMs + playbackDelayMs
                    : null;
                return {
                  ...s,
                  metrics: {
                    ...s.metrics,
                    playbackDelayMs,
                    totalMs,
                  },
                };
              });
              pushLog(`[PLAYBACK] started (+${playbackDelayMs}ms after recv)`);
            }
            player.setOnFirstPlay(null);
          });
          void player.playChunk(decoded.pcm, decoded.generationId);
          return;
        }

        try {
          const msg = JSON.parse(evt.data) as ServerJsonEvent;
          handleServerEvent(msg);
        } catch {
          pushLog("[ERROR] malformed server event");
        }
      };

      ws.onclose = () => {
        pushLog("[SESSION] websocket closed");
        cleanupMedia();
        setState((s) => ({
          ...s,
          connected: false,
          sessionActive: false,
          statuses: { ...s.statuses, session: "closed" },
        }));
      };

      try {
        await mic.start();
      } catch (err) {
        setState((s) => ({
          ...s,
          error: String(err),
          statuses: { ...s.statuses, session: "error" },
        }));
        endConversation();
        return;
      }

      // Fan-out: send mic PCM to server (Scribe STT path).
      // Future Speech Analysis can subscribe here too.
      mic.subscribe((pcm) => {
        if (ws.readyState === WebSocket.OPEN) {
          ws.send(encodeMicFrame(pcm));
        }
      });

      const vad = new EnergyVad();
      vadRef.current = vad;
      const media = mic.getMediaStream();
      if (media) {
        await vad.attach(media, () => {
          if (activeGenRef.current) {
            interruptNow(activeGenRef.current);
          }
        });
      }

      sendJson({ type: "start_session", config });
    },
    [
      cleanupMedia,
      endConversation,
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
    return () => {
      cleanupMedia();
      wsRef.current?.close();
    };
  }, [cleanupMedia]);

  return {
    ...state,
    startConversation,
    endConversation,
    manualInterrupt,
  };
}
