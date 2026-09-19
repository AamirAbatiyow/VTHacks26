/** Expression scores are classifier outputs, not a measure of a person's mood. */
export const expressionLabels = ['neutral', 'happy', 'sad', 'angry', 'fear', 'disgust', 'surprise'] as const;
export type Expression = typeof expressionLabels[number];
export interface ExpressionScore { emotion: Expression; score: number }
export interface FaceResult { boxScore: number; emotion?: ExpressionScore[] }
export interface ExpressionResult { face: FaceResult[]; error?: string | null }
export interface ExpressionSummary { label: Expression | null; scores: ExpressionScore[]; message: string }

export function summarizeExpressions(result: ExpressionResult): ExpressionSummary {
  if (result.error) return { label: null, scores: [], message: 'Analysis unavailable. Try restarting the camera.' };
  if (result.face.length === 0) return { label: null, scores: [], message: 'No face detected. Face the camera in good light.' };
  if (result.face.length !== 1) return { label: null, scores: [], message: 'Keep one person in the frame.' };
  const face = result.face[0]!;
  if (!Number.isFinite(face.boxScore) || face.boxScore < 0.6) return { label: null, scores: [], message: 'Face detection is uncertain. Adjust your position or lighting.' };
  const scores = (face.emotion ?? []).filter(s => expressionLabels.includes(s.emotion) && Number.isFinite(s.score) && s.score >= 0 && s.score <= 1).sort((a, b) => b.score - a.score);
  const top = scores[0];
  // These are conservative display heuristics, not calibrated accuracy guarantees.
  if (!top || top.score < 0.6 || top.score - (scores[1]?.score ?? 0) < 0.15) {
    return { label: null, scores, message: 'Expression uncertain' };
  }
  return { label: top.emotion, scores, message: 'Expression estimate' };
}
