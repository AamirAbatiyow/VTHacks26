/** Idempotent schema; ordinary PostgreSQL also works for local development. */
export const schemaSql = `
CREATE SCHEMA IF NOT EXISTS analytics;
CREATE TABLE IF NOT EXISTS analytics.events (
  ingestion_order bigint GENERATED ALWAYS AS IDENTITY,
  occurred_at timestamptz NOT NULL,
  id uuid NOT NULL,
  session_id uuid NOT NULL,
  event_type text NOT NULL,
  generation_id text,
  properties jsonb NOT NULL DEFAULT '{}'::jsonb,
  PRIMARY KEY (occurred_at, id)
);
CREATE INDEX IF NOT EXISTS analytics_events_session_time
  ON analytics.events (session_id, occurred_at DESC);
CREATE INDEX IF NOT EXISTS analytics_events_type_time
  ON analytics.events (event_type, occurred_at DESC);

CREATE OR REPLACE VIEW analytics.sessions AS
SELECT session_id,
  min(occurred_at) FILTER (WHERE event_type = 'session_connected') AS connected_at,
  min(occurred_at) FILTER (WHERE event_type = 'session_started') AS started_at,
  max(occurred_at) FILTER (WHERE event_type = 'session_ended') AS ended_at,
  max((properties->>'durationMs')::double precision)
    FILTER (WHERE event_type = 'session_ended') AS duration_ms,
  count(*) FILTER (WHERE event_type = 'user_utterance') AS user_utterances,
  count(DISTINCT generation_id) FILTER (WHERE event_type = 'assistant_text_final') AS assistant_turns,
  count(DISTINCT generation_id) FILTER (WHERE event_type = 'interrupted'
    OR (event_type = 'assistant_text_final' AND properties->>'interrupted' = 'true')) AS interrupted_turns,
  count(*) FILTER (WHERE event_type = 'error') AS errors
FROM analytics.events GROUP BY session_id;

-- Metrics can be emitted more than once per generation; use the latest snapshot.
CREATE OR REPLACE VIEW analytics.turns AS
SELECT DISTINCT ON (session_id, generation_id)
  session_id, generation_id, occurred_at,
  (properties->>'sttMs')::double precision AS stt_ms,
  (properties->>'geminiFirstTokenMs')::double precision AS gemini_first_token_ms,
  (properties->>'ttsFirstAudioMs')::double precision AS tts_first_audio_ms,
  (properties->>'serverToFirstAudioMs')::double precision AS server_to_first_audio_ms
FROM analytics.events WHERE event_type = 'turn_metrics'
ORDER BY session_id, generation_id, occurred_at DESC, ingestion_order DESC;

CREATE OR REPLACE VIEW analytics.hourly_latency AS
SELECT date_trunc('hour', occurred_at) AS hour, count(*) AS turns,
  avg(stt_ms) AS avg_stt_ms,
  avg(gemini_first_token_ms) AS avg_gemini_first_token_ms,
  avg(tts_first_audio_ms) AS avg_tts_first_audio_ms,
  avg(server_to_first_audio_ms) AS avg_server_to_first_audio_ms,
  percentile_cont(0.95) WITHIN GROUP (ORDER BY server_to_first_audio_ms) AS p95_server_to_first_audio_ms
FROM analytics.turns GROUP BY 1;
`;

export const hypertableSql = `
CREATE EXTENSION IF NOT EXISTS timescaledb;
SELECT create_hypertable('analytics.events', by_range('occurred_at'),
  if_not_exists => TRUE, migrate_data => TRUE);
`;
