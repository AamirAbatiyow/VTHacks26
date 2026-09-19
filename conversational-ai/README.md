# Conversational Voice AI

Real-time, interruptible conversational voice pipeline for a multimodal speech-coaching MVP.

```
Browser mic (PCM16 16 kHz)
        │
        ▼
 Node WebSocket server  ──fan-out──► (future SpeechAnalyzer)
        │
        ▼
   ElevenLabs Scribe v2 (streaming STT)
        │  final turn only
        ▼
   Gemini Flash (streaming LLM)
        │  TextChunker
        ▼
   ElevenLabs multi-stream-input (TTS)
        │  PCM16 24 kHz
        ▼
 Browser StreamingAudioPlayer
```

## Features

- **True streaming** at every hop (no full-utterance upload, no wait-for-full-LLM)
- **Barge-in / interruption** with generation IDs (late audio dropped)
- **Conversation history** with optional `speechAnalysis` metadata hook
- **Latency instrumentation** (STT / Gemini / TTS / total — measured, not fabricated)
- **API keys stay server-side**

## Setup

### Prerequisites

- Node.js 20+
- API keys: Google Gemini, ElevenLabs (+ a voice ID; Scribe + TTS share one key)

### Install

```bash
cd conversational-ai
npm install
cp .env.example server/.env
# edit server/.env with your keys
```

### Environment variables (`server/.env`)

```
GEMINI_API_KEY=
ELEVENLABS_API_KEY=
ELEVENLABS_VOICE_ID=

# optional
PORT=3001
GEMINI_MODEL=gemini-2.5-flash
ELEVENLABS_MODEL_ID=eleven_flash_v2_5
```

Never put these in the client or Vite env — they must remain server-side.

### Run

```bash
# both server (3001) and Vite client (5173)
npm run dev

# or separately
npm run dev:server
npm run dev:client
```

Open http://localhost:5173

Vite proxies `/ws` → `ws://localhost:3001/ws`.

## Audio format

| Direction | Format |
|-----------|--------|
| Mic → server | PCM16 LE mono @ **16 kHz**, ~20 ms frames, binary WS |
| Server → speakers | PCM16 LE mono @ **24 kHz**, binary WS with `generationId` |

Binary frame layout:

```
[1 byte msgType][1 byte genIdLen][genId UTF-8][payload]

msgType 0x01 = mic audio
msgType 0x02 = assistant audio
```

Mic capture uses an **AudioWorklet** with in-worklet resampling (not MediaRecorder blobs).

Browser constraints enable `echoCancellation`, `noiseSuppression`, and `autoGainControl` where supported. Headphones are strongly recommended for barge-in testing. A full acoustic echo canceller is out of MVP scope — speaker playback can still leak into the mic in open-air setups.

## WebSocket protocol

JSON events (see `shared/events.ts`):

**Client → server:** `start_session`, `end_session`, `interrupt`, `ping`

**Server → client:** `session_started`, `provider_status`, `user_speech_started/ended`, `transcript_interim/final`, `assistant_text_delta/final`, `assistant_speech_started/ended`, `assistant` audio (binary), `interrupted`, `turn_metrics`, `error`

## Interruption architecture

1. While the assistant speaks, client **EnergyVad** (RMS) is armed.
2. User speech → client **immediately** `player.clear()` and sends `interrupt`.
3. Scribe `partial_transcript` with real words is the **server-side backstop**.
4. Server `ConversationManager.interrupt(generationId)`:
   - aborts Gemini (`AbortController`)
   - ElevenLabs `close_context` for that `context_id` (= generationId)
   - marks the model turn interrupted
5. Any late audio tagged with the old generationId is **dropped** (server + client).

## Generation IDs

Each assistant turn gets a UUID `generationId`. It is also the ElevenLabs multi-context `context_id`. Invalidating a generation stops synthesis and playback for that turn only; the ElevenLabs socket stays open for the session.

## Latency measurements

Per turn (monotonic clocks, no fabricated values):

| Mark | Meaning |
|------|---------|
| T0 | User speech ended (from Scribe last-word timestamp via audio-clock bytes mapping) |
| T1 | Final transcript ready |
| T2 | Gemini request starts |
| T3 | First Gemini token |
| T4 | First text chunk sent to ElevenLabs |
| T5 | First ElevenLabs audio received |
| T6 | First audio played (client) |

UI shows STT (T1−T0), Gemini (T3−T2), TTS (T5−T4), and total perceived (≈ T6−T0).

## Utterance waveform

Each finalized user turn ships a **1-D amplitude signal** derived from the
original microphone PCM (not from the transcript text). The server downsamples
the utterance to ~240 peak-signed samples in `[-1, 1]` and the UI draws it under
the USER line.

## Future SpeechAnalyzer integration

```
Browser microphone ──┬── ElevenLabs Scribe STT
                     └── SpeechAnalyzer.analyze(pcm16) → metadata → Gemini
```

Do **not** use Scribe transcripts as the pronunciation-analysis source. Original mic PCM is buffered per session and passed to:

```ts
interface SpeechAnalyzer {
  analyze(input: AnalyzeInput): Promise<SpeechAnalysisResult>;
}
```

MVP ships `NoOpSpeechAnalyzer`. User turns already accept optional `speechAnalysis?: { targetPhoneme?; observations? }`.

## Project layout

```
conversational-ai/
  shared/events.ts
  server/src/
    index.ts
    websocket/session.ts
    services/{scribe,gemini,elevenlabs}.ts
    conversation/{ConversationManager,TextChunker,TurnTimeline,prompt}.ts
    analysis/SpeechAnalyzer.ts
  client/src/
    hooks/useVoiceSession.ts
    audio/{recorder,player,vad,pcm-worklet}.ts
    components/*
```

## Troubleshooting

| Symptom | Check |
|---------|--------|
| Server exits on start | `server/.env` missing keys |
| Mic permission error | Browser site settings; use HTTPS or localhost |
| No transcripts | ElevenLabs key / Scribe access; watch `[SCRIBE]` logs |
| Text but no audio | ElevenLabs key + `ELEVENLABS_VOICE_ID`; `[ELEVENLABS]` logs |
| AI talks over you | Use headphones; click **Interrupt AI**; confirm VAD arms on speech started |
| Echo / feedback | Expected without headphones; echoCancellation is best-effort |
| High latency | Prefer `eleven_flash_v2_5`; check region; watch Latency panel |
| Late audio after interrupt | Should be dropped via generationId — file a bug if not |
| Vite WS fails | Ensure server on 3001; proxy `/ws` in `vite.config.ts` |

## Scripts

```bash
npm run dev        # client + server
npm run typecheck  # both packages
npm run build      # production build
```
