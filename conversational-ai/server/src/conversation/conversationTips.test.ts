import { test } from "node:test";
import assert from "node:assert/strict";
import { observedPatterns, patternTagsFor, buildRetrievalQuery } from "./conversationTips.js";
import { cosineSimilarity } from "./techniqueRag.js";
import { SLP_STEPHEN_CHUNKS } from "./slpStephenCorpus.js";

test("observedPatterns ranks flagged categories and ignores zeros", () => {
  const rows = observedPatterns({
    analyzedTurns: 6,
    flaggedTurns: 3,
    categories: { Block: 3, Prolongation: 1, SoundRep: 0, WordRep: 0, Interjection: 2 },
  });
  assert.deepEqual(rows.map((row) => row.label), ["Block", "Interjection", "Prolongation"]);
});

test("patternTagsFor adds Rate/Fear from the speaker's own words", () => {
  const tags = patternTagsFor({
    profile: { age: 16, needsDescription: "I rush and then hide the block" },
    analysis: { categories: { Block: 2 } },
  });
  assert.ok(tags.includes("Block"));
  assert.ok(tags.includes("Rate"));
  assert.ok(tags.includes("Fear"));
});

test("retrieval query names the observed flags without transcripts", () => {
  const query = buildRetrievalQuery({
    profile: { age: 9, userRole: "Student" },
    analysis: { categories: { SoundRep: 4 } },
  });
  assert.match(query, /Sound repetitions: 4/);
  assert.match(query, /Age 9/);
  assert.equal(query.includes("transcript"), false);
});

test("corpus has one passage per listed technique family", () => {
  assert.ok(SLP_STEPHEN_CHUNKS.length >= 24);
  assert.equal(new Set(SLP_STEPHEN_CHUNKS.map((chunk) => chunk.id)).size, SLP_STEPHEN_CHUNKS.length);
});

test("cosine similarity is 1 for identical vectors", () => {
  assert.equal(cosineSimilarity([1, 0, 0], [1, 0, 0]), 1);
  assert.ok(cosineSimilarity([1, 0], [0, 1]) < 0.001);
});
