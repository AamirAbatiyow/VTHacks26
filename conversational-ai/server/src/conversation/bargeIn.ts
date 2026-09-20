const FILLERS = new Set([
  "um", "uh", "uhm", "hmm", "hm", "ah", "oh", "er", "erm",
  "mhm", "mm", "mmm", "yeah", "yep", "yup", "ok", "okay",
  "so", "like", "and", "the", "a", "uhhuh",
]);

const BARGE_WORDS = new Set(["wait", "stop", "hold", "hey", "hang"]);

function normalize(text: string): string {
  return text.toLowerCase().replace(/[^a-z'\s]/g, " ").replace(/\s+/g, " ").trim();
}

function contentWords(text: string): string[] {
  return normalize(text)
    .split(" ")
    .filter((word) => word.length > 1 && !FILLERS.has(word));
}

/**
 * True when an interim transcript looks like the speaker is taking the floor,
 * not a Scribe hallucination, filler, or the assistant leaking back in.
 */
export function looksLikeBargeIn(interim: string, assistantText = ""): boolean {
  const words = contentWords(interim);
  if (words.length === 0) return false;
  if (looksLikeAssistantEcho(interim, assistantText)) return false;
  if (words.some((word) => BARGE_WORDS.has(word))) return true;
  if (words.length >= 2) return true;
  return (words[0]?.length ?? 0) >= 5;
}

function looksLikeAssistantEcho(interim: string, assistantText: string): boolean {
  const spoken = normalize(interim);
  const assistant = normalize(assistantText);
  if (spoken.length < 4 || assistant.length < 4) return false;
  if (assistant.includes(spoken)) return true;

  const spokenWords = spoken.split(" ").filter((word) => word.length > 2);
  if (spokenWords.length === 0) return false;
  const assistantWords = new Set(assistant.split(" ").filter((word) => word.length > 2));
  const overlap = spokenWords.filter((word) => assistantWords.has(word)).length;
  return overlap >= Math.max(2, Math.ceil(spokenWords.length * 0.65));
}
