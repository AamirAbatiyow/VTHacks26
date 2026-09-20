import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import tls from "node:tls";
import { Pool } from "pg";
import type { AnalyticsDatabase } from "./AnalyticsTracker.js";
import { serverRoot } from "../paths.js";

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

/**
 * Extra roots to trust on top of the system store.
 *
 * Timescale Cloud serves a certificate signed by its own private CA
 * (CN=ca.timescale.com), which Node does not ship, so verify-full fails with
 * SELF_SIGNED_CERT_IN_CHAIN. Trusting that CA alongside the system roots keeps
 * full verification on; lowering rejectUnauthorized would accept any
 * certificate instead. Any PEM dropped in server/certs/ is picked up.
 */
function extraRootCertificates(): string[] {
  const bundled = path.join(serverRoot, "certs", "timescale-ca.crt");
  return existsSync(bundled) ? [readFileSync(bundled, "utf8")] : [];
}

export function createAnalyticsPool(connectionString: string): Pool {
  const url = new URL(connectionString);
  const isLocal = ["localhost", "127.0.0.1", "::1", "[::1]"].includes(url.hostname);
  // Local PostgreSQL is useful for development; cloud connections default to verified TLS.
  if (!url.searchParams.has("sslmode")) {
    url.searchParams.set("sslmode", isLocal ? "disable" : "verify-full");
  }

  // pg lets values parsed from the connection string win over the config
  // object, so an explicit CA list only takes effect once sslmode is dropped.
  // Verification stays on either way — this widens the trust anchors, not the
  // acceptance criteria.
  const wantsVerification = url.searchParams.get("sslmode") === "verify-full";
  const extraRoots = wantsVerification && !url.searchParams.has("sslrootcert")
    ? extraRootCertificates() : [];
  if (extraRoots.length > 0) url.searchParams.delete("sslmode");

  return new Pool({
    connectionString: url.toString(),
    ...(extraRoots.length > 0
      ? {
          ssl: {
            ca: [...tls.rootCertificates, ...extraRoots],
            rejectUnauthorized: true,
            servername: url.hostname,
          },
        }
      : {}),
    max: 2,
    connectionTimeoutMillis: 3000,
    idleTimeoutMillis: 10000,
    statement_timeout: 3000,
    query_timeout: 4000,
    application_name: "vocally-analytics",
  });
}
