import { useId, type CSSProperties } from "react";
import "./TherapyTopography.css";

interface TherapyTopographyProps {
  speaking: boolean;
  previewing?: boolean;
}

interface Point { x: number; y: number }

/** Smooth closed contours give the voice a landscape, without suggesting a face. */
function contourPath(layer: number): string {
  const radius = 18 + layer * 16.9;
  const progress = layer / 29;
  const points: Point[] = Array.from({ length: 96 }, (_, index) => {
    const angle = (index / 96) * Math.PI * 2;
    const terrain = 1
      + 0.115 * Math.sin(angle * 3 + 0.45 + progress * 0.45)
      + 0.067 * Math.cos(angle * 2 - 0.8)
      + 0.041 * Math.sin(angle * 5 + 1.5 - progress * 0.35)
      + 0.018 * Math.cos(angle * 7 + progress * 0.7);
    return {
      x: 518 + Math.sin(progress * 2.1) * 25 + Math.cos(angle) * radius * terrain * 1.17,
      y: 294 - progress * 16 + Math.sin(angle) * radius * terrain * 0.86,
    };
  });
  let path = `M ${points[0].x.toFixed(2)} ${points[0].y.toFixed(2)}`;
  for (let index = 0; index < points.length; index += 1) {
    const before = points[(index + points.length - 1) % points.length];
    const current = points[index];
    const next = points[(index + 1) % points.length];
    const after = points[(index + 2) % points.length];
    path += ` C ${(current.x + (next.x - before.x) / 6).toFixed(2)} ${(current.y + (next.y - before.y) / 6).toFixed(2)}, ${(next.x - (after.x - current.x) / 6).toFixed(2)} ${(next.y - (after.y - current.y) / 6).toFixed(2)}, ${next.x.toFixed(2)} ${next.y.toFixed(2)}`;
  }
  return `${path} Z`;
}

const CONTOURS = Array.from({ length: 30 }, (_, index) => ({
  index,
  path: contourPath(index),
  weight: index % 5 === 0 ? 2.35 : index % 3 === 0 ? 1.3 : 0.7,
  opacity: index % 5 === 0 ? 0.69 : index % 3 === 0 ? 0.51 : 0.38,
}));

export function TherapyTopography({ speaking, previewing = false }: TherapyTopographyProps) {
  const id = useId().replace(/:/g, "");
  const active = speaking || previewing;

  return (
    <div className="therapy-topography" data-speaking={active} aria-hidden="true">
      <svg className="therapy-topography__map" viewBox="0 0 1040 588" preserveAspectRatio="xMidYMid slice" focusable="false">
        <defs>
          <linearGradient id={`${id}-contour`} x1="0" y1="0" x2="0.85" y2="1">
            <stop offset="0%" stopColor="#77a4a5" />
            <stop offset="42%" stopColor="#709d90" />
            <stop offset="75%" stopColor="#91b4a0" />
            <stop offset="100%" stopColor="#81acb9" />
          </linearGradient>
          <radialGradient id={`${id}-land`} cx="51%" cy="48%" r="63%">
            <stop offset="0%" stopColor="#b3d9c0" stopOpacity="0.35" />
            <stop offset="38%" stopColor="#c8e5d3" stopOpacity="0.27" />
            <stop offset="75%" stopColor="#d5e9ea" stopOpacity="0.2" />
            <stop offset="100%" stopColor="#edf5f2" stopOpacity="0" />
          </radialGradient>
          <radialGradient id={`${id}-heart`}>
            <stop offset="0%" stopColor="#9cccb8" stopOpacity="0.32" />
            <stop offset="100%" stopColor="#b7ded2" stopOpacity="0" />
          </radialGradient>
        </defs>
        <path d={CONTOURS[29].path} fill={`url(#${id}-land)`} />
        <ellipse className="therapy-topography__heart" cx="521" cy="294" rx="158" ry="139" fill={`url(#${id}-heart)`} />
        {[...CONTOURS].reverse().map(({ index, path, weight, opacity }) => (
          <g
            key={index}
            className={`therapy-topography__contour${index % 5 === 0 ? " therapy-topography__contour--major" : ""}`}
            style={{
              "--contour-delay": `${-index * 0.15}s`,
              "--contour-duration": `${5.8 + (index % 4) * 0.3}s`,
              "--contour-opacity": opacity,
            } as CSSProperties}
          >
            <path
              d={path}
              fill={index % 5 === 0 ? "#cbe3d8" : "none"}
              fillOpacity="0.045"
              stroke={`url(#${id}-contour)`}
              strokeWidth={weight}
              vectorEffect="non-scaling-stroke"
              strokeLinejoin="round"
            />
          </g>
        ))}
      </svg>
      <div className="therapy-topography__edge" />
    </div>
  );
}
