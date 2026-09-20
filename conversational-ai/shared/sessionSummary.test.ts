import { test } from "node:test";
import assert from "node:assert/strict";
import { SessionSummaryCollector, countWords, ANALYSIS_LABELS } from "./sessionSummary.js";
import type { StutterAnalysis } from "./events.js";

function analysis(detected: string[], windows: unknown[] = [{ startMs: 0, endMs: 100 }]): StutterAnalysis {
  const labels = [...ANALYSIS_LABELS, "Fluent"];
  return {
    labels,
    events: labels.map(label => ({ label, probability: detected.includes(label) ? 0.9 : 0.1, detected: detected.includes(label) })),
    windows: windows as StutterAnalysis["windows"],
    fluency: detected.length ? 0.2 : 0.95,
    analyzedMs: 1000,
    inferenceMs: 10,
  };
}

test("countWords tokenizes on whitespace and ignores empty strings", () => {
  assert.equal(countWords("hello world"), 2);
  assert.equal(countWords("  extra   spaces  "), 2);
  assert.equal(countWords(""), 0);
  assert.equal(countWords("   "), 0);
});

test("SessionSummaryCollector sums words only across analyzed turns, not all turns", () => {
  const collector = new SessionSummaryCollector("s1", new Date().toISOString(), "conversation");
  collector.addTurn("t1", countWords("one two three"));   // 3 words, will be analyzed
  collector.addTurn("t2", countWords("four five"));       // 2 words, will be analyzed
  collector.addTurn("t3", countWords("six seven eight nine")); // 4 words, NEVER analyzed
  collector.addAnalysis("t1", analysis(["Prolongation"]));
  collector.addAnalysis("t2", analysis(["Block", "WordRep"]));
  // t3 has no addAnalysis call at all — its words must not count toward the denominator.

  const snapshot = collector.snapshot(30, "server");
  assert.equal(snapshot.turns, 3);
  assert.equal(snapshot.analysis?.analyzedTurns, 2);
  assert.equal(snapshot.analysis?.flaggedTurns, 2);
  assert.equal(snapshot.analysis?.words, 5); // 3 + 2, excluding t3's 4
  assert.equal(snapshot.analysis?.categories.Prolongation, 1);
  assert.equal(snapshot.analysis?.categories.Block, 1);
  assert.equal(snapshot.analysis?.categories.WordRep, 1);
});

test("SessionSummaryCollector ignores analysis for turns with no detection windows (fail-open, not fail-count)", () => {
  const collector = new SessionSummaryCollector("s2", new Date().toISOString(), "conversation");
  collector.addTurn("t1", countWords("some words here"));
  collector.addAnalysis("t1", analysis([], [])); // no windows -> classifier didn't actually analyze it
  const snapshot = collector.snapshot(10, "device");
  assert.equal(snapshot.analysis?.analyzedTurns, 0);
  assert.equal(snapshot.analysis?.words, 0); // t1's words must not leak in despite addTurn being called
});

test("SessionSummaryCollector defaults to zero words when addTurn is called without a count (backward compatible call sites)", () => {
  const collector = new SessionSummaryCollector("s3", new Date().toISOString(), "conversation");
  collector.addTurn("t1");
  collector.addAnalysis("t1", analysis(["Interjection"]));
  const snapshot = collector.snapshot(5, "server");
  assert.equal(snapshot.analysis?.words, 0);
  assert.equal(snapshot.analysis?.flaggedTurns, 1);
});
