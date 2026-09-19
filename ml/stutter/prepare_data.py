"""
Build a local SEP-28k clip corpus.

For each podcast episode: download -> decode to 16 kHz mono -> slice the labeled
3 s clips -> drop the episode audio. Only the clips are kept, so peak disk usage
stays around the size of one episode per worker.

Output (in --out):
    clips.i16   flat int16 memmap, CLIP_SAMPLES per clip
    meta.csv    one row per stored clip, aligned with clips.i16 row order
"""

import argparse
import csv
import os
import shutil
import subprocess
import sys
import tempfile
import threading
from concurrent.futures import ThreadPoolExecutor
from pathlib import Path

import numpy as np

SAMPLE_RATE = 16000
CLIP_SECONDS = 3
CLIP_SAMPLES = SAMPLE_RATE * CLIP_SECONDS

LABEL_COLS = [
    "Unsure",
    "PoorAudioQuality",
    "Prolongation",
    "Block",
    "SoundRep",
    "WordRep",
    "DifficultToUnderstand",
    "Interjection",
    "NoStutteredWords",
    "NaturalPause",
    "Music",
    "NoSpeech",
]

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0 Safari/537.36"


def read_episodes(path: Path):
    episodes = []
    for line in path.read_text().splitlines():
        if not line.strip():
            continue
        parts = [p.strip() for p in line.split(", ")]
        if len(parts) < 5:
            continue
        episodes.append({"url": parts[2], "show": parts[-2], "ep": parts[-1]})
    return episodes


def read_labels(path: Path):
    by_episode: dict[tuple[str, str], list[dict]] = {}
    with path.open() as f:
        for row in csv.DictReader(f):
            row = {k.strip(): (v.strip() if isinstance(v, str) else v) for k, v in row.items()}
            key = (row["Show"], row["EpId"])
            by_episode.setdefault(key, []).append(row)
    for rows in by_episode.values():
        rows.sort(key=lambda r: int(r["ClipId"]))
    return by_episode


def fetch_episode(url: str, dest_wav: Path) -> bool:
    """Download and decode one episode to 16 kHz mono 16-bit wav."""
    suffix = next((e for e in (".mp3", ".m4a", ".mp4") if e in url), ".mp3")
    with tempfile.NamedTemporaryFile(suffix=suffix, delete=False) as tmp:
        raw = Path(tmp.name)
    try:
        dl = subprocess.run(
            ["curl", "-sS", "-L", "--max-time", "900", "--retry", "2",
             "-A", UA, "-o", str(raw), url],
            capture_output=True,
        )
        if dl.returncode != 0 or raw.stat().st_size < 100_000:
            return False
        conv = subprocess.run(
            ["ffmpeg", "-nostdin", "-v", "error", "-y", "-i", str(raw),
             "-ac", "1", "-ar", str(SAMPLE_RATE), "-c:a", "pcm_s16le", str(dest_wav)],
            capture_output=True,
        )
        return conv.returncode == 0 and dest_wav.exists() and dest_wav.stat().st_size > 1000
    finally:
        raw.unlink(missing_ok=True)


def read_wav_i16(path: Path) -> np.ndarray:
    from scipy.io import wavfile

    rate, audio = wavfile.read(path)
    assert rate == SAMPLE_RATE, f"unexpected rate {rate}"
    if audio.ndim > 1:
        audio = audio[:, 0]
    return audio.astype(np.int16)


def process_episode(ep: dict, rows: list[dict], work_dir: Path):
    """Return (clips_int16_array, meta_rows) for one episode, or (None, [])."""
    wav_path = work_dir / f"{ep['show']}_{ep['ep']}.wav"
    try:
        if not fetch_episode(ep["url"], wav_path):
            return None, []
        audio = read_wav_i16(wav_path)
    except Exception:
        wav_path.unlink(missing_ok=True)
        return None, []
    finally:
        pass

    clips, meta = [], []
    n = len(audio)
    for row in rows:
        start, stop = int(row["Start"]), int(row["Stop"])
        if start < 0 or start >= n:
            continue
        seg = audio[start:stop]
        if len(seg) < CLIP_SAMPLES // 2:
            continue
        if len(seg) < CLIP_SAMPLES:
            seg = np.pad(seg, (0, CLIP_SAMPLES - len(seg)))
        clips.append(seg[:CLIP_SAMPLES])
        meta.append(
            {"Show": row["Show"], "EpId": row["EpId"], "ClipId": row["ClipId"],
             **{c: row[c] for c in LABEL_COLS}}
        )

    wav_path.unlink(missing_ok=True)
    if not clips:
        return None, []
    return np.stack(clips), meta


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--dataset", required=True, help="ml-stuttering-events-dataset root")
    ap.add_argument("--out", required=True)
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--shows", default="", help="comma-separated show filter")
    ap.add_argument("--detach", action="store_true",
                    help="daemonize so the run survives the launching shell")
    args = ap.parse_args()

    if args.detach:
        # Double-fork + setsid: the download outlives whatever shell started it.
        if os.fork() > 0:
            return
        os.setsid()
        if os.fork() > 0:
            os._exit(0)
        sys.stdout.flush()

    root = Path(args.dataset)
    out = Path(args.out)
    out.mkdir(parents=True, exist_ok=True)
    work_dir = out / "_work"
    work_dir.mkdir(exist_ok=True)

    episodes = read_episodes(root / "SEP-28k_episodes.csv")
    labels = read_labels(root / "SEP-28k_labels.csv")
    if args.shows:
        keep = {s.strip() for s in args.shows.split(",")}
        episodes = [e for e in episodes if e["show"] in keep]

    episodes = [e for e in episodes if (e["show"], e["ep"]) in labels]

    # Resume: skip episodes already present in meta.csv and truncate clips.i16
    # to exactly match, so an interrupted run never leaves the two out of sync.
    meta_path, clips_path = out / "meta.csv", out / "clips.i16"
    done_eps, n_done = set(), 0
    if meta_path.exists() and clips_path.exists():
        rows = list(csv.DictReader(open(meta_path)))
        n_done = len(rows)
        done_eps = {(r["Show"], r["EpId"]) for r in rows}
        with open(clips_path, "r+b") as f:
            f.truncate(n_done * CLIP_SAMPLES * 2)
    skipped = [e for e in episodes if (e["show"], e["ep"]) in done_eps]
    episodes = [e for e in episodes if (e["show"], e["ep"]) not in done_eps]
    print(f"resuming: {len(skipped)} episodes / {n_done} clips already done; "
          f"{len(episodes)} to fetch", flush=True)

    fresh = n_done == 0
    clip_file = open(clips_path, "ab")
    meta_file = open(meta_path, "a", newline="")
    writer = csv.DictWriter(meta_file, fieldnames=["Show", "EpId", "ClipId"] + LABEL_COLS)
    if fresh:
        writer.writeheader()

    lock = threading.Lock()
    done = {"ep": 0, "clips": 0, "fail": 0}

    def run(ep):
        clips, meta = process_episode(ep, labels[(ep["show"], ep["ep"])], work_dir)
        with lock:
            done["ep"] += 1
            if clips is None:
                done["fail"] += 1
            else:
                clip_file.write(clips.tobytes())
                writer.writerows(meta)
                clip_file.flush()
                meta_file.flush()
                done["clips"] += len(clips)
            print(f"[{done['ep']}/{len(episodes)}] {ep['show']}/{ep['ep']} "
                  f"clips={0 if clips is None else len(clips)} "
                  f"total={done['clips']} failed_eps={done['fail']}", flush=True)

    with ThreadPoolExecutor(max_workers=args.workers) as pool:
        list(pool.map(run, episodes))

    clip_file.close()
    meta_file.close()
    shutil.rmtree(work_dir, ignore_errors=True)
    print(f"\nDONE clips={done['clips']} failed_episodes={done['fail']}", flush=True)


if __name__ == "__main__":
    main()
