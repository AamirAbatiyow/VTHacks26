import { useCallback, useEffect, useRef, useState } from "react";
import artwork from "../assets/speech-therapy-artwork.png";
import backdrop from "../assets/speech-therapy-background.png";

type Phase = "loading" | "entering" | "ready" | "leaving";

interface Props {
  onExitStart: () => void;
  onExited: () => void;
}

export function IntroScreen({ onExitStart, onExited }: Props) {
  const [phase, setPhase] = useState<Phase>("loading");
  const [assetsReady, setAssetsReady] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(
    () => window.matchMedia("(prefers-reduced-motion: reduce)").matches,
  );
  const exitStarted = useRef(false);

  useEffect(() => {
    const preference = window.matchMedia("(prefers-reduced-motion: reduce)");
    const update = () => setReducedMotion(preference.matches);
    preference.addEventListener("change", update);
    return () => preference.removeEventListener("change", update);
  }, []);

  useEffect(() => {
    let cancelled = false;
    // Start the entrance after both layers can paint, even on a cold load.
    void Promise.all(
      [artwork, backdrop].map((src) => {
        const image = new Image();
        image.src = src;
        return image.decode().catch(() => undefined);
      }),
    ).then(() => {
      if (!cancelled) setAssetsReady(true);
    });
    return () => { cancelled = true; };
  }, []);

  useEffect(() => {
    if (phase === "loading" && assetsReady) {
      setPhase(reducedMotion ? "ready" : "entering");
    }
    if (phase === "entering") {
      if (reducedMotion) {
        setPhase("ready");
        return;
      }
      const timer = window.setTimeout(() => {
        setPhase((current) => current === "entering" ? "ready" : current);
      }, 1700);
      return () => window.clearTimeout(timer);
    }
    if (phase === "leaving") {
      if (reducedMotion) {
        onExited();
        return;
      }
      // Fallback if the browser suppresses animationend (e.g. a hidden tab).
      const timer = window.setTimeout(onExited, 1150);
      return () => window.clearTimeout(timer);
    }
  }, [assetsReady, onExited, phase, reducedMotion]);

  const enterPractice = useCallback(() => {
    if (exitStarted.current) return;
    exitStarted.current = true;
    setPhase("leaving");
    onExitStart();
  }, [onExitStart]);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.code !== "Space" && event.key !== "Enter") return;
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey || event.isComposing) return;
      event.preventDefault();
      if (!event.repeat) enterPractice();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [enterPractice]);

  return (
    <div
      className="intro"
      data-phase={phase}
      data-loaded={assetsReady}
      onAnimationEnd={(event) => {
        if (event.target === event.currentTarget && event.animationName === "intro-exit") {
          onExited();
        }
      }}
    >
      <button
        className="intro__enter"
        type="button"
        onClick={enterPractice}
        aria-label="Enter speech practice"
        aria-describedby="intro-instructions"
        aria-disabled={phase === "leaving"}
      >
        <span className="intro__background-exit" aria-hidden="true">
          <img
            className="intro__background"
            src={backdrop}
            alt=""
            width={1448}
            height={1086}
            fetchPriority="high"
          />
        </span>
        <span className="intro__wordmark-position" aria-hidden="true">
          <span className="intro__wordmark-exit">
            <svg
              className="intro__wordmark"
              viewBox="445 370 640 276"
              focusable="false"
              onAnimationEnd={(event) => {
                if (event.target === event.currentTarget && event.animationName === "wordmark-enter") {
                  setPhase((current) => current === "entering" ? "ready" : current);
                }
              }}
            >
              <defs>
                <filter id="white-lettering" colorInterpolationFilters="sRGB">
                  {/* Isolate the original white letters, preserving the custom wordmark. */}
                  <feColorMatrix
                    type="matrix"
                    values="0 0 0 0 1  0 0 0 0 1  0 0 0 0 1  0 0 20 0 -17.7"
                  />
                </filter>
              </defs>
              <image
                href={artwork}
                width="1448"
                height="1086"
                filter="url(#white-lettering)"
              />
            </svg>
          </span>
        </span>
        <span className="intro__hint" id="intro-instructions">
          Click anywhere or press <span className="intro__key">Space</span> to begin
        </span>
      </button>
    </div>
  );
}
