import type { ProviderStatuses } from "../hooks/useVoiceSession";

interface Props {
  connected: boolean;
  sessionActive: boolean;
  statuses: ProviderStatuses;
}

function Dot({ status }: { status: string }) {
  const cls =
    status === "ready"
      ? "ok"
      : status === "connecting"
        ? "pending"
        : status === "error"
          ? "err"
          : "idle";
  return <span className={`dot ${cls}`} title={status} />;
}

export function StatusBar({ connected, sessionActive, statuses }: Props) {
  return (
    <div className="status-bar">
      <div>
        <Dot status={connected ? "ready" : "idle"} /> Connection:{" "}
        {connected ? (sessionActive ? "session active" : "connected") : "idle"}
      </div>
      <div>
        <Dot status={statuses.scribe} /> STT: {statuses.scribe}
      </div>
      <div>
        <Dot status={statuses.gemini} /> Gemini: {statuses.gemini}
      </div>
      <div>
        <Dot status={statuses.elevenlabs} /> ElevenLabs: {statuses.elevenlabs}
      </div>
    </div>
  );
}
