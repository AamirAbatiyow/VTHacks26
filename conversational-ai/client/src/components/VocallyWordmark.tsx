import { useId } from "react";
import artwork from "../assets/speech-therapy-artwork.png";

/** Keep the custom lettering from the original intro in the garden palette. */
export function VocallyWordmark() {
  const filterId = useId();

  return (
    <svg viewBox="445 370 640 215" role="img" aria-label="Vocally" focusable="false">
      <defs>
        <filter id={filterId} colorInterpolationFilters="sRGB">
          <feColorMatrix
            type="matrix"
            values="0 0 0 0 0.208  0 0 0 0 0.353  0 0 0 0 0.314  0 0 20 0 -17.7"
          />
        </filter>
      </defs>
      <image href={artwork} width="1448" height="1086" filter={`url(#${filterId})`} />
    </svg>
  );
}
