// node:sqlite is only stable from Node 24; see the engines field in package.json.
import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { AnalyticsDatabase, StoredEvent } from "./AnalyticsTracker.js";
import { conversationSchema } from "./conversationSchema.js";

// Resolve against the project, not cwd, for both tsx source and compiled server.
const modulePath = fileURLToPath(import.meta.url);
const projectRoot = path.resolve(path.dirname(modulePath),
  modulePath.includes(`${path.sep}dist${path.sep}`) ? "../../../../../" : "../../../");

export function localDatabasePath(): string {
  return path.resolve(projectRoot, process.env.ANALYTICS_DB_PATH?.trim() || "data/analytics.sqlite");
}

export class LocalAnalyticsDatabase implements AnalyticsDatabase {
  readonly db: DatabaseSync;
  constructor(readonly filename = localDatabasePath()) {
    mkdirSync(path.dirname(filename), { recursive: true });
    this.db = new DatabaseSync(filename);
    // A single portable database file; no persistent WAL sidecar files.
    this.db.exec(`
      PRAGMA journal_mode = DELETE;
      PRAGMA busy_timeout = 100;
      CREATE TABLE IF NOT EXISTS events (
        ingestion_order INTEGER PRIMARY KEY AUTOINCREMENT,
        id TEXT NOT NULL,
        occurred_at TEXT NOT NULL,
        session_id TEXT NOT NULL,
        event_type TEXT NOT NULL,
        generation_id TEXT,
        properties TEXT NOT NULL CHECK (json_valid(properties)),
        UNIQUE (occurred_at, id)
      );
      CREATE INDEX IF NOT EXISTS events_session_time ON events(session_id, occurred_at DESC);
      CREATE INDEX IF NOT EXISTS events_type_time ON events(event_type, occurred_at DESC);
      CREATE VIEW IF NOT EXISTS sessions AS
      SELECT session_id,
        min(occurred_at) FILTER (WHERE event_type = 'session_connected') AS connected_at,
        min(occurred_at) FILTER (WHERE event_type = 'session_started') AS started_at,
        max(occurred_at) FILTER (WHERE event_type = 'session_ended') AS ended_at,
        max(json_extract(properties, '$.durationMs'))
          FILTER (WHERE event_type = 'session_ended') AS duration_ms,
        count(*) FILTER (WHERE event_type = 'user_utterance') AS user_utterances,
        count(DISTINCT generation_id) FILTER (WHERE event_type = 'assistant_text_final') AS assistant_turns,
        count(DISTINCT generation_id) FILTER (WHERE event_type = 'interrupted'
          OR (event_type = 'assistant_text_final' AND json_extract(properties, '$.interrupted') = 1)) AS interrupted_turns,
        count(*) FILTER (WHERE event_type = 'error') AS errors
      FROM events GROUP BY session_id;
      CREATE VIEW IF NOT EXISTS turns AS
      SELECT session_id, generation_id, occurred_at,
        json_extract(properties, '$.sttMs') AS stt_ms,
        json_extract(properties, '$.geminiFirstTokenMs') AS gemini_first_token_ms,
        json_extract(properties, '$.ttsFirstAudioMs') AS tts_first_audio_ms,
        json_extract(properties, '$.serverToFirstAudioMs') AS server_to_first_audio_ms
      FROM (
        SELECT *, row_number() OVER (
          PARTITION BY session_id, generation_id ORDER BY occurred_at DESC, ingestion_order DESC
        ) AS position FROM events WHERE event_type = 'turn_metrics'
      ) WHERE position = 1;
      CREATE VIEW IF NOT EXISTS hourly_latency AS
      SELECT strftime('%Y-%m-%dT%H:00:00.000Z', occurred_at) AS hour, count(*) AS turns,
        avg(stt_ms) AS avg_stt_ms,
        avg(gemini_first_token_ms) AS avg_gemini_first_token_ms,
        avg(tts_first_audio_ms) AS avg_tts_first_audio_ms,
        avg(server_to_first_audio_ms) AS avg_server_to_first_audio_ms
      FROM turns GROUP BY 1;
    `);
    // Rebuild derived views transactionally, preserving every existing event.
    try {
      this.db.exec(`BEGIN; ${conversationSchema("sqlite")} COMMIT;`);
    } catch (error) {
      this.db.exec("ROLLBACK");
      this.db.close();
      throw error;
    }
  }

  async writeBatch(events: StoredEvent[]): Promise<void> {
    const insert = this.db.prepare(`INSERT INTO events
      (id, occurred_at, session_id, event_type, generation_id, properties)
      VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT (occurred_at, id) DO NOTHING`);
    this.db.exec("BEGIN");
    try {
      for (const event of events) insert.run(event.id, event.occurred_at, event.session_id,
        event.event_type, event.generation_id, JSON.stringify(event.properties));
      this.db.exec("COMMIT");
    } catch (error) {
      this.db.exec("ROLLBACK");
      throw error;
    }
  }

  async end(): Promise<void> { this.db.close(); }
}
