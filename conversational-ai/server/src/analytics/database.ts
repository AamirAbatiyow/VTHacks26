import { Pool } from "pg";
import type { AnalyticsDatabase } from "./AnalyticsTracker.js";

export function postgresAnalyticsDatabase(pool: Pool): AnalyticsDatabase {
  return {
    async writeBatch(events) {
      await pool.query(`
        INSERT INTO analytics.events (id, occurred_at, session_id, event_type, generation_id, properties)
        SELECT id, occurred_at, session_id, event_type, generation_id, properties
        FROM jsonb_to_recordset($1::jsonb) AS e(
          id uuid, occurred_at timestamptz, session_id uuid, event_type text,
          generation_id text, properties jsonb)
        ON CONFLICT (occurred_at, id) DO NOTHING
      `, [JSON.stringify(events)]);
    },
    async end() { await pool.end(); },
  };
}

export function createAnalyticsPool(connectionString: string): Pool {
  const url = new URL(connectionString);
  // Local PostgreSQL is useful for development; cloud connections default to verified TLS.
  if (!url.searchParams.has("sslmode")) {
    url.searchParams.set("sslmode", ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname)
      ? "disable" : "verify-full");
  }
  return new Pool({
    connectionString: url.toString(),
    max: 2,
    connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 10000,
    statement_timeout: 3000,
    query_timeout: 4000,
    application_name: "vocally-analytics",
  });
}
