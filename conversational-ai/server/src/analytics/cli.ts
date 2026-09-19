import "../config.js";
import { createAnalyticsPool } from "./database.js";
import { schemaSql, hypertableSql } from "./schema.js";
import { LocalAnalyticsDatabase } from "./local.js";

async function main(): Promise<void> {
  const url = process.env.DATABASE_URL?.trim();
  const command = process.argv[2];
  if (!url) {
    if (process.argv.includes("--timescale")) throw new Error("TimescaleDB requires DATABASE_URL.");
    const local = new LocalAnalyticsDatabase();
    try {
      if (command === "migrate") console.log(`Local analytics database ready: ${local.filename}`);
      else if (command === "report") {
        const since = new Date(Date.now() - 7 * 86400000).toISOString();
        console.log(`Local analytics database: ${local.filename}`);
        console.table(local.db.prepare(`SELECT * FROM conversations
          WHERE started_at >= ? ORDER BY started_at DESC`).all(since));
        console.table(local.db.prepare("SELECT * FROM hourly_latency WHERE hour >= ? ORDER BY hour DESC").all(since));
        console.table(local.db.prepare(`SELECT count(*) AS connections,
          count(started_at) AS started_sessions, count(ended_at) AS ended_sessions,
          coalesce(sum(user_utterances), 0) AS user_utterances,
          coalesce(sum(assistant_turns), 0) AS assistant_turns,
          coalesce(sum(interrupted_turns), 0) AS interrupted_turns,
          coalesce(sum(errors), 0) AS errors FROM sessions WHERE connected_at >= ?`).all(since));
      } else throw new Error("Use migrate or report.");
    } finally { await local.end(); }
    return;
  }
  const pool = createAnalyticsPool(url);
  pool.on("error", () => { console.error("Analytics database connection failed."); });
  try {
    if (command === "migrate") {
      const client = await pool.connect();
      try {
        await client.query("BEGIN");
        await client.query("SELECT pg_advisory_xact_lock(724018263)");
        await client.query(schemaSql);
        if (process.argv.includes("--timescale")) await client.query(hypertableSql);
        await client.query("COMMIT");
        console.log("Analytics schema ready" + (process.argv.includes("--timescale") ? " (TimescaleDB hypertable)." : "."));
      } catch (error) {
        await client.query("ROLLBACK");
        throw error;
      } finally { client.release(); }
    } else if (command === "report") {
      const conversations = await pool.query(`SELECT * FROM analytics.conversations
        WHERE started_at >= now() - interval '7 days' ORDER BY started_at DESC`);
      console.table(conversations.rows);
      const result = await pool.query(`SELECT * FROM analytics.hourly_latency
        WHERE hour >= now() - interval '7 days' ORDER BY hour DESC`);
      console.table(result.rows);
      const sessions = await pool.query(`SELECT count(*) AS connections,
        count(started_at) AS started_sessions, count(ended_at) AS ended_sessions,
        sum(user_utterances) AS user_utterances, sum(assistant_turns) AS assistant_turns,
        sum(interrupted_turns) AS interrupted_turns, sum(errors) AS errors
        FROM analytics.sessions WHERE connected_at >= now() - interval '7 days'`);
      console.table(sessions.rows);
    } else { throw new Error("Use migrate [--timescale] or report."); }
  } finally { await pool.end(); }
}

main().catch((error: unknown) => {
  // Never print connection strings, passwords, or provider payloads.
  const code = (error as { code?: string }).code;
  console.error("Analytics command failed. Check DATABASE_URL, connectivity and database permissions.",
    code && /^[A-Z0-9_]+$/.test(code) ? `Code: ${code}` : "");
  process.exitCode = 1;
});
