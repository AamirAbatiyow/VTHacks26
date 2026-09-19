import { useEffect, useMemo, useRef, useState } from "react";
import "./VoiceCaptions.css";

export type CaptionPace = "slow" | "natural" | "quick";

interface VoiceCaptionsProps {
  text: string;
  utteranceId: string;
  speaking: boolean;
  complete?: boolean;
  interrupted?: boolean;
  pace: CaptionPace;
  placeholder?: string;
}

interface CaptionProgress {
  utteranceId: string;
  words: number;
  hasSpoken: boolean;
}

const WORD_INTERVAL: Record<CaptionPace, number> = { slow: 430, natural: 300, quick: 190 };

export function VoiceCaptions({
  text,
  utteranceId,
  speaking,
  complete = !speaking,
  interrupted = false,
  pace,
  placeholder = "Your companion’s words will appear here.",
}: VoiceCaptionsProps) {
  const words = useMemo(() => text.match(/\S+\s*/g) ?? [], [text]);
  const wordsRef = useRef(words);
  const [progress, setProgress] = useState<CaptionProgress>({ utteranceId, words: 0, hasSpoken: false });
  const current = progress.utteranceId === utteranceId
    ? progress
    : { utteranceId, words: 0, hasSpoken: false };
  const visibleCount = Math.min(current.words, words.length);
  const hasBufferedWord = visibleCount < words.length;
  const previousWord = words[visibleCount - 1]?.trim() ?? "";

  useEffect(() => { wordsRef.current = words; }, [words]);

  useEffect(() => {
    setProgress((previous) => {
      const next = previous.utteranceId === utteranceId
        ? previous
        : { utteranceId, words: 0, hasSpoken: false };
      if (speaking && !interrupted && !next.hasSpoken) return { ...next, hasSpoken: true };
      if (!speaking && complete && !interrupted && next.hasSpoken && next.words !== words.length) {
        return { ...next, words: words.length };
      }
      return next;
    });
  }, [utteranceId, speaking, complete, interrupted, words.length]);

  useEffect(() => {
    if (!speaking || interrupted || !hasBufferedWord) return;

    const punctuationPause = /[.!?…][”’"')]*$/.test(previousWord)
      ? 1.85
      : /[,;:—][”’"')]*$/.test(previousWord) ? 1.4 : 1;
    const lengthCadence = Math.min(1.16, 0.86 + previousWord.length * 0.035);
    const delay = visibleCount === 0 ? 70 : WORD_INTERVAL[pace] * punctuationPause * lengthCadence;
    const timer = window.setTimeout(() => {
      setProgress((previous) => {
        if (previous.utteranceId !== utteranceId) return previous;
        return { ...previous, words: Math.min(previous.words + 1, wordsRef.current.length), hasSpoken: true };
      });
    }, delay);

    return () => window.clearTimeout(timer);
  }, [utteranceId, speaking, interrupted, pace, visibleCount, hasBufferedWord, previousWord]);

  const hasVisibleText = visibleCount > 0;
  // Screen readers hear the completed thought once, instead of every animated word.
  const announcement = current.hasSpoken && (interrupted || (!speaking && complete))
    ? interrupted ? words.slice(0, visibleCount).join("").trim() : text
    : "";

  return (
    <div className="voice-captions" data-speaking={speaking && !interrupted}>
      <p className={`voice-captions__text${hasVisibleText ? "" : " voice-captions__text--placeholder"}`} aria-hidden="true">
        {hasVisibleText ? words.slice(0, visibleCount).map((word, index) => (
          <span className="voice-captions__word" key={`${utteranceId}-${index}`}>{word}</span>
        )) : placeholder}
        {speaking && !interrupted && hasVisibleText && <span className="voice-captions__cursor" />}
      </p>
      <span className="voice-captions__announcement" role="status" aria-live="polite" aria-atomic="true">{announcement}</span>
    </div>
  );
}
