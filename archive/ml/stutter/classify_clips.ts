/** Cut non-overlapping 3-second WAV clips and classify with the deployed server model.
 * Run: node --import ./conversational-ai/node_modules/tsx/dist/loader.mjs ml/stutter/classify_clips.ts --audio input.mp3 --out output
 * FFmpeg decodes compressed input; --decoder-library supports a local mpg123 fallback.
 */
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { parseArgs } from 'node:util';
import { createHash } from 'node:crypto';
import { StutterClassifier } from '../../conversational-ai/server/src/analysis/StutterClassifier.js';

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const { values } = parseArgs({ options: {
  audio: { type: 'string' }, out: { type: 'string' }, model: { type: 'string' },
  'decoder-library': { type: 'string' },
} });
if (!values.audio || !values.out) throw new Error('Usage: classify_clips.ts --audio input.mp3 --out output-directory [--model model.onnx] [--decoder-library libmpg123]');
const audio = path.resolve(values.audio);
const out = path.resolve(values.out);
const model = path.resolve(values.model ?? path.join(root, 'conversational-ai/server/models/stutter.onnx'));
const meta = JSON.parse(fs.readFileSync(model.replace(/\.onnx$/, '.json'), 'utf8'));
if (meta.clipSamples !== meta.sampleRate * 3) throw new Error('The selected model must use three-second windows.');
if (!fs.existsSync(model)) throw new Error(`Model is missing: ${model}`);
if (fs.existsSync(out) && fs.readdirSync(out).length) throw new Error(`Output directory is not empty: ${out}. Choose a new directory.`);
fs.mkdirSync(out, { recursive: true });
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'vocally-clips-'));

function readWav(file: string) {
  const wav = fs.readFileSync(file);
  if (wav.toString('ascii', 0, 4) !== 'RIFF' || wav.toString('ascii', 8, 12) !== 'WAVE') throw new Error('Expected PCM WAV');
  let rate = 0, channels = 0, format = 0, bits = 0;
  let pcm: Buffer | undefined;
  for (let pos = 12; pos + 8 <= wav.length;) {
    const id = wav.toString('ascii', pos, pos + 4), size = wav.readUInt32LE(pos + 4), start = pos + 8;
    if (start + size > wav.length) throw new Error('Truncated WAV chunk');
    if (id === 'fmt ') { format = wav.readUInt16LE(start); channels = wav.readUInt16LE(start + 2); rate = wav.readUInt32LE(start + 4); bits = wav.readUInt16LE(start + 14); }
    if (id === 'data') pcm = wav.subarray(start, start + size);
    pos = start + size + (size % 2);
  }
  if (format !== 1 || bits !== 16 || !rate || !channels || !pcm?.length) throw new Error('Expected non-empty signed 16-bit PCM WAV');
  const frames = Math.floor(pcm.length / (channels * 2));
  const mono = Buffer.alloc(frames * 2);
  for (let i = 0; i < frames; i++) {
    let sum = 0;
    for (let c = 0; c < channels; c++) sum += pcm.readInt16LE((i * channels + c) * 2);
    mono.writeInt16LE(Math.round(sum / channels), i * 2);
  }
  return { mono, rate, frames };
}
function writeWav(file: string, pcm: Buffer, rate: number) {
  const header = Buffer.alloc(44);
  header.write('RIFF'); header.writeUInt32LE(36 + pcm.length, 4); header.write('WAVEfmt ', 8);
  header.writeUInt32LE(16, 16); header.writeUInt16LE(1, 20); header.writeUInt16LE(1, 22);
  header.writeUInt32LE(rate, 24); header.writeUInt32LE(rate * 2, 28); header.writeUInt16LE(2, 32); header.writeUInt16LE(16, 34);
  header.write('data', 36); header.writeUInt32LE(pcm.length, 40);
  fs.writeFileSync(file, Buffer.concat([header, pcm]));
}
async function main() {
  let decoded = audio;
  let decoder = 'PCM WAV';
  if (path.extname(audio).toLowerCase() !== '.wav') {
    decoded = path.join(temp, 'decoded.wav');
    const command = values['decoder-library'] ? 'python3' : 'ffmpeg';
    const args = values['decoder-library']
      ? [path.join(root, 'ml/stutter/decode_mp3.py'), '--audio', audio, '--out', decoded, '--library', values['decoder-library']]
      : ['-nostdin', '-v', 'error', '-i', audio, '-c:a', 'pcm_s16le', decoded];
    const result = spawnSync(command, args, { encoding: 'utf8' });
    if (result.error || result.status !== 0) throw new Error(`Audio decoding failed: ${result.error?.message ?? result.stderr}. Install FFmpeg or supply --decoder-library with a local mpg123 library.`);
    decoder = values['decoder-library'] ? 'mpg123' : 'ffmpeg';
  }
  const { mono, rate, frames } = readWav(decoded);
  const clipFrames = rate * 3;
  const classifier = new StutterClassifier(model);
  const rows = [];
  for (let start = 0, index = 1; start < frames; start += clipFrames, index++) {
    const actualFrames = Math.min(clipFrames, frames - start);
    const pcm = Buffer.alloc(clipFrames * 2);
    mono.copy(pcm, 0, start * 2, (start + actualFrames) * 2);
    const filename = `clip_${String(index).padStart(3, '0')}.wav`;
    writeWav(path.join(out, filename), pcm, rate);
    const analysis = await classifier.classify(pcm, rate);
    if (!classifier.enabled) throw new Error('Classifier failed to load. See the preceding model error.');
    const detected = analysis?.events.filter(e => e.detected).map(e => e.label) ?? [];
    rows.push({ clip: filename, startSeconds: start / rate, endSeconds: (start + actualFrames) / rate,
      paddedSeconds: (clipFrames - actualFrames) / rate,
      status: analysis ? 'classified' : 'below_silence_gate', detected, analysis });
    console.log(`${filename} [${(start / rate).toFixed(1)}–${((start + actualFrames) / rate).toFixed(3)}s]: ${analysis ? detected.join(', ') || 'No label above threshold' : 'Below silence gate'}`);
  }
  const counts = Object.fromEntries(meta.labels.map((label: string) => [label, rows.filter(row => row.detected.includes(label)).length]));
  const report = { source: audio, model, modelSha256: createHash('sha256').update(fs.readFileSync(model)).digest('hex'), decoder,
    sampleRate: rate, modelSampleRate: meta.sampleRate, resampling: 'Server classifier linear resampling',
    durationSeconds: frames / rate, clipSeconds: 3, thresholds: meta.thresholds,
    totalClips: rows.length, classifiedClips: rows.filter(row => row.analysis).length,
    clipsAboveThreshold: counts, notes: ['Non-overlapping clips; final clip is zero-padded.', 'Independent labels may overlap. Scores are model outputs, not verified labels.', 'Low-energy clips are saved but skipped by the server silence gate.'], clips: rows };
  fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(report, null, 2) + '\n');
  const columns = ['clip', 'start_seconds', 'end_seconds', 'padded_seconds', 'status', 'detected', ...meta.labels, 'fluency'];
  const csvRows = rows.map(row => [row.clip, row.startSeconds, row.endSeconds, row.paddedSeconds, row.status, row.detected.join(';'), ...meta.labels.map((label: string) => row.analysis?.events.find(e => e.label === label)?.probability ?? ''), row.analysis?.fluency ?? '']);
  const csv = (v: unknown) => `"${String(v).replaceAll('"', '""')}"`;
  fs.writeFileSync(path.join(out, 'results.csv'), [columns, ...csvRows].map(row => row.map(csv).join(',')).join('\n') + '\n');
  console.log(JSON.stringify({ totalClips: rows.length, clipsAboveThreshold: counts, output: out }, null, 2));
}
main().catch(error => { console.error(error); process.exitCode = 1; }).finally(() => fs.rmSync(temp, { recursive: true, force: true }));
