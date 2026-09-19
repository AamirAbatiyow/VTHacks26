import { useEffect, useRef, useState, type FormEvent } from "react";
import type { SessionConfig } from "@shared/events";
import { VocallyWordmark } from "./VocallyWordmark";
import { NeedsQuestion } from "./NeedsQuestion";

const steps = [
  { key: "name", label: "Your name", title: "What’s your name?", hint: "Every voice has a story. Let’s start with your name.", placeholder: "Type your name here" },
  { key: "needs", label: "Your needs", title: "What best describes you?", hint: "Choose what feels familiar. You can pick more than one, or tell us below.", placeholder: "" },
  { key: "age", label: "Your age", title: "How old are you?", hint: "A little context helps us find your pace. This one is optional.", placeholder: "Your age" },
  { key: "interests", label: "Your interests", title: "What makes you smile?", hint: "Share a few things you love, separated by commas.", placeholder: "Music, dinosaurs, football…" },
  { key: "target", label: "Practice target", title: "What shall we practice?", hint: "A sound or word you’d like to work on. You can also leave this blank.", placeholder: "A sound like /r/, or a favorite word" },
] as const;

interface Props {
  active: boolean;
  onComplete: (config: SessionConfig) => void;
}

export function ProfileSetup({ active, onComplete }: Props) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState({ name: "", age: "", interests: "", target: "" });
  const [error, setError] = useState("");
  const [practiceGoals, setPracticeGoals] = useState<string[]>([]);
  const [needsDescription, setNeedsDescription] = useState("");
  const inputRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const question = steps[step]!;

  useEffect(() => {
    if (!active) return;
    if (steps[step]?.key === "needs") headingRef.current?.focus({ preventScroll: true });
    else inputRef.current?.focus({ preventScroll: true });
  }, [active, step]);

  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (question.key === "name" && !answers.name.trim()) {
      setError("Please enter the name you’d like us to use.");
      inputRef.current?.focus();
      return;
    }
    if (question.key === "age" && answers.age.trim()) {
      const age = Number(answers.age);
      if (!Number.isInteger(age) || age < 1 || age > 120) {
        setError("Please enter a whole number from 1 to 120, or leave this blank.");
        inputRef.current?.focus();
        return;
      }
    }
    setError("");
    if (step < steps.length - 1) {
      setStep((current) => current + 1);
      return;
    }
    onComplete({
      childName: answers.name.trim(),
      age: answers.age.trim() ? Number(answers.age) : undefined,
      interests: answers.interests.split(",").map((interest) => interest.trim()).filter(Boolean),
      targetPhoneme: answers.target.trim() || undefined,
      practiceGoals: practiceGoals.length ? practiceGoals : undefined,
      needsDescription: needsDescription.trim() || undefined,
    });
  }

  return (
    <form className="profile-setup" data-step={question.key} onSubmit={submit} noValidate>
      <header className="profile-setup__header">
        <span className="profile-setup__brand"><VocallyWordmark /></span>
        <div className="profile-setup__header-detail">
          <span className="profile-setup__eyebrow">A little about you</span>
        </div>
      </header>

      <div className="profile-setup__main">
        <div className="profile-setup__question" key={question.key}>
          <p className="profile-setup__step"><span aria-hidden="true" />{question.key === "needs" ? "A little understanding goes a long way" : "Let’s get to know you"}</p>
          <h2 id="setup-title" ref={headingRef} tabIndex={-1}>
            {step === 0 ? <>What’s your<br /><em>name?</em></> : question.key === "needs" ? <>What best<br /><em>describes you?</em></> : question.title}
          </h2>
          <p className="profile-setup__hint" id="setup-hint">{question.hint}</p>
          {question.key === "needs" ? (
            <NeedsQuestion
              goals={practiceGoals}
              description={needsDescription}
              onGoalsChange={setPracticeGoals}
              onDescriptionChange={setNeedsDescription}
            />
          ) : (<>
          <label className="visually-hidden" htmlFor="setup-answer">{question.label}</label>
          <input
            ref={inputRef}
            id="setup-answer"
            name={question.key}
            className="profile-setup__input"
            value={answers[question.key]}
            onChange={(event) => {
              setAnswers((current) => ({ ...current, [question.key]: event.target.value }));
              setError("");
            }}
            placeholder={question.placeholder}
            autoComplete={question.key === "name" ? "given-name" : "off"}
            inputMode={question.key === "age" ? "numeric" : "text"}
            maxLength={question.key === "interests" ? 256 : 64}
            required={question.key === "name"}
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "setup-hint setup-error" : "setup-hint"}
          />
          </>)}
          <p className="profile-setup__error" id="setup-error" role="alert">{error}</p>
          <p className="profile-setup__reassurance">{question.key === "needs" ? "There’s no right answer. We’ll find your pace together." : "No rush. We’re here to listen."}</p>
        </div>
      </div>

      <footer className="profile-setup__footer">
        <div className="profile-setup__progress">
          <div
            className="profile-setup__progress-track"
            role="progressbar"
            aria-label="Setup progress"
            aria-valuemin={0}
            aria-valuemax={steps.length}
            aria-valuenow={step + 1}
            aria-valuetext={`Step ${step + 1} of ${steps.length}: ${question.label}`}
          >
            <span style={{ width: `${((step + 1) / steps.length) * 100}%` }} />
          </div>
          <span className="profile-setup__count" aria-live="polite">
            <strong>0{step + 1}</strong><span aria-hidden="true"> / </span>
            <span className="visually-hidden"> of </span>0{steps.length}
            <span className="profile-setup__progress-label">Your beginning</span>
          </span>
        </div>
        <span className="profile-setup__pace">Touch a lily pad. Watch it ripple.</span>
        <div className="profile-setup__actions">
          {step > 0 && (
            <button
              type="button"
              className="profile-setup__back"
              onClick={() => { setError(""); setStep((current) => current - 1); }}
            >Back</button>
          )}
          <button type="submit" className="profile-setup__continue">
            {step === steps.length - 1 ? "Finish setup" : "Continue"}
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
              <path d="M4 12h15m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </footer>
    </form>
  );
}
