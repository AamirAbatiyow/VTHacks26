import assert from 'node:assert/strict';
import test from 'node:test';
import { summarizeExpressions } from './expressions';

test('missing faces do not become neutral', () => {
  const result = summarizeExpressions({ face: [] });
  assert.equal(result.label, null);
  assert.deepEqual(result.scores, []);
  assert.match(result.message, /No face/);
});
test('multiple people suppress attribution', () => {
  const face = { boxScore: .9, emotion: [{ emotion: 'happy' as const, score: .99 }] };
  assert.deepEqual(summarizeExpressions({ face: [face, face] }).scores, []);
});
test('ambiguous scores stay uncertain', () => {
  assert.equal(summarizeExpressions({ face: [{ boxScore: .9, emotion: [{ emotion: 'happy', score: .65 }, { emotion: 'neutral', score: .6 }] }] }).label, null);
});
test('weak face detection cannot produce a confident expression', () => {
  assert.equal(summarizeExpressions({ face: [{ boxScore: .4, emotion: [{ emotion: 'happy', score: .99 }] }] }).label, null);
});
test('clear scores produce the corresponding expression without changing input', () => {
  const emotion = [{ emotion: 'neutral' as const, score: .1 }, { emotion: 'happy' as const, score: .85 }];
  const result = summarizeExpressions({ face: [{ boxScore: .9, emotion }] });
  assert.equal(result.label, 'happy');
  assert.equal(result.scores[0]?.score, .85);
  assert.equal(emotion[0]?.emotion, 'neutral');
});
test('invalid scores and model errors cannot produce a confident label', () => {
  assert.equal(summarizeExpressions({ face: [{ boxScore: .9, emotion: [{ emotion: 'happy', score: NaN }, { emotion: 'neutral', score: 2 }] }] }).label, null);
  assert.equal(summarizeExpressions({ face: [], error: 'failed' }).label, null);
});
