import { useEffect, useRef } from "react";
import { SimulationIcon } from "./SimulationIcon";
const steps = [
  { title: "Make this space yours.", text: "Choose Conversation for everyday talk, or Speech Exercises to practice a technique chosen for you. Conversation needs a time first — 2, 5, 10, or 15 minutes.", note: "When time is up, we close the session and show how it went.", icon: "spark" as const },
  { title: "Find a comfortable pace.", text: "Use Speed to choose how quickly subtitles appear. The microphone button lets you mute yourself whenever you need a pause.", note: "The optional camera is a private mirror, visible only to you.", icon: "speed" as const },
  { title: "Begin with a little hello.", text: "Select Start session when you’re ready. The contours gently pulse while Vocally speaks, and the words appear just below.", note: "You can reopen this guide with “A quick tour.”", icon: "sound" as const },
];
export function SimulationGuide({ open, step, onStepChange, onDismiss }: { open: boolean; step: number; onStepChange: (step: number) => void; onDismiss: () => void }) {
  const dialog = useRef<HTMLDialogElement>(null);
  const nextButton = useRef<HTMLButtonElement>(null);
  const current = steps[step]!;
  useEffect(() => {
    if (open && !dialog.current?.open) dialog.current?.showModal();
    else if (!open && dialog.current?.open) dialog.current.close();
  }, [open]);
  useEffect(() => { if (open) nextButton.current?.focus(); }, [open, step]);
  return <dialog ref={dialog} className="simulation-guide" aria-labelledby="simulation-guide-title" aria-describedby="simulation-guide-description" onCancel={event => { event.preventDefault(); onDismiss(); }}>
    <div className="simulation-guide__top"><span className="simulation-guide__icon"><SimulationIcon name={current.icon} /></span><span>A little introduction · {step + 1} / 3</span><button type="button" onClick={onDismiss} aria-label="Close introduction">×</button></div>
    <h2 id="simulation-guide-title">{current.title}</h2><p id="simulation-guide-description">{current.text}</p><p className="simulation-guide__note">{current.note}</p>
    <div className="simulation-guide__dots" aria-hidden="true">{steps.map((_, index) => <i key={index} data-active={step === index} />)}</div>
    <div className="simulation-guide__actions"><button type="button" onClick={onDismiss}>Skip tour</button><div>{step > 0 && <button type="button" onClick={() => onStepChange(step - 1)}>Back</button>}<button ref={nextButton} type="button" className="simulation-guide__next" onClick={() => step === 2 ? onDismiss() : onStepChange(step + 1)}>{step === 2 ? "Let’s begin" : "Next"}<span aria-hidden="true">→</span></button></div></div>
  </dialog>;
}
