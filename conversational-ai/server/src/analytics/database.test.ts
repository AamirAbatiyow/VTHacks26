import { test } from "node:test";
import assert from "node:assert/strict";
import type { Pool } from "pg";
import { initializeAnalyticsDatabase } from "./database.js";

test("initialization commits successful migrations and rolls back failures", async () => {
  for (const fail of [false, true]) {
    const queries: string[] = [];
    let released = false;
    const pool = { async connect() { return {
      async query(sql: string) {
        queries.push(sql);
        if (fail && sql.includes("CREATE SCHEMA")) throw new Error("schema failed");
      },
      release() { released = true; },
    }; } } as unknown as Pool;
    if (fail) await assert.rejects(initializeAnalyticsDatabase(pool), /schema failed/);
    else await initializeAnalyticsDatabase(pool, true);
    assert.equal(queries[0], "BEGIN");
    assert.match(queries[1], /pg_advisory_xact_lock/);
    assert.equal(queries.at(-1), fail ? "ROLLBACK" : "COMMIT");
    assert.equal(queries.some(sql => sql.includes("create_hypertable")), !fail);
    assert.equal(released, true);
  }
});
