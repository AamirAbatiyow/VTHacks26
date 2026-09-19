import { useEffect, useRef, useState, type FormEvent } from "react";
import type { SessionConfig } from "@shared/events";

interface StutterModelOption {
  id: string;
  label: string;
}

const steps = [
  { key: "name", label: "Your name", title: "What's your name?", hint: "The name you’d like us to use.", placeholder: "Your name" },
  { key: "age", label: "Your age", title: "How old are you?", hint: "Optional. You can leave this blank.", placeholder: "Your age" },
  { key: "interests", label: "Your interests", title: "What do you enjoy?", hint: "A few things you like talking about, separated by commas.", placeholder: "Music, dinosaurs, football…" },
  { key: "target", label: "Practice target", title: "What would you like to practice?", hint: "Optional. A sound or word you’d like to work on.", placeholder: "/r/, /s/, or a word" },
] as const;

interface Props {
  active: boolean;
  onComplete: (config: SessionConfig) => void;
}

export function ProfileSetup({ active, onComplete }: Props) {
  const [step, setStep] = useState(0);
  const [answers, setAnswers] = useState({ name: "", age: "", interests: "", target: "" });
  const [error, setError] = useState("");
  const [stutterModels, setStutterModels] = useState<StutterModelOption[]>([]);
  const [stutterModel, setStutterModel] = useState<string>("");
  const inputRef = useRef<HTMLInputElement>(null);
  const question = steps[step]!;

  useEffect(() => {
    if (active) inputRef.current?.focus({ preventScroll: true });
  }, [active, step]);

  useEffect(() => {
    let cancelled = false;
    fetch("/stutter-models")
      .then((res) => (res.ok ? res.json() : Promise.reject(new Error(`status ${res.status}`))))
      .then((data: { models?: StutterModelOption[]; defaultId?: string }) => {
        if (cancelled) return;
        const models = data.models ?? [];
        setStutterModels(models);
        if (data.defaultId) {
          setStutterModel(data.defaultId);
        } else if (models[0]) {
          setStutterModel(models[0].id);
        }
      })
      .catch(() => {
        // No model list available (e.g. server not reachable yet) — proceed without a selection.
      });
    return () => {
      cancelled = true;
    };
  }, []);

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
      stutterModel: stutterModel || undefined,
    });
  }

  return (
    <form className="profile-setup" onSubmit={submit} noValidate>
      <header className="profile-setup__header">
        <span className="profile-setup__brand" aria-label="Vocally">Vocally</span>
        <span className="profile-setup__eyebrow">A little about you</span>
      </header>

      <div className="profile-setup__main">
        <div className="profile-setup__question" key={question.key}>
          <p className="profile-setup__step">Let’s get to know you</p>
          <h2 id="setup-title">
            {step === 0 ? <>What’s your<br />name?</> : question.title}
          </h2>
          <p className="profile-setup__hint" id="setup-hint">{question.hint}</p>
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
          <p className="profile-setup__error" id="setup-error" role="alert">{error}</p>
        </div>

        {step === steps.length - 1 && stutterModels.length > 0 && (
          <div className="profile-setup__model">
            <label className="profile-setup__model-label" htmlFor="setup-stutter-model">
              Detection model
            </label>
            <select
              id="setup-stutter-model"
              className="profile-setup__model-select"
              value={stutterModel}
              onChange={(event) => setStutterModel(event.target.value)}
            >
              {stutterModels.map((model) => (
                <option key={model.id} value={model.id}>
                  {model.label}
                </option>
              ))}
            </select>
          </div>
        )}
      </div>

      <footer className="profile-setup__footer">
        <div className="profile-setup__progress">
          <span className="profile-setup__count" aria-live="polite">Step {step + 1} of {steps.length}</span>
          <ol aria-label="Setup progress">
            {steps.map((item, index) => (
              <li
                key={item.key}
                className={index <= step ? "is-complete" : ""}
                aria-current={index === step ? "step" : undefined}
              >
                <span className="visually-hidden">{item.label}</span>
              </li>
            ))}
          </ol>
        </div>
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
