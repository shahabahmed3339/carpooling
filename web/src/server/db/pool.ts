import { Pool, type PoolClient, type PoolConfig } from "pg";

declare global {
  // Keep one pool across Next.js development hot reloads.
  var __carpoolPgPool: Pool | undefined;
}

function createPool(): Pool {
  const configuredConnectionString = process.env.DATABASE_URL;
  if (!configuredConnectionString) {
    throw new Error("DATABASE_URL is required before using database-backed features.");
  }

  if (process.env.NODE_ENV === "production" && process.env.DATABASE_SSL !== "true") {
    throw new Error("DATABASE_SSL=true is required for production database connections.");
  }

  let connectionString = configuredConnectionString;
  if (process.env.DATABASE_SSL === "true") {
    const url = new URL(configuredConnectionString);
    if (["sslcert", "sslkey", "sslrootcert"].some((key) => url.searchParams.has(key))) {
      throw new Error(
        "Custom SSL certificate parameters are unsupported; use the provider's standard verified TLS connection URI.",
      );
    }
    // Keep TLS verification controlled by this ssl config, not connection URI options.
    url.searchParams.delete("sslmode");
    connectionString = url.toString();
  }

  const max = Number(process.env.DATABASE_POOL_MAX ?? 8);
  if (!Number.isInteger(max) || max < 1 || max > 32) {
    throw new Error("DATABASE_POOL_MAX must be an integer between 1 and 32.");
  }

  const config: PoolConfig = {
    connectionString,
    application_name: "carpool-web",
    max,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
    ...(process.env.DATABASE_SSL === "true"
      ? { ssl: { rejectUnauthorized: true } }
      : {}),
  };

  return new Pool(config);
}

export function getPool(): Pool {
  if (!globalThis.__carpoolPgPool) {
    globalThis.__carpoolPgPool = createPool();
  }
  return globalThis.__carpoolPgPool;
}

export async function inTransaction<T>(
  work: (client: PoolClient) => Promise<T>,
): Promise<T> {
  const client = await getPool().connect();
  let transactionOpen = false;
  let discardClient = false;

  try {
    await client.query("BEGIN");
    transactionOpen = true;
    const result = await work(client);
    await client.query("COMMIT");
    transactionOpen = false;
    return result;
  } catch (error) {
    if (transactionOpen) {
      try {
        await client.query("ROLLBACK");
      } catch {
        // Preserve the original error and discard a connection whose transaction
        // state could not be reset.
        discardClient = true;
      }
    }
    throw error;
  } finally {
    client.release(discardClient);
  }
}
