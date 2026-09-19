import { test } from "node:test";
import assert from "node:assert/strict";
import { AnalyticsTracker, type AnalyticsDatabase, type StoredEvent } from "./AnalyticsTracker.js";
import { projectEvent } from "./events.js";
import { LocalAnalyticsDatabase } from "./local.js";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

test("projection excludes transcripts, audio, provider details, and free-form errors", () => {
  const projected = [
    projectEvent({ type: "transcript_final", turnId: "x", text: "private child words", signal: {
      samples: [0.2, 0.3], durationMs: 1200, sourceSampleRate: 16000,
    } }),
    projectEvent({ type: "assistant_text_final", generationId: "g", text: "private reply" }),
    projectEvent({ type: "provider_status", provider: "scribe", status: "error", detail: "secret token" }),
    projectEvent({ type: "error", code: "scribe", message: "secret token" }),
  ];
  const json = JSON.stringify(projected);
  for (const sensitive of ["private", "secret", "samples", "sourceSampleRate"]) {
    assert.equal(json.includes(sensitive), false);
  }
  assert.equal(projected[0]?.properties.words, 3);
  assert.equal(projected[0]?.properties.durationMs, 1200);
  assert.equal(projectEvent({ type: "transcript_interim", text: "private" }), null);
});

test("failed writes retry identical IDs and enforce a bounded queue", async () => {
  const batches: string[] = [];
  let fail = true;
  const db: AnalyticsDatabase = {
    async writeBatch(events) {
      batches.push(JSON.stringify(events));
      if (fail) throw new Error("offline");
    },
    async end() {},
  };
  const tracker = new AnalyticsTracker(db, 2);
  try {
    tracker.track("s", { type: "session_connected", properties: {} });
    tracker.track("s", { type: "session_started", properties: {} });
    tracker.track("s", { type: "overflow", properties: {} });
    await tracker.flush();
    assert.equal(tracker.status().queued, 2);
    assert.equal(tracker.status().dropped, 1);
    assert.equal(tracker.status().writeFailures, 1);
    fail = false;
    await tracker.flush();
    assert.equal(batches[0], batches[1]);
    assert.equal(tracker.status().queued, 0);
    assert.equal(tracker.status().lastWriteFailed, false);
  } finally { await tracker.close(); }
});

test("concurrent flushes share one write and preserve newly queued events", async () => {
  let resolveWrite!: () => void;
  const batches: string[] = [];
  const tracker = new AnalyticsTracker({
    writeBatch(events) {
      batches.push(JSON.stringify(events));
      if (batches.length > 1) return Promise.resolve();
      return new Promise<void>((resolve) => { resolveWrite = resolve; });
    },
    async end() {},
  });
  tracker.track("s", { type: "first", properties: {} });
  const first = tracker.flush();
  assert.equal(tracker.flush(), first);
  tracker.track("s", { type: "second", properties: {} });
  resolveWrite();
  await first;
  assert.equal(tracker.status().queued, 1);
  await tracker.close();
  assert.equal(JSON.parse(batches[1])[0].event_type, "second");
  tracker.track("s", { type: "after_close", properties: {} });
  assert.equal(tracker.status().queued, 0);
});

test("missing database disables tracking", async () => {
  const tracker = new AnalyticsTracker(null);
  tracker.track("s", { type: "session_started", properties: {} });
  assert.equal(tracker.status().enabled, false);
  assert.equal(tracker.status().queued, 0);
  await tracker.close();
});

test("SQLite persists after reopen, deduplicates retries, and reports latest metrics", async () => {
  const directory = mkdtempSync(path.join(tmpdir(), "vocally-analytics-"));
  const filename = path.join(directory, "analytics.sqlite");
  let local = new LocalAnalyticsDatabase(filename);
  try {
    const timestamp = new Date().toISOString();
    const base = { occurred_at: timestamp, session_id: "session-1", generation_id: null };
    const events: StoredEvent[] = [
      { ...base, id: "1", event_type: "session_connected", properties: {} },
      { ...base, id: "2", event_type: "session_started", properties: {} },
      { ...base, id: "3", event_type: "session_ended", properties: { durationMs: 2000 } },
      { ...base, id: "4", generation_id: "g", event_type: "turn_metrics", properties: { sttMs: 20, serverToFirstAudioMs: null } },
      { ...base, id: "5", generation_id: "g", event_type: "turn_metrics", properties: { sttMs: 20, serverToFirstAudioMs: 250 } },
    ];
    await local.writeBatch(events);
    await local.writeBatch(events);
    await local.end();
    local = new LocalAnalyticsDatabase(filename);
    assert.equal(local.db.prepare("SELECT count(*) AS n FROM events").get()?.n, 5);
    assert.equal(local.db.prepare("SELECT duration_ms FROM sessions").get()?.duration_ms, 2000);
    const turns = local.db.prepare("SELECT * FROM turns").all();
    assert.equal(turns.length, 1);
    assert.equal(turns[0].server_to_first_audio_ms, 250);
    assert.equal(turns[0].tts_first_audio_ms, null);
    assert.equal(local.db.prepare("SELECT turns FROM hourly_latency").get()?.turns, 1);
  } finally {
    await local.end();
    rmSync(directory, { recursive: true });
  }
});
