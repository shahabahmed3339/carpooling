import nextEnv from "@next/env";
import { Pool } from "pg";

/**
 * Delete old, already-read in-app notifications.
 *
 * The inbox grew without bound: every ride event and safety-report notice stays
 * forever, so a long-lived account accumulates rows it has already seen. This
 * removes only notifications the recipient has **read** and only once they are
 * older than the retention window, so nothing unread or recent is ever touched.
 *
 * Usage:
 *   node ./scripts/prune-notifications.mjs [--retention-days=<n>] [--dry-run]
 *
 * Retention defaults to 90 days and can be overridden with
 * NOTIFICATION_RETENTION_DAYS. This deletes rows from the database pointed at by
 * DATABASE_URL, deletes at most 500 per invocation, and skips rows locked by
 * another transaction; schedule it periodically and run it repeatedly to catch
 * up on a backlog.
 */

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd(), process.env.NODE_ENV === "development", {
  info: () => {},
  error: () => {},
});

const retentionArg = process.argv.find((arg) => arg.startsWith("--retention-days="));
const dryRun = process.argv.includes("--dry-run");
const retentionDays = Number(retentionArg?.slice("--retention-days=".length) ?? process.env.NOTIFICATION_RETENTION_DAYS ?? 90);
if (!Number.isInteger(retentionDays) || retentionDays < 7 || retentionDays > 3650) {
  throw new Error("Retention must be an integer between 7 and 3650 days.");
}

const configuredConnectionString = process.env.DATABASE_URL;
if (!configuredConnectionString) {
  throw new Error("Set DATABASE_URL before pruning notifications.");
}
if (process.env.NODE_ENV === "production" && process.env.DATABASE_SSL !== "true") {
  throw new Error("DATABASE_SSL=true is required for production database connections.");
}

let connectionString = configuredConnectionString;
const url = parseConnectionUrl(configuredConnectionString);
if (url.protocol !== "postgres:" && url.protocol !== "postgresql:") {
  throw new Error("DATABASE_URL must use the postgres or postgresql protocol.");
}
if (process.env.DATABASE_SSL === "true") {
  if (["sslcert", "sslkey", "sslrootcert"].some((key) => url.searchParams.has(key))) {
    throw new Error(
      "Custom SSL certificate parameters are unsupported; use the provider's standard verified TLS connection URI.",
    );
  }
  url.searchParams.delete("sslmode");
  connectionString = url.toString();
}

const pool = new Pool({
  connectionString,
  application_name: "carpool-notification-cleanup",
  max: 1,
  connectionTimeoutMillis: 5_000,
  ...(process.env.DATABASE_SSL === "true" ? { ssl: { rejectUnauthorized: true } } : {}),
});

const batchSize = 500;
let client;
let transactionOpen = false;
try {
  client = await pool.connect();
  await client.query("BEGIN");
  transactionOpen = true;
  await client.query("SET LOCAL lock_timeout = '2s'");
  await client.query("SET LOCAL statement_timeout = '10s'");

  const cutoff = `now() - ($1::int * interval '1 day')`;

  if (dryRun) {
    const preview = await client.query(
      `SELECT count(*)::int AS count FROM in_app_notifications
        WHERE read_at IS NOT NULL AND created_at < ${cutoff}`,
      [retentionDays],
    );
    await client.query("ROLLBACK");
    transactionOpen = false;
    process.stdout.write(
      `Dry run: ${preview.rows[0]?.count ?? 0} read notification(s) older than ${retentionDays} days would be eligible.\n`,
    );
  } else {
    const result = await client.query(
      `WITH expired AS (
         SELECT id FROM in_app_notifications
          WHERE read_at IS NOT NULL AND created_at < now() - ($2::int * interval '1 day')
          ORDER BY created_at
          LIMIT $1
          FOR UPDATE SKIP LOCKED
       )
       DELETE FROM in_app_notifications notifications
        USING expired
        WHERE notifications.id = expired.id`,
      [batchSize, retentionDays],
    );
    await client.query("COMMIT");
    transactionOpen = false;
    process.stdout.write(
      `Pruned ${result.rowCount ?? 0} read notification(s) older than ${retentionDays} days.\n`,
    );
  }
} catch (error) {
  if (client && transactionOpen) {
    try {
      await client.query("ROLLBACK");
      transactionOpen = false;
    } catch {
      // Preserve the cleanup error; the connection is discarded in finally.
    }
  }
  throw error;
} finally {
  client?.release(transactionOpen);
  await pool.end();
}

function parseConnectionUrl(value) {
  try {
    return new URL(value);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL connection URL.");
  }
}
