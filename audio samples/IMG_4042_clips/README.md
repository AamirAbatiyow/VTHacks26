# IMG_4042 classification

Source: `../IMG_4042.mp3` (101.631 seconds of decoded audio).

- 34 consecutive, non-overlapping three-second mono 16-bit WAV files.
- Clip filenames are sequential: `clip_001.wav` starts at 0 seconds,
  `clip_002.wav` at 3 seconds, and so on.
- `clip_034.wav` contains 99.000–101.631 seconds of original audio and
  0.369 seconds of silence padding.
- All 34 clips were classified using the deployed server classifier.
- WAVs retain the decoded 48 kHz rate; the server resamples to 16 kHz for inference.
- CSV includes all six label scores, model fluency, timestamps, and padding.
- JSON includes thresholds, model SHA-256, and complete per-clip analysis.
- Counts describe clips above model thresholds, not individual event counts or verified annotations.

| Label | Clips above threshold |
| --- | ---: |
| Prolongation | 4 |
| Block | 2 |
| SoundRep | 0 |
| WordRep | 14 |
| Interjection | 5 |
| Fluent | 28 |

Labels are independent, so multiple labels can appear on the same clip.
Fluent and event labels can both exceed their thresholds.

Reproduce from the repository root using the local decoder available on this Mac:

```bash
node --import ./conversational-ai/node_modules/tsx/dist/loader.mjs \
  ml/stutter/classify_clips.ts \
  --audio "audio samples/IMG_4042.mp3" \
  --out "audio samples/IMG_4042_clips_rerun" \
  --decoder-library /Applications/zoom.us.app/Contents/Frameworks/libmpg123_mac.bundle/Contents/MacOS/libmpg123_mac
```

With FFmpeg installed, omit `--decoder-library`.
