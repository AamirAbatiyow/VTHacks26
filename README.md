# Vocally

**Live: [vocally.fit](https://vocally.fit/)** · VTHacks 2026

A live speech-coaching room for people who stutter. You talk, a therapist-trained voice talks back, and a 1.31M-parameter CNN listens to the *sound* of your speech — never the transcript — so the coach can grant you time in the same breath you needed it.

Transcripts lie about blocks: a silent struggle types as nothing at all. Every measurement here runs on raw microphone PCM.

| Mode | What it is | Ends when |
| --- | --- | --- |
| **Conversation** | Everyday talk, 2/5/10/15 min. On a flagged turn the coach answers the *idea* first, then grants time, and the screen says it big: *Take your time.* | Timer |
| **Speech exercises** | Gemini reads age, role, and what feels hard, then picks **3** of **25** techniques, each with its own SLP prompt. | You do |
| **Endless** | No clock. The run closes the moment the model hears a snag — warmly, never as a failure. | First flag |

```
mic (PCM16 16 kHz) ─► Fly.io ─┬─► Scribe v2 STT ──► transcript
                              └─► 2× ONNX models ─► [speech_signal: Block (0.71)]
                                        └─► Gemini 2.5 Flash ─► ElevenLabs TTS ─► barge-in
```

Streaming at every hop, keys server-side, one origin for UI + `/ws` + `/health`.

## The model we did not ship

First instinct was wav2vec2-XLSR, **≈300M parameters**. We A/B tested it against a **1.31M** CNN we trained ourselves — **≈230× smaller** — and the transformer never left the lab. That is the whole architecture in one decision: keep the reply path thin, put measurement *beside* it, not in front of it.

Trained on [SEP-28k](https://github.com/apple/ml-stuttering-events-dataset). Three of eight podcast shows are gone from the public web, so of 28,177 published clips we recovered **20,841 (74.5%)** and used **20,477** after dropping music, silence, and "unsure". Class rates barely moved (Block 11.96% → 12.1%). Splits are **episode-disjoint** — a random split lets the model memorize voices — so every number below is on **held-out speakers** (n = 2,642).

| Class | ROC-AUC | AP | F1 | Support | Annotator Fleiss κ |
| --- | ---: | ---: | ---: | ---: | ---: |
| Prolongation | 0.882 | 0.491 | 0.478 | 227 | 0.254 |
| Block | 0.725 | 0.235 | 0.315 | 295 | **0.112** |
| Sound repetition | 0.853 | 0.463 | 0.462 | 250 | 0.399 |
| Word repetition | 0.769 | 0.351 | 0.366 | 284 | 0.626 |
| Interjection | **0.917** | 0.834 | **0.753** | 673 | 0.574 |
| Fluent | 0.793 | 0.813 | 0.782 | 1,475 | 0.390 |
| **Macro** | **0.823** | **0.531** | **0.526** | | |

Block is weakest and that is the honest result: it is often a *silent* struggle with little energy to key on, and it is the event human raters agree on least. Interjection is strongest — "um" has a consistent signature.

Six independent sigmoids, not a softmax, because ≈3,000 clips carry two or more events. Targets are **soft** — 3 annotators per clip, so $y_c \in \{0,\frac13,\frac23,1\}$ carries their disagreement into the loss, with `pos_weight` capped at 8 and thresholds tuned per class on validation. The STFT and 64-bin mel filterbank are frozen conv/matmul ops **inside the ONNX graph**, so there is zero train/serve feature skew.

### Two models, each where it wins

A two-head cascade ($P(\text{type}) = P(\text{any})\cdot P(\text{type}\mid\text{any})$, shared trunk, one forward pass) is better at *"did anything snag?"* and slightly worse at *"which kind?"*

| Any-stutter gate | Single-head | Two-head |
| --- | ---: | ---: |
| ROC-AUC | 0.798 | **0.815** — +0.017, 95% CI [+0.008, +0.026], **p = 0.001** |
| Accuracy | 71.5% | **73.4%** |

Macro per-type AUC goes the other way (0.823 → 0.814), since stage 2 only sees the 53% of clips that are positive. So we ship **both**: `stutter.onnx` for type, `stutter_gate.onnx` for fluency.

Per turn the server slides 3 s windows at a 1.5 s hop, skips anything under an RMS gate of 0.003 so silence cannot manufacture a positive, and requires **two agreeing windows** plus gate agreement so one noisy slice cannot flag a long sentence:

$$\text{detected}_c = \Big[\textstyle\sum_i \mathbf{1}\big(p_{i,c}\ge\tau_c\big)\cdot\mathbf{1}\big(g_i\ge\tau_g\big)\Big] \ge \min(|W|,2)$$

## Latency is a product decision

Inference is **10–40 ms**, the gate adds **≈66 ms** per batch, and the spoken reply moves by **0 ms**. Marks are measured on monotonic clocks: T0 speech ended → T1 transcript → T2 Gemini → T3 first token → T4 first TTS chunk → T5 first audio byte → T6 playback.

One deliberate exception: classification is **awaited before Gemini starts** so the reply reacts to *this* utterance. An earlier build injected the signal on the *next* turn, which meant Vocally answered the hard moment like any ordinary turn and granted time only afterward — too late to matter.

Scribe commits a turn after **0.75 s** of silence, slower than a consumer agent on purpose: people who stutter hold air mid-thought, and a short threshold calls that "end of turn" and talks over them. Barge-in needs 520 ms of sustained energy at ≥4.2× a live noise floor, a 250–3400 Hz band ratio ≥0.32, and syllable-rate modulation (CV ≥0.12), so a chair, a cough, HVAC, or speaker leak cannot steal the floor. "uh" is deliberately kept as valid barge-in — it can be a stutter, not noise.

## Endless scoring, and the report

Filler must not win, so time and turns only pay out when the language works. Richness is Guiraud's index $G = U/\sqrt{N}$ over content words:

$$C = \tanh\!\left(\frac{G\ln(1+\bar m)\ln(1+\bar L)}{4}\right), \qquad \text{score} = 80\,n^{0.70}\ln\!\left(1+\frac{s}{18}\right)C^{1.40}$$

The $C^{1.40}$ term is what kills filler farming: halving richness costs ~62% of the score.

The practice report is deterministic TypeScript, never an LLM. It reports exactly **one** of the four SSI-4 components — frequency — and says so plainly:

$$F = 100\cdot\frac{\text{flagged utterances}}{\text{words in analyzed turns}}, \qquad |\bar F_{\text{later}} - \bar F_{\text{earlier}}| < 0.5 \Rightarrow \text{flat}$$

Duration, physical concomitants, and naturalness need a clinician in the room, so they are not scored. Missing analysis is reported as missing, never as a zero or a fluent result. Nothing here is a diagnosis.

Technique selection is grounded in **27** SLP passages embedded with Gemini, ranked by cosine similarity plus age and pattern priors, degrading to tag-rank then a heuristic if embedding fails. The model can never invent a technique ID.

## Run it

```bash
cd conversational-ai
npm install
cp .env.example server/.env   # GEMINI_API_KEY + ELEVENLABS_API_KEY
npm run dev                   # client :5173, server :3001
fly deploy                    # from repo root; one image, shared-cpu-1x
```

Node 24+. Tests: `npm run typecheck`, `test:analytics`, `test:progress`, `test:shared`. Analytics default to local SQLite; `DATABASE_URL` switches to Tiger Data PostgreSQL. No audio, transcripts, or free-form text are ever persisted.

More: [`conversational-ai/README.md`](conversational-ai/README.md) (protocol, barge-in, schema) · [`ml/stutter/README.md`](ml/stutter/README.md) (training, export, full comparison) · [`archive/`](archive/README.md) (what didn't ship)

SEP-28k: Lea, Mitra, Joshi, Kajarekar, Bigham, ICASSP 2021 (CC BY-NC 4.0).
