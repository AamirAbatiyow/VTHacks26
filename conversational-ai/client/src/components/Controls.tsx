import { useEffect, useState } from "react";
import type { SessionConfig } from "@shared/events";

interface Props {
  initialConfig?: SessionConfig | null;
  sessionActive: boolean;
  canInterrupt: boolean;
  onStart: (config: SessionConfig) => void;
  onEnd: () => void;
  onInterrupt: () => void;
}

export function Controls({
  initialConfig,
  sessionActive,
  canInterrupt,
  onStart,
  onEnd,
  onInterrupt,
}: Props) {
  const [childName, setChildName] = useState("Alex");
  const [age, setAge] = useState("9");
  const [interests, setInterests] = useState("Minecraft, dinosaurs");
  const [targetPhoneme, setTargetPhoneme] = useState("/r/");

  useEffect(() => {
    if (!initialConfig) return;
    setChildName(initialConfig.childName ?? "");
    setAge(initialConfig.age == null ? "" : String(initialConfig.age));
    setInterests(initialConfig.interests?.join(", ") ?? "");
    setTargetPhoneme(initialConfig.targetPhoneme ?? "");
  }, [initialConfig]);

  return (
    <div className="controls">
      <div className="config-grid">
        <label>
          Child name
          <input
            value={childName}
            onChange={(e) => setChildName(e.target.value)}
            disabled={sessionActive}
          />
        </label>
        <label>
          Age
          <input
            value={age}
            onChange={(e) => setAge(e.target.value)}
            disabled={sessionActive}
            inputMode="numeric"
          />
        </label>
        <label className="span-2">
          Interests (comma-separated)
          <input
            value={interests}
            onChange={(e) => setInterests(e.target.value)}
            disabled={sessionActive}
          />
        </label>
        <label className="span-2">
          Practice target
          <input
            value={targetPhoneme}
            onChange={(e) => setTargetPhoneme(e.target.value)}
            disabled={sessionActive}
            placeholder="/r/"
          />
        </label>
      </div>

      <div className="buttons">
        {!sessionActive ? (
          <button
            className="primary"
            type="button"
            onClick={() =>
              onStart({
                childName: childName.trim() || undefined,
                age: Number(age) || undefined,
                interests: interests
                  .split(",")
                  .map((s) => s.trim())
                  .filter(Boolean),
                targetPhoneme: targetPhoneme.trim() || undefined,
              })
            }
          >
            Start Conversation
          </button>
        ) : (
          <button className="danger" type="button" onClick={onEnd}>
            End Conversation
          </button>
        )}
        <button
          type="button"
          disabled={!canInterrupt}
          onClick={onInterrupt}
          title="Debug: force interrupt (normal barge-in is automatic)"
        >
          Interrupt AI
        </button>
      </div>
    </div>
  );
}
