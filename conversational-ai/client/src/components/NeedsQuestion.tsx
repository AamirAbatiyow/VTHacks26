import "./NeedsQuestion.css";

export const practiceDescriptions = [
  "I get stuck or repeat words",
  "Some sounds are hard to say",
  "I speak faster than I want to",
  "Finding the right words is hard",
  "I want to feel more confident",
  "I’m still figuring it out",
] as const;

const unsure = practiceDescriptions[5];

interface Props {
  goals: string[];
  description: string;
  onGoalsChange: (goals: string[]) => void;
  onDescriptionChange: (description: string) => void;
}

/** General descriptions keep this step approachable without asking for a diagnosis. */
export function NeedsQuestion({ goals, description, onGoalsChange, onDescriptionChange }: Props) {
  function toggleGoal(goal: string) {
    if (goals.includes(goal)) {
      onGoalsChange(goals.filter((current) => current !== goal));
    } else {
      onGoalsChange(goal === unsure ? [goal] : [...goals.filter((current) => current !== unsure), goal]);
    }
  }

  const descriptionHint = goals.length === 1 && goals[0] !== unsure
    ? "What is a moment when this feels difficult?"
    : "What would you like to feel more comfortable doing?";

  return (
    <div className="needs-question">
      <fieldset className="needs-question__choices">
        <legend className="visually-hidden">Choose the descriptions that feel right for you</legend>
        {practiceDescriptions.map((goal) => (
          <label key={goal} className="needs-question__choice">
            <input type="checkbox" checked={goals.includes(goal)} onChange={() => toggleGoal(goal)} />
            <span className="needs-question__check" aria-hidden="true">
              <svg viewBox="0 0 16 16" width="13" height="13" fill="none">
                <path d="m3 8 3 3 7-7" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" />
              </svg>
            </span>
            <span>{goal}</span>
          </label>
        ))}
      </fieldset>
      <div className="needs-question__detail">
        <label htmlFor="setup-description">A little more, in your own words <span>(optional)</span></label>
        <textarea
          id="setup-description"
          name="needsDescription"
          rows={3}
          value={description}
          onChange={(event) => onDescriptionChange(event.target.value)}
          maxLength={1000}
          placeholder={descriptionHint}
          aria-describedby="needs-description-hint"
        />
        <div className="needs-question__detail-footer">
          <p id="needs-description-hint">A word, a sentence, a small example. It all helps.</p>
          <span aria-label={`${description.length} of 1000 characters`}>{description.length} / 1000</span>
        </div>
      </div>
    </div>
  );
}
