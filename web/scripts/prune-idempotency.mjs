import nextEnv from "@next/env";
import { Pool } from "pg";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd(), process.env.NODE_ENV === "development", {
  info: () => {},
  error: () => {},
});

const configuredConnectionString = process.env.DATABASE_URL;
if (!configuredConnectionString) {
  throw new Error("Set DATABASE_URL before pruning expired idempotency records.");
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
  application_name: "carpool-idempotency-cleanup",
  max: 1,
  connectionTimeoutMillis: 5_000,
  ...(process.env.DATABASE_SSL === "true"
    ? { ssl: { rejectUnauthorized: true } }
    : {}),
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
  const result = await client.query(
    `WITH expired AS (
       SELECT actor_user_id, operation, key_sha256
         FROM idempotency_records
        WHERE expires_at <= clock_timestamp()
        ORDER BY expires_at
        LIMIT $1
        FOR UPDATE SKIP LOCKED
     )
     DELETE FROM idempotency_records records
      USING expired
      WHERE records.actor_user_id = expired.actor_user_id
        AND records.operation = expired.operation
        AND records.key_sha256 = expired.key_sha256`,
    [batchSize],
  );
  await client.query("COMMIT");
  transactionOpen = false;
  process.stdout.write(`Pruned ${result.rowCount ?? 0} expired idempotency record(s).\n`);
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
