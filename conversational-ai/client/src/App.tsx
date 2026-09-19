import { useCallback, useEffect, useRef, useState } from "react";
import { Conversation } from "./components/Conversation";
import { IntroScreen } from "./components/IntroScreen";
import { ProfileSetup } from "./components/ProfileSetup";
import { WaterGarden } from "./components/WaterGarden";
import { Dashboard } from "./components/Dashboard";
import type { SessionConfig } from "@shared/events";

export default function App() {
  const [phase, setPhase] = useState<"intro" | "transition" | "practice">("intro");
  const [profile, setProfile] = useState<SessionConfig | null>(null);
  const [showConversation, setShowConversation] = useState(false);
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
            onComplete={setProfile}
          />
        )}
        {profile && !showConversation && (
          <Dashboard profile={profile} onPractice={() => setShowConversation(true)} onProfileChange={setProfile} />
        )}
        {profile && showConversation && (
          <Conversation initialConfig={profile} onBack={() => setShowConversation(false)} />
        )}
      </section>
    </main>
  );
}
