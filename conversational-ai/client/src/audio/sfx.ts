import padTap from "../assets/sfx/pad-tap.mp3";
import padSelect from "../assets/sfx/pad-select.mp3";
import whoosh from "../assets/sfx/whoosh.mp3";
import step from "../assets/sfx/step.mp3";
import select from "../assets/sfx/select.mp3";
import begin from "../assets/sfx/begin.mp3";
import settle from "../assets/sfx/settle.mp3";
import sparkle from "../assets/sfx/sparkle.mp3";

export type SfxName =
  | "pad-tap"
  | "pad-select"
  | "whoosh"
  | "step"
  | "select"
  | "begin"
  | "settle"
  | "sparkle";

const SRC: Record<SfxName, string> = {
  "pad-tap": padTap,
  "pad-select": padSelect,
  whoosh,
  step,
  select,
  begin,
  settle,
  sparkle,
};

const VOLUME: Partial<Record<SfxName, number>> = {
  sparkle: 0.18,
};

const players = new Map<SfxName, HTMLAudioElement>();

function player(name: SfxName): HTMLAudioElement {
  const existing = players.get(name);
  if (existing) return existing;
  const audio = new Audio(SRC[name]);
  audio.preload = "auto";
  audio.volume = VOLUME[name] ?? 0.28;
  players.set(name, audio);
  return audio;
}

export function playSfx(name: SfxName): void {
  if (typeof document === "undefined" || document.hidden) return;
  try {
    const audio = player(name);
    audio.currentTime = 0;
    void audio.play().catch(() => undefined);
  } catch {
    /* missing file or autoplay block must not break the UI */
  }
}
