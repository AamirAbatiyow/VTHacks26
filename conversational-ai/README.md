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

- Node.js 24+ (built-in SQLite for local analytics)
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

## Analytics: local SQLite, optional Tiger Data PostgreSQL

The server records session IDs, the profile name, conversation date and duration,
utterance word/character counts and audio duration, assistant responses by count,
interruptions, provider status, error codes, and measured STT/Gemini/TTS latency.
It does not persist ages, interests, transcripts, audio, waveforms, or
free-form provider/error messages. There is no cross-session user identifier.

### Local file (default)

Analytics is saved to `conversational-ai/data/analytics.sqlite`. This file is
intentionally **not gitignored**. No database account or credentials are needed.
The server initializes the schema automatically; to create the file or inspect
the report without starting the voice app, run from `conversational-ai/`:

```bash
npm run db:migrate
npm run analytics:report
```

Leave `DATABASE_URL` unset to use SQLite. Optionally set `ANALYTICS_DB_PATH` in
`server/.env` to another file path (relative to `conversational-ai/`, or absolute).
The local database contains `events`, `sessions`, `turns`, and `hourly_latency`.
It also includes `conversations` and `stuttering_utterances` for identification results.
It uses SQLite's rollback journal, leaving one database file after clean writes.
Small transactions run once per second; local SQLite writes are synchronous and
may briefly occupy the server event loop. The local report includes average
latencies; the PostgreSQL hourly view additionally computes p95 latency.

### Optional: create and connect Tiger Data later

Setting `DATABASE_URL` switches new writes to PostgreSQL; it does not copy existing
SQLite history. The local file remains available for inspection.

1. Sign in to [Tiger Cloud](https://console.cloud.tigerdata.com/) and create a
   PostgreSQL service with TimescaleDB enabled. Choose a region near your server.
2. Save the service credentials and copy its PostgreSQL connection URI.
3. Copy `server/.env.example` to `server/.env` if it does not exist, then set the
   existing AI keys and `DATABASE_URL`:

   ```dotenv
   DATABASE_URL=postgres://USER:PASSWORD@HOST:PORT/tsdb?sslmode=verify-full
   ```

   Use the actual host, port, database, and credentials from Tiger Cloud. URL-encode
   special characters in passwords. TLS defaults to certificate verification for
   remote hosts; localhost defaults to no TLS. Keep this URL server-side.
4. From `conversational-ai/`, initialize the schema and hypertable:

   ```bash
   npm run db:migrate -- --timescale
   npm run dev
   ```

   This creates `analytics.events` and its reporting views. The migration is
   transactional and repeatable. The TimescaleDB option requires the extension
   to be available and an account allowed to create/enable it. Plain PostgreSQL
   development databases can use `npm run db:migrate` without `--timescale`.
5. Complete a voice session and run:

   ```bash
   npm run analytics:report
   ```

   The report shows the last seven days of hourly latency and session totals.
   You can also query the views in Tiger Cloud's SQL editor:

   ```sql
   SELECT * FROM analytics.sessions ORDER BY connected_at DESC LIMIT 50;
   SELECT * FROM analytics.turns ORDER BY occurred_at DESC LIMIT 50;
   SELECT * FROM analytics.hourly_latency ORDER BY hour DESC LIMIT 168;
   ```

`analytics.turns` selects the latest metrics snapshot per assistant generation,
so repeated metric updates do not inflate turn counts. Missing measurements stay
NULL. Latency is server-measured; browser playback delay is not sent to the server
and is not included. Session duration covers connection to cleanup; started_at
separately identifies successfully initialized voice sessions. User utterances
count finalized transcription events, including any provider duplicates.

Writes are batched every second
with a maximum queue of 1,000 events. Failed batches retain their IDs and retry
without duplicate inserts; overflow drops new events. `/health` includes queue,
drop, failure, and last-write status. Voice callbacks enqueue analytics without
awaiting writes; PostgreSQL writes are asynchronous.
This is best-effort telemetry: process crashes or a sustained outage can lose
queued events. Graceful shutdown attempts to flush within the server's 12-second
shutdown window. Events are retained until explicitly deleted; no automatic
retention policy or public analytics API is enabled.

Run the isolated analytics tests with `npm run test:analytics`.

### Conversation and stuttering analytics

`npm run analytics:report` includes one row per conversation for the last seven
days. Query all local records with `SELECT * FROM conversations`. In Tiger Data,
use `analytics.conversations` after running `npm run db:migrate`.

Each row includes the profile `name`, UTC `conversation_date`, `started_at`,
`ended_at`, and `conversation_length_ms` (successful voice initialization to session
cleanup, including pauses and assistant speech). Length stays NULL while active;
old sessions without this measurement also stay NULL. Names are stored as entered
in profile setup, so historical unnamed sessions remain NULL.

| Report column | Identification-loop classification |
|---|---|
| `prolongation_count` | Elongated syllables, such as M[mmm]ommy |
| `block_count` | Identified gasps or stuttered pauses |
| `sound_repetition_count` | Repeated sounds/syllables, such as [pr-pr-pr-]prepared |
| `word_repetition_count` | Repeated words or phrases, such as made [made] |
| `no_stuttered_words_count` | Number of analyzed utterances explicitly confirmed to have none of the five event types |
| `interjection_count` | Identified fillers, including um, uh, or person-specific fillers |

The classifier decides occurrence boundaries (for example, a repeated-sound run
is one event rather than one event per repeated syllable). Interjections are
classified by the loop, including person-specific context; analytics does not
assume every filler or pause is a stutter.

The identification loop is **not implemented yet**. `NoOpSpeechAnalyzer` omits
classification, and reports show `analysis_status = 'not_analyzed'` with NULL
counts. `partial` means only some utterances have results; totals then describe
only those utterances. `complete` means all currently recorded utterances have
results, not that the conversation has ended. `analyzed_utterances` and
`user_utterances` expose coverage.

Implement `SpeechAnalyzer.analyze()` and return `stuttering` along with its
existing fields. The input contains original PCM audio, `sessionId`, and a stable
`utteranceId`. Inject that analyzer as the fifth `VoiceSession` constructor
argument. Its returned assessment is automatically recorded. An independent
identification loop can instead call the same tracker directly:

```ts
analytics.trackStutteringAssessment(sessionId, utteranceId, {
  revision: 1,
  prolongation: 1,
  block: 0,
  soundRepetition: 2,
  wordRepetition: 0,
  interjection: 1,
  noStutteredWords: false,
});
```

Submit a **full cumulative snapshot for one utterance**, not increments. Increase
`revision` when correcting its counts. Reports use the highest revision per
session/utterance, so retries and late older results do not double-count. Only
assessments linked to a recorded user utterance are included. Use nonnegative
integer counts; set `noStutteredWords: true` only when all five counts are zero.
Pending, failed, or uncertain classifications should omit the assessment.
The database file remains tracked by Git as requested.

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
