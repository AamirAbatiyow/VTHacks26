import { test } from "node:test";
import assert from "node:assert/strict";
import { computeFrequencySummary, computeSessionFrequency } from "./frequency.js";
import type { PracticeSession } from "./practiceHistory.js";

function session(overrides: Partial<PracticeSession> & { id: string; startedAt: string }): PracticeSession {
  return {
    seconds: 60,
    turns: 10,
    mode: "conversation",
    source: "server",
    ...overrides,
  } as PracticeSession;
}

test("computeSessionFrequency divides flags by words, never guessing a rate with no denominator", () => {
  const withWords = session({
    id: "s1", startedAt: "2026-01-01T00:00:00Z",
    analysis: { analyzedTurns: 10, flaggedTurns: 4, words: 100,
      categories: { Prolongation: 2, Block: 1, SoundRep: 1, WordRep: 0, Interjection: 0 } },
  });
  const row = computeSessionFrequency(withWords);
  assert.equal(row.flagCount, 4);
  assert.equal(row.words, 100);
  assert.equal(row.frequencyPercent, 4);

  const noAnalysis = session({ id: "s2", startedAt: "2026-01-02T00:00:00Z" });
  const row2 = computeSessionFrequency(noAnalysis);
  assert.equal(row2.frequencyPercent, null);
  assert.equal(row2.flagCount, 0);

  const analyzedButNoWords = session({
    id: "s3", startedAt: "2026-01-03T00:00:00Z",
    analysis: { analyzedTurns: 5, flaggedTurns: 1, words: 0,
      categories: { Prolongation: 1, Block: 0, SoundRep: 0, WordRep: 0, Interjection: 0 } },
  });
  // A real flag with zero words on record must not divide-by-zero into 0 or Infinity — it's "unknown."
  assert.equal(computeSessionFrequency(analyzedButNoWords).frequencyPercent, null);
});

test("computeFrequencySummary aggregates, orders oldest-first, and derives an honest trend", () => {
  const sessions: PracticeSession[] = [
    session({ id: "s2", startedAt: "2026-01-08T00:00:00Z",
      analysis: { analyzedTurns: 10, flaggedTurns: 2, words: 100,
        categories: { Prolongation: 1, Block: 1, SoundRep: 0, WordRep: 0, Interjection: 0 } } }),
    session({ id: "s1", startedAt: "2026-01-01T00:00:00Z",
      analysis: { analyzedTurns: 10, flaggedTurns: 8, words: 100,
        categories: { Prolongation: 4, Block: 2, SoundRep: 1, WordRep: 1, Interjection: 0 } } }),
    session({ id: "s3", startedAt: "2026-01-10T00:00:00Z" }), // never analyzed
  ];

  const { sessions: rows, summary } = computeFrequencySummary(sessions);
  assert.deepEqual(rows.map(r => r.sessionId), ["s1", "s2", "s3"]); // oldest-first despite input order
  assert.equal(summary.sessionCount, 3);
  assert.equal(summary.analyzedSessionCount, 2);
  assert.equal(summary.totalWords, 200);
  assert.equal(summary.totalFlags, 10);
  assert.equal(summary.overallFrequencyPercent, 5);
  assert.equal(summary.totalsByCategory.Prolongation, 5);
  assert.equal(summary.trend.direction, "improving"); // 8% -> 2%
  assert.equal(summary.trend.earlierAvgPercent, 8);
  assert.equal(summary.trend.laterAvgPercent, 2);
});

test("computeFrequencySummary reports insufficient_data instead of inventing a trend from one analyzed session", () => {
  const sessions: PracticeSession[] = [
    session({ id: "s1", startedAt: "2026-01-01T00:00:00Z",
      analysis: { analyzedTurns: 4, flaggedTurns: 1, words: 40,
        categories: { Prolongation: 1, Block: 0, SoundRep: 0, WordRep: 0, Interjection: 0 } } }),
  ];
  const { summary } = computeFrequencySummary(sessions);
  assert.equal(summary.trend.direction, "insufficient_data");
  assert.equal(summary.trend.earlierAvgPercent, null);
});
