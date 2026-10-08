import { createHash } from "node:crypto";
import { readdir, readFile } from "node:fs/promises";
import nextEnv from "@next/env";
import { Pool } from "pg";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd());

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  throw new Error("Set DATABASE_URL before applying database migrations.");
}

let effectiveConnectionString = connectionString;
if (process.env.DATABASE_SSL === "true") {
  const url = new URL(connectionString);
  if (["sslcert", "sslkey", "sslrootcert"].some((key) => url.searchParams.has(key))) {
    throw new Error(
      "Custom SSL certificate parameters are unsupported; use the provider's standard verified TLS connection URI.",
    );
  }
  // node-postgres lets `sslmode` in the URI override the verified TLS options
  // configured below. DATABASE_SSL is the single source of truth here.
  url.searchParams.delete("sslmode");
  effectiveConnectionString = url.toString();
}

const pool = new Pool({
  connectionString: effectiveConnectionString,
  application_name: "carpool-migrate",
  max: 1,
  connectionTimeoutMillis: 5_000,
  ...(process.env.DATABASE_SSL === "true"
    ? { ssl: { rejectUnauthorized: true } }
    : {}),
});

const client = await pool.connect();
const appliedMigrations = [];

try {
  // Transaction-level lock works with direct connections and transaction poolers.
  // Keep the lock, migration table checks, and DDL in the same transaction.
  await client.query("BEGIN");
  await client.query("SET LOCAL lock_timeout = '30s'");
  await client.query("SELECT pg_advisory_xact_lock($1)", [1_145_260_361]);

  await client.query(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      version text PRIMARY KEY,
      checksum bytea NOT NULL,
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  const directory = new URL("../db/migrations/", import.meta.url);
  const files = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();

  for (const filename of files) {
    const sql = await readFile(new URL(filename, directory), "utf8");
    const checksum = createHash("sha256").update(sql).digest();
    const existing = await client.query(
      "SELECT checksum FROM schema_migrations WHERE version = $1",
      [filename],
    );

    if (existing.rowCount) {
      if (!existing.rows[0].checksum.equals(checksum)) {
        throw new Error(`Applied migration ${filename} has changed; add a new migration instead.`);
      }
      continue;
    }

    await client.query(sql);
    await client.query(
      "INSERT INTO schema_migrations (version, checksum) VALUES ($1, $2)",
      [filename, checksum],
    );
    appliedMigrations.push(filename);
  }

  await client.query("COMMIT");
  for (const filename of appliedMigrations) process.stdout.write(`Applied ${filename}\n`);
} catch (error) {
  try {
    await client.query("ROLLBACK");
  } catch {
    // Preserve the migration error; the session is closed in finally.
  }
  throw error;
} finally {
  client.release();
  await pool.end();
}
