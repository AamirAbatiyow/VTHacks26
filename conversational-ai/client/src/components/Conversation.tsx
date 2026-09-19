import { useVoiceSession } from "../hooks/useVoiceSession";
import { Transcript } from "./Transcript";
import { Controls } from "./Controls";
import { StatusBar } from "./StatusBar";
import { LatencyPanel } from "./LatencyPanel";
import { FacialExpressions } from "./FacialExpressions";
import type { SessionConfig } from "@shared/events";

export function Conversation({ initialConfig }: { initialConfig?: SessionConfig | null }) {
  const session = useVoiceSession();

  return (
    <div className="app" id="conversation" tabIndex={-1}>
      <header>
        <h2 id="practice-title">Speech practice</h2>
        <p className="subtitle">
          A space to practice, one conversation at a time.
        </p>
      </header>

      <StatusBar
        connected={session.connected}
        sessionActive={session.sessionActive}
        statuses={session.statuses}
      />

      <Controls
        initialConfig={initialConfig}
        sessionActive={session.sessionActive}
        canInterrupt={Boolean(session.activeGenerationId)}
        onStart={(cfg) => void session.startConversation(cfg)}
        onEnd={session.endConversation}
        onInterrupt={session.manualInterrupt}
      />

      {session.error ? <div className="error-banner">{session.error}</div> : null}

      <div className="main-grid">
        <Transcript
          entries={session.transcripts}
          interimText={session.interimText}
          assistantStreaming={session.assistantStreaming}
        />
        <div className="side">
          <FacialExpressions />
          <LatencyPanel metrics={session.metrics} />
          <div className="logs">
            <h2>Logs</h2>
            <pre>
              {session.logs.length === 0
                ? "—"
                : session.logs.slice(-40).join("\n")}
            </pre>
          </div>
        </div>
      </div>

      <footer className="echo-note">
        <strong>Echo note:</strong> browser echoCancellation + noiseSuppression
        are enabled. Headphones work best for testing barge-in. The mic may still
        pick up speaker audio in open-air setups — a full AEC is out of MVP
        scope.
      </footer>
    </div>
  );
}
