import { useEffect, useRef } from "react";
import { SimulationIcon } from "./SimulationIcon";
import { playSfx } from "../audio/sfx";

const steps = [
  {
    title: "Three ways to practice.",
    text: "Conversation is everyday talk with a timer. Speech Exercises walks you through one technique chosen for you. Endless is the same companionship with no clock — just talk until it is time to rest.",
    note: "Pick a mode in the sidebar whenever you are not in a session. Nothing is better or worse — they are different rooms.",
    icon: "spark" as const,
  },
  {
    title: "A small setup, then start.",
    text: "Conversation needs a length first: 2, 5, 10, or 15 minutes. Speech Exercises asks you to review what feels hard and pick one of three techniques. Endless is ready as soon as you press Start session.",
    note: "The microphone does not open until you start. You can leave the guide here if you already know the way.",
    icon: "play" as const,
  },
  {
    title: "Then you just talk.",
    text: "Subtitles follow Vocally. Mute whenever you need a pause. In Conversation, a blue reminder appears if speech snags. In Endless, a good sentence may float a quiet “Nice!”",
    note: "You can reopen this anytime with “A quick tour” at the bottom of the sidebar.",
    icon: "sound" as const,
  },
];

export function SimulationGuide({
  open,
  step,
  onStepChange,
  onDismiss,
}: {
  open: boolean;
  step: number;
  onStepChange: (step: number) => void;
  onDismiss: () => void;
}) {
  const dialog = useRef<HTMLDialogElement>(null);
  const nextButton = useRef<HTMLButtonElement>(null);
  const skipButton = useRef<HTMLButtonElement>(null);
  const current = steps[step] ?? steps[0]!;
  const last = step >= steps.length - 1;

  useEffect(() => {
    const node = dialog.current;
    if (!node) return;
    if (open && !node.open) node.showModal();
    else if (!open && node.open) node.close();
  }, [open]);

  useEffect(() => {
    if (open) nextButton.current?.focus();
  }, [open, step]);

  return (
    <dialog
      ref={dialog}
      className="simulation-guide"
      aria-labelledby="simulation-guide-title"
      aria-describedby="simulation-guide-description"
      onCancel={(event) => {
        event.preventDefault();
        onDismiss();
      }}
    >
      <div className="simulation-guide__top">
        <span className="simulation-guide__icon"><SimulationIcon name={current.icon} /></span>
        <span>Getting started · {step + 1} / {steps.length}</span>
        <button type="button" onClick={onDismiss} aria-label="Skip the getting-started guide">×</button>
      </div>
      <h2 id="simulation-guide-title">{current.title}</h2>
      <p id="simulation-guide-description">{current.text}</p>
      <p className="simulation-guide__note">{current.note}</p>
      <div className="simulation-guide__dots" aria-hidden="true">
        {steps.map((_, index) => <i key={index} data-active={step === index} />)}
      </div>
      <div className="simulation-guide__actions">
        <button ref={skipButton} type="button" className="simulation-guide__skip" onClick={onDismiss}>Skip</button>
        <div>
          {step > 0 && <button type="button" onClick={() => { playSfx("step"); onStepChange(step - 1); }}>Back</button>}
          <button
            ref={nextButton}
            type="button"
            className="simulation-guide__next"
            onClick={() => {
              if (last) onDismiss();
              else { playSfx("step"); onStepChange(step + 1); }
            }}
          >
            {last ? "Let’s begin" : "Next"}
            <span aria-hidden="true">→</span>
          </button>
        </div>
      </div>
    </dialog>
  );
}
