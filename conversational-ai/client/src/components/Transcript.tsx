import type { TranscriptEntry } from "../hooks/useVoiceSession";
import { Waveform } from "./Waveform";

interface Props {
  entries: TranscriptEntry[];
  interimText: string;
  assistantStreaming: string;
}

export function Transcript({
  entries,
  interimText,
  assistantStreaming,
}: Props) {
  return (
    <div className="transcript">
      <h2>Conversation</h2>
      {entries.length === 0 && !interimText && !assistantStreaming && (
        <p className="muted">Start a conversation and speak…</p>
      )}
      {entries.map((e) => (
        <div key={e.id} className={`turn turn-${e.role}`}>
          <div className="role">{e.role === "user" ? "USER" : "AI"}</div>
          <div className="text">
            {e.text}
            {e.interrupted ? (
              <span className="interrupted"> (interrupted)</span>
            ) : null}
          </div>
          {e.role === "user" && e.signal ? (
            <Waveform signal={e.signal} />
          ) : null}
        </div>
      ))}
      {interimText ? (
        <div className="turn turn-user">
          <div className="role">USER</div>
          <div className="text interim">{interimText}</div>
        </div>
      ) : null}
      {assistantStreaming ? (
        <div className="turn turn-assistant">
          <div className="role">AI</div>
          <div className="text streaming">{assistantStreaming}</div>
        </div>
      ) : null}
    </div>
  );
}
