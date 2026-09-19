import { useCallback, useEffect, useRef, useState } from "react";
import { Conversation } from "./components/Conversation";
import { IntroScreen } from "./components/IntroScreen";
import { ProfileSetup } from "./components/ProfileSetup";
import type { SessionConfig } from "@shared/events";
import waterGarden from "./assets/water-garden.png";

export default function App() {
  const [phase, setPhase] = useState<"intro" | "transition" | "practice">("intro");
  const [profile, setProfile] = useState<SessionConfig | null>(null);
  const practiceRef = useRef<HTMLElement>(null);
  const startTransition = useCallback(() => setPhase("transition"), []);
  const finishTransition = useCallback(() => setPhase("practice"), []);

  useEffect(() => {
    if (phase === "practice" && profile) {
      practiceRef.current?.focus({ preventScroll: true });
    }
  }, [phase, profile]);

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
        aria-labelledby={profile ? "practice-title" : "setup-title"}
        aria-hidden={phase !== "practice"}
        inert={phase !== "practice"}
        tabIndex={-1}
      >
        <img className="practice-scenery" src={waterGarden} alt="" aria-hidden="true" />
        {!profile && <ProfileSetup active={phase === "practice"} onComplete={setProfile} />}
        <div className="practice-workspace" hidden={!profile}>
          <Conversation initialConfig={profile} />
        </div>
      </section>
    </main>
  );
}
