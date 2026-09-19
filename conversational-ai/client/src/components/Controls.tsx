import type { SessionConfig } from "@shared/events";

interface Props {
  initialConfig?: SessionConfig | null;
  sessionActive: boolean;
  canInterrupt: boolean;
  onStart: (config: SessionConfig) => void;
  onEnd: () => void;
  onInterrupt: () => void;
}

export function Controls({ initialConfig, sessionActive, canInterrupt, onStart, onEnd, onInterrupt }: Props) {
  return (
    <div className="controls">
      <p className="session-profile">
        <strong>{initialConfig?.childName || "Your practice"}</strong>
        {initialConfig?.userRole && <span>{initialConfig.userRole}</span>}
      </p>
      <div className="buttons">
        {!sessionActive ? (
          <button
            className="primary"
            type="button"
            onClick={() => onStart(initialConfig ?? {})}
          >Start Conversation</button>
        ) : (
          <button className="danger" type="button" onClick={onEnd}>End Conversation</button>
        )}
        <button type="button" disabled={!canInterrupt} onClick={onInterrupt}>
          Interrupt AI
        </button>
      </div>
    </div>
  );
}
