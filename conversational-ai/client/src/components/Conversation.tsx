import { useVoiceSession } from "../hooks/useVoiceSession";
import { Transcript } from "./Transcript";
import { Controls } from "./Controls";
import { StatusBar } from "./StatusBar";
import { LatencyPanel } from "./LatencyPanel";

export function Conversation() {
  const session = useVoiceSession();

  return (
    <div className="app">
      <header>
        <h1>Conversational Voice AI</h1>
        <p className="subtitle">
          Mic → Scribe → Gemini → ElevenLabs · true streaming · barge-in
        </p>
      </header>

      <StatusBar
        connected={session.connected}
        sessionActive={session.sessionActive}
        statuses={session.statuses}
      />

      <Controls
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
