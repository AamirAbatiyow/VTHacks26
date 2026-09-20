# Vocally

A live speech-coaching room. You talk. A therapist-trained voice talks back. A small model listens to the *sound* of the speech — not the transcript — and the session stays in the conversation.

Built for VTHacks 2026.

## The product

Two modes, one microphone.

- **Conversation** — pick 2, 5, 10, or 15 minutes. Everyday talk. If the model hears a snag, the coach grants time, and the screen says it in large type: *Take your time.*
- **Speech exercises** — Gemini reads age, role, and what feels hard, then names three techniques from a 27-item clinical catalog. Each exercise has its own full SLP prompt.

When the clock runs out, the coach closes the hour and you see that session’s numbers: time together, speaking turns, flagged turns, and which patterns showed up. Nothing is a diagnosis.

## The model we did not ship

The first instinct was a large speech transformer: wav2vec2-XLSR, about **300 million** parameters. It is a serious model. It is also too slow and too heavy for a coaching loop that has to answer in the same breath.

We A/B tested it against a **1.31 million**-parameter CNN we trained ourselves — about **230× smaller**. The transformer never left the lab. The CNN is what runs in the room.

That choice is the whole architecture: keep the reply path thin, and put measurement beside it, not in front of it.

## What the numbers said

Trained on [SEP-28k](https://github.com/apple/ml-stuttering-events-dataset) podcast clips of people who stutter. Three of eight shows are gone from the public web; we kept **20,841 clips (74.5%)**, then **20,477** after dropping music, silence, and “unsure.” Class rates barely moved (Block 12.0% → 12.1%), so the subset is representative, not cherry-picked.

Splits are **episode-disjoint**. Same voice in train and test would inflate the score. These numbers are new speakers.

| | ROC-AUC | F1 |
| --- | ---: | ---: |
| Prolongation | 0.882 | 0.478 |
| Block | 0.725 | 0.315 |
| Sound repetition | 0.853 | 0.462 |
| Word repetition | 0.769 | 0.366 |
| Interjection | 0.917 | 0.753 |
| Fluent | 0.793 | 0.782 |
| **Macro** | **0.823** | **0.526** |

Block is the weakest class, as expected: often a silent struggle, and the label annotators agree on least (Fleiss κ **0.11** in the full 28,177-clip audit). Interjection is the strongest: “um” has a consistent sound.

A second architecture — a two-head cascade — was better at the simple question *did anything snag?* and slightly worse at *which kind?*

| Any-stutter gate | Single-head | Two-head |
| --- | ---: | ---: |
| ROC-AUC | 0.798 | **0.815** |
| Accuracy | 71.5% | **73.4%** |

The lift is **+0.017 AUC** (95% CI +0.008 to +0.026, **p = 0.001**) on 2,642 held-out clips. So we ship **both**, each where it wins: the original CNN for event type, the two-head gate for overall fluency.

## Latency is a product decision

Scoring a turn takes **10–40 ms**. The fluency gate adds about **66 ms** per batch. Both run **next to** Gemini, not before it. Spoken reply latency does not move.

That is why the 300M model is in `archive/` and the 1.31M ONNX graph is in the server: a coaching session that waits on a transformer stops being a conversation.

Mic audio is also what the model sees. Transcripts lie about blocks. We never score the words Scribe typed.

## A session, in brief

Browser mic → one Fly.io origin → Scribe (speech-to-text) and the ONNX models in parallel → Gemini with a long SLP system prompt → ElevenLabs voice, picked at random from the free-tier set so it does not sound the same twice.

Barge-in stays, but only for real speech — not a chair, a cough, or the coach leaking through the speakers.

## Run it

```bash
cd conversational-ai
npm install
cp .env.example server/.env   # Gemini + ElevenLabs keys
npm run dev                   # client :5173, server :3001
```

Node 24+. Deploy the whole app from the repo root:

```bash
fly deploy
```

The root Docker image builds client and server together. Express serves the UI, `/health`, and `/ws` from one origin.

Setup detail, analytics, and training live in [`conversational-ai/README.md`](conversational-ai/README.md) and [`ml/stutter/README.md`](ml/stutter/README.md). Research that did not ship — the wav2vec2 baseline, the dashboard prototype, the extra benchmarks — is in [`archive/`](archive/README.md).
