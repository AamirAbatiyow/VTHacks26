import { useEffect, useRef, useState, type FormEvent } from "react";
import type { SessionConfig, UserRole } from "@shared/events";
import { VocallyWordmark } from "./VocallyWordmark";
import { RoleQuestion } from "./RoleQuestion";

interface StutterModelOption {
  id: string;
  label: string;
}

const steps = [
  { key: "name", label: "Your name", title: "What’s your name?", hint: "Every voice has a story. Let’s start with your name.", placeholder: "Type your name here" },
  { key: "role", label: "Your role", title: "What role best suits you?", hint: "Choose the lily pad that feels closest to you.", placeholder: "" },
] as const;

interface Props {
  active: boolean;
  onComplete: (config: SessionConfig) => void;
}

export function ProfileSetup({ active, onComplete }: Props) {
  const [step, setStep] = useState(0);
  const [name, setName] = useState("");
  const [role, setRole] = useState<UserRole | undefined>();
  const [error, setError] = useState("");
  const [stutterModels, setStutterModels] = useState<StutterModelOption[]>([]);
  const [stutterModel, setStutterModel] = useState<string>("");
  const inputRef = useRef<HTMLInputElement>(null);
  const headingRef = useRef<HTMLHeadingElement>(null);
  const question = steps[step]!;

  useEffect(() => {
    if (!active) return;
    if (steps[step]?.key === "role") headingRef.current?.focus({ preventScroll: true });
    else inputRef.current?.focus({ preventScroll: true });
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
    if (question.key === "name" && !name.trim()) {
      setError("Please enter the name you’d like us to use.");
      inputRef.current?.focus();
      return;
    }
    if (question.key === "role" && !role) {
      setError("Please choose the role that best suits you.");
      headingRef.current?.focus();
      return;
    }
    setError("");
    if (step < steps.length - 1) {
      setStep((current) => current + 1);
      return;
    }
    onComplete({
      childName: name.trim(),
      userRole: role,
      stutterModel: stutterModel || undefined,
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
          <p className="profile-setup__step"><span aria-hidden="true" />{question.key === "role" ? "One last thing" : "Let’s get to know you"}</p>
          <h2 id="setup-title" ref={headingRef} tabIndex={-1}>
            {step === 0 ? <>What’s your<br /><em>name?</em></> : <>What role<br /><em>best suits you?</em></>}
          </h2>
          <p className="profile-setup__hint" id="setup-hint">{question.hint}</p>
          {question.key === "role" ? (
            <RoleQuestion
              value={role}
              invalid={Boolean(error)}
              onChange={(value) => { setRole(value); setError(""); }}
            />
          ) : (<>
          <label className="visually-hidden" htmlFor="setup-answer">{question.label}</label>
          <input
            ref={inputRef}
            id="setup-answer"
            name={question.key}
            className="profile-setup__input"
            value={name}
            onChange={(event) => {
              setName(event.target.value);
              setError("");
            }}
            placeholder={question.placeholder}
            autoComplete="given-name"
            maxLength={64}
            required
            aria-invalid={Boolean(error)}
            aria-describedby={error ? "setup-hint setup-error" : "setup-hint"}
          />
          </>)}
          <p className="profile-setup__error" id="setup-error" role="alert">{error}</p>
          {question.key === "name" && <p className="profile-setup__reassurance">No rush. We’re here to listen.</p>}
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
            Continue
            <svg viewBox="0 0 24 24" width="20" height="20" fill="none" aria-hidden="true">
              <path d="M4 12h15m-6-6 6 6-6 6" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
            </svg>
          </button>
        </div>
      </footer>
    </form>
  );
}
