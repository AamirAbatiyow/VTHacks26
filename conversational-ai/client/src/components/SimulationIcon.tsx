type IconName = "sidebar" | "play" | "stop" | "speed" | "mic" | "mic-off" | "camera" | "camera-off" | "help" | "chart" | "spark" | "sound" | "captions";
export function SimulationIcon({ name }: { name: IconName }) {
  return <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    {name === "sidebar" && <><rect x="3" y="4" width="18" height="16" rx="3" /><path d="M9 4v16m5-11 3 3-3 3" /></>}
    {name === "play" && <path d="m9 5 10 7-10 7V5Z" />}
    {name === "stop" && <rect x="6" y="6" width="12" height="12" rx="2" />}
    {name === "speed" && <><path d="M4 18a9 9 0 1 1 16 0M12 5v2M5 10l2 1m12-1-2 1m-5 4 3-6" /><circle cx="12" cy="15" r="1.5" /></>}
    {(name === "mic" || name === "mic-off") && <><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M6 11v1a6 6 0 0 0 12 0v-1m-6 7v3m-3 0h6" />{name === "mic-off" && <path d="m3 3 18 18" />}</>}
    {(name === "camera" || name === "camera-off") && <><rect x="3" y="6" width="12" height="12" rx="2" /><path d="m15 10 6-3v10l-6-3" />{name === "camera-off" && <path d="m3 3 18 18" />}</>}
    {name === "help" && <><circle cx="12" cy="12" r="9" /><path d="M9.5 9a2.5 2.5 0 0 1 5 .5c0 2-2.5 2-2.5 4m0 3h.01" /></>}
    {name === "chart" && <><path d="M4 4v16h16M8 15v-4m5 4V7m5 8v-6" /></>}
    {name === "spark" && <path d="M12 2c0 7-3 10-10 10 7 0 10 3 10 10 0-7 3-10 10-10-7 0-10-3-10-10Z" />}
    {name === "sound" && <path d="M4 10v4m4-7v10m4-13v16m4-13v10m4-7v4" />}
    {name === "captions" && <><rect x="3" y="5" width="18" height="14" rx="3" /><path d="M11 10H8v4h3m7-4h-3v4h3" /></>}
  </svg>;
}
