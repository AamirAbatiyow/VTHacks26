import { randomUUID } from "node:crypto";
import type { ServerJsonEvent } from "../../../shared/events.js";
import { logger } from "../logger.js";
import { projectEvent, type AnalyticsEvent } from "./events.js";
import { validateStutteringAssessment, type StutteringAssessment } from "../analysis/StutteringAssessment.js";

export interface AnalyticsDatabase {
  writeBatch(events: StoredEvent[]): Promise<void>;
  end(): Promise<void>;
}

export interface StoredEvent {
  id: string;
  occurred_at: string;
  session_id: string;
  event_type: string;
  generation_id: string | null;
  properties: AnalyticsEvent["properties"];
}

/** Bounded, best-effort telemetry. Voice processing never awaits database writes. */
export class AnalyticsTracker {
  private queue: StoredEvent[] = [];
  private inFlight: Promise<void> | null = null;
  private accepting = true;
  private timer?: NodeJS.Timeout;
  private failures = 0;
  private dropped = 0;
  private lastWriteAt: string | null = null;
  private lastWriteFailed = false;

  constructor(private readonly db: AnalyticsDatabase | null, private readonly capacity = 1000) {
    if (db) {
      this.timer = setInterval(() => { void this.flush(); }, 1000);
      this.timer.unref();
    }
  }

  status() {
    return { enabled: this.db !== null, queued: this.queue.length, dropped: this.dropped,
      writeFailures: this.failures, lastWriteAt: this.lastWriteAt, lastWriteFailed: this.lastWriteFailed };
  }

  track(sessionId: string, event: AnalyticsEvent): void {
    if (!this.db || !this.accepting) return;
    if (this.queue.length >= this.capacity) { this.dropped++; return; }
    this.queue.push({ id: randomUUID(), occurred_at: new Date().toISOString(),
      session_id: sessionId, event_type: event.type,
      generation_id: event.generationId ?? null, properties: event.properties });
  }

  trackServerEvent(sessionId: string, event: ServerJsonEvent): void {
    const projected = projectEvent(event);
    if (projected) this.track(sessionId, projected);
  }

  /** Identification loops submit a full snapshot per utterance, not count deltas. */
  trackStutteringAssessment(sessionId: string, utteranceId: string, result: StutteringAssessment): void {
    if (!utteranceId.trim()) throw new Error("An utterance ID is required.");
    validateStutteringAssessment(result);
    this.track(sessionId, { type: "stuttering_assessment", properties: {
      utteranceId, revision: result.revision,
      prolongation: result.prolongation, block: result.block,
      soundRepetition: result.soundRepetition, wordRepetition: result.wordRepetition,
      interjection: result.interjection, noStutteredWords: result.noStutteredWords ? 1 : 0,
    } });
  }

  flush(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    if (!this.db || !this.queue.length) return Promise.resolve();
    const batch = this.queue.slice();
    this.inFlight = this.db.writeBatch(batch).then(() => {
      this.queue.splice(0, batch.length);
      this.lastWriteAt = new Date().toISOString();
      this.lastWriteFailed = false;
    }).catch(() => {
      this.failures++;
      if (!this.lastWriteFailed) logger.warn("ANALYTICS", "Database write failed; retaining bounded queue for retry. Check database settings and run db:migrate.");
      this.lastWriteFailed = true;
    }).finally(() => { this.inFlight = null; });
    return this.inFlight;
  }

  async close(): Promise<void> {
    this.accepting = false;
    clearInterval(this.timer);
    if (this.inFlight) await this.inFlight;
    await this.flush();
    if (this.queue.length) logger.warn("ANALYTICS", `${this.queue.length} events could not be persisted before shutdown.`);
    await this.db?.end();
  }
}
