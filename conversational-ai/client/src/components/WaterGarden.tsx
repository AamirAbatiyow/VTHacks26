import { useEffect, useId, useRef, useState } from "react";
import waterGarden from "../assets/water-garden-illustration.png";
import "./WaterGarden.css";

type WaterGardenProps = {
  active: boolean;
};

type LilyPad = {
  id: string;
  label: string;
  x: number;
  y: number;
  rx: number;
  ry: number;
};

// Pad centers and waterlines share the illustration's original coordinate system.
const LILY_PADS: LilyPad[] = [
  { id: "upper-left", label: "upper left", x: 0, y: 124, rx: 195, ry: 123 },
  { id: "left", label: "left", x: 0, y: 446, rx: 184, ry: 135 },
  { id: "upper-right", label: "large upper right", x: 1485, y: 49, rx: 362, ry: 220 },
  { id: "right", label: "small upper right", x: 1548, y: 248, rx: 122, ry: 87 },
  { id: "lotus-left", label: "left of the lotus", x: 1106, y: 748, rx: 160, ry: 72 },
  { id: "lotus-right", label: "below the lotus", x: 1500, y: 852, rx: 133, ry: 59 },
];

type PadRipple = { id: number; pad: LilyPad };
const MAX_RIPPLES = 6;

/** Automatic water movement and gentle, keyboard-accessible lily-pad ripples. */
export function WaterGarden({ active }: WaterGardenProps) {
  const highlightId = useId();
  const gardenRef = useRef<HTMLDivElement>(null);
  const rippleId = useRef(0);
  const rippleTimers = useRef(new Map<number, number>());
  const [ripples, setRipples] = useState<PadRipple[]>([]);
  const [visiblePads, setVisiblePads] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    const garden = gardenRef.current;
    if (!garden || !active) return;

    // The scene is cropped on narrow screens: do not tab to offscreen pads.
    const observer = new IntersectionObserver(
      (entries) => {
        setVisiblePads((current) => {
          const next = new Set(current);
          for (const entry of entries) {
            const id = (entry.target as HTMLElement).dataset.padId;
            if (!id) continue;
            if (entry.isIntersecting && entry.intersectionRatio >= 0.02) {
              next.add(id);
            } else {
              next.delete(id);
            }
          }
          return next;
        });
      },
      { root: garden, threshold: [0, 0.02] },
    );

    garden.querySelectorAll("[data-pad-id]").forEach((pad) => observer.observe(pad));
    return () => observer.disconnect();
  }, [active]);

  useEffect(() => {
    const timers = rippleTimers.current;
    if (!active) setRipples([]);
    return () => {
      timers.forEach((timer) => window.clearTimeout(timer));
      timers.clear();
    };
  }, [active]);

  function rippleAround(pad: LilyPad) {
    if (!active) return;
    const id = ++rippleId.current;
    const timers = rippleTimers.current;

    if (timers.size >= MAX_RIPPLES) {
      const oldestId = timers.keys().next().value;
      if (oldestId !== undefined) {
        window.clearTimeout(timers.get(oldestId));
        timers.delete(oldestId);
      }
    }

    setRipples((current) => [...current, { id, pad }].slice(-MAX_RIPPLES));
    timers.set(id, window.setTimeout(() => {
      timers.delete(id);
      setRipples((current) => current.filter((ripple) => ripple.id !== id));
    }, 3300));
  }

  return (
    <div ref={gardenRef} className="water-garden" data-moving={active ? "true" : "false"}>
      <div className="water-garden__scene">
        <img className="water-garden__art" src={waterGarden} alt="" draggable="false" />
        <svg
          className="water-garden__currents"
          viewBox="0 0 1586 992"
          preserveAspectRatio="xMidYMid slice"
          focusable="false"
          aria-hidden="true"
        >
          <defs>
            <linearGradient id={highlightId} x1="0" y1="0" x2="1" y2="1">
              <stop offset="0" stopColor="#ffffff" stopOpacity="0.1" />
              <stop offset="0.36" stopColor="#ffffff" stopOpacity="0.85" />
              <stop offset="0.74" stopColor="#effbf9" stopOpacity="0.65" />
              <stop offset="1" stopColor="#ffffff" stopOpacity="0" />
            </linearGradient>
          </defs>
          <g className="water-garden__sheen" stroke={`url(#${highlightId})`}>
            <path d="M -20 641 C 130 670 180 755 368 773 C 560 778 728 701 961 858 C 1190 1013 1400 887 1620 954" />
            <path d="M 188 47 C 283 87 361 144 298 208 C 218 290 126 269 171 348 C 192 384 280 419 325 468" />
          </g>
          <g
            className="water-garden__flow water-garden__flow--left"
            stroke={`url(#${highlightId})`}
          >
            <path d="M 144 -16 C 220 64 348 80 353 168 C 363 235 218 227 173 277 C 96 373 278 398 359 459 C 436 516 416 567 381 616 C 326 691 429 731 572 728" />
            <path d="M 195 85 C 275 120 290 169 244 201 C 223 216 155 232 143 266 C 96 373 222 420 283 469 C 371 541 283 600 329 670 C 373 736 492 744 576 734" />
          </g>
          <g
            className="water-garden__flow water-garden__flow--lower"
            stroke={`url(#${highlightId})`}
          >
            <path d="M -35 688 C 143 668 212 785 324 834 C 442 891 563 807 729 847 C 887 884 944 956 1091 960 C 1188 965 1219 935 1267 909" />
            <path d="M 137 694 C 270 813 415 736 584 735 C 758 714 846 770 932 814 C 1049 875 1192 842 1306 891 C 1431 945 1517 947 1620 942" />
            <path d="M -17 901 C 53 812 166 798 189 850 C 220 902 123 834 107 888 C 81 979 235 962 316 936 C 479 869 617 871 726 915 C 785 942 819 980 856 1017" />
            <path d="M 1300 310 C 1332 366 1468 330 1608 390" />
          </g>
          <ellipse className="water-garden__ripple" cx="240" cy="853" rx="137" ry="26" />
          <ellipse className="water-garden__ripple water-garden__ripple--later" cx="1361" cy="346" rx="144" ry="22" />
        </svg>

        {LILY_PADS.map((pad) => (
          <button
            key={pad.id}
            type="button"
            className="water-garden__pad"
            data-pad-id={pad.id}
            aria-label={`Make a ripple around the lily pad ${pad.label}`}
            disabled={!active || !visiblePads.has(pad.id)}
            onClick={() => rippleAround(pad)}
            style={{
              left: `${((pad.x - pad.rx) / 1586) * 100}%`,
              top: `${((pad.y - pad.ry) / 992) * 100}%`,
              width: `${((pad.rx * 2) / 1586) * 100}%`,
              height: `${((pad.ry * 2) / 992) * 100}%`,
            }}
          />
        ))}

        <svg
          className="water-garden__touch-ripples"
          viewBox="0 0 1586 992"
          focusable="false"
          aria-hidden="true"
        >
          {ripples.map(({ id, pad }) => (
            <g key={id} transform={`translate(${pad.x} ${pad.y})`}>
              <ellipse className="water-garden__touch-ring" cx="0" cy="0" rx={pad.rx + 7} ry={pad.ry + 7} />
              <ellipse className="water-garden__touch-ring water-garden__touch-ring--echo" cx="0" cy="0" rx={pad.rx + 7} ry={pad.ry + 7} />
            </g>
          ))}
        </svg>
      </div>
    </div>
  );
}
