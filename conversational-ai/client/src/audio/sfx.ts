import padTap from "../assets/sfx/pad-tap.mp3";
import padSelect from "../assets/sfx/pad-select.mp3";
import whoosh from "../assets/sfx/whoosh.mp3";
import step from "../assets/sfx/step.mp3";
import select from "../assets/sfx/select.mp3";
import begin from "../assets/sfx/begin.mp3";
import settle from "../assets/sfx/settle.mp3";
import sparkle from "../assets/sfx/sparkle.mp3";
import greeting from "../assets/sfx/greeting.mp3";

export type SfxName =
  | "pad-tap"
  | "pad-select"
  | "whoosh"
  | "step"
  | "select"
  | "begin"
  | "settle"
  | "sparkle"
  | "greeting";

const SRC: Record<SfxName, string> = {
  "pad-tap": padTap,
  "pad-select": padSelect,
  whoosh,
  step,
  select,
  begin,
  settle,
  sparkle,
  greeting,
};

const VOLUME: Partial<Record<SfxName, number>> = {
  sparkle: 0.18,
  greeting: 0.55,
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

/**
 * Session-start greeting. Resolves when playback ends (or immediately if the
 * tab is hidden / play fails) so the mic can stay muted until then.
 */
export function playGreeting(): Promise<void> {
  if (typeof document === "undefined" || document.hidden) return Promise.resolve();
  try {
    const audio = player("greeting");
    audio.currentTime = 0;
    return new Promise((resolve) => {
      const done = () => {
        audio.removeEventListener("ended", done);
        audio.removeEventListener("error", done);
        resolve();
      };
      audio.addEventListener("ended", done);
      audio.addEventListener("error", done);
      void audio.play().catch(done);
    });
  } catch {
    return Promise.resolve();
  }
}
