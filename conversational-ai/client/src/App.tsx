import { useCallback, useEffect, useRef, useState } from "react";
import { Conversation } from "./components/Conversation";
import { IntroScreen } from "./components/IntroScreen";
import { ProfileSetup } from "./components/ProfileSetup";
import { WaterGarden } from "./components/WaterGarden";
import { Dashboard } from "./components/Dashboard";
import { addPracticeSession, readPracticeHistory, savePracticeHistory, type PracticeSession } from "./progress/practiceHistory";
import type { SessionConfig } from "@shared/events";

export default function App() {
  const [phase, setPhase] = useState<"intro" | "transition" | "practice">("intro");
  const [profile, setProfile] = useState<SessionConfig | null>(null);
  const [showConversation, setShowConversation] = useState(false);
  const [history, setHistory] = useState<PracticeSession[]>([]);
  const historyRef = useRef<PracticeSession[]>([]);
  const [historySaved, setHistorySaved] = useState(true);
  const recordPractice = useCallback((entry: PracticeSession) => {
    const next = addPracticeSession(historyRef.current, entry);
    historyRef.current = next;
    setHistory(next);
    setHistorySaved(savePracticeHistory(profile?.childName ?? "", next));
  }, [profile?.childName]);
  const practiceRef = useRef<HTMLElement>(null);
  const startTransition = useCallback(() => setPhase("transition"), []);
  const finishTransition = useCallback(() => setPhase("practice"), []);

  useEffect(() => {
    if (phase === "practice" && profile) {
      practiceRef.current?.focus({ preventScroll: true });
    }
  }, [phase, profile, showConversation]);

  return (
    <main className="app-shell" data-phase={phase}>
      <h1 className="visually-hidden">Vocally — Speech Therapy</h1>
      {phase !== "practice" && (
        <IntroScreen
          onExitStart={startTransition}
          onExited={finishTransition}
        />
      )}
      <section
        ref={practiceRef}
        className="practice-section"
        aria-labelledby={profile ? (showConversation ? "practice-title" : "welcome-title") : "setup-title"}
        aria-hidden={phase !== "practice"}
        inert={phase !== "practice"}
        tabIndex={-1}
      >
        {!profile && <WaterGarden active={phase === "practice"} />}
        {!profile && (
          <ProfileSetup
            active={phase === "practice"}
            onComplete={(completedProfile) => {
              setProfile(completedProfile);
              const previous = readPracticeHistory(completedProfile.childName ?? "");
              historyRef.current = previous;
              setHistory(previous);
              setShowConversation(true);
            }}
          />
        )}
        {profile && !showConversation && (
          <Dashboard profile={profile} sessions={history} saved={historySaved} onPractice={() => setShowConversation(true)} />
        )}
        {profile && showConversation && (
          <Conversation initialConfig={profile} onSessionComplete={recordPractice} onBack={() => setShowConversation(false)} />
        )}
      </section>
    </main>
  );
}
