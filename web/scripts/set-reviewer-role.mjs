import nextEnv from "@next/env";
import { Pool } from "pg";

/**
 * Grant or revoke the moderation role for an existing account.
 *
 * The app creates every marketplace membership as `MEMBER`, and only accounts
 * with `OPERATOR` or `SAFETY_REVIEWER` can open the moderation queue. Without a
 * deliberate promotion step no one could ever review a report or dispute, so
 * this script is the bootstrap. It changes only the membership role; it never
 * creates accounts and never touches trip or request data.
 *
 * Usage:
 *   node ./scripts/set-reviewer-role.mjs <email> <MEMBER|OPERATOR|SAFETY_REVIEWER>
 *
 * Run it with the same DATABASE_URL as the app. It is intentionally a separate,
 * explicit command rather than an HTTP endpoint so reviewer access cannot be
 * granted from the web app.
 */

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd(), process.env.NODE_ENV === "development", {
  info: () => {},
  error: () => {},
});

const roles = new Set(["MEMBER", "OPERATOR", "SAFETY_REVIEWER"]);
const [email, role] = process.argv.slice(2);

if (!email || !role) {
  throw new Error("Usage: node ./scripts/set-reviewer-role.mjs <email> <MEMBER|OPERATOR|SAFETY_REVIEWER>");
}
if (!roles.has(role)) {
  throw new Error("Role must be one of MEMBER, OPERATOR, SAFETY_REVIEWER.");
}
if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
  throw new Error("Provide a valid email address.");
}

const configuredConnectionString = process.env.DATABASE_URL;
if (!configuredConnectionString) {
  throw new Error("Set DATABASE_URL before changing a reviewer role.");
}
if (process.env.NODE_ENV === "production" && process.env.DATABASE_SSL !== "true") {
  throw new Error("DATABASE_SSL=true is required for production database connections.");
}

let connectionString = configuredConnectionString;
if (process.env.DATABASE_SSL === "true") {
  const url = parseConnectionUrl(configuredConnectionString);
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
  application_name: "carpool-reviewer-role",
  max: 1,
  connectionTimeoutMillis: 5_000,
  ...(process.env.DATABASE_SSL === "true" ? { ssl: { rejectUnauthorized: true } } : {}),
});

const client = await pool.connect();
let transactionOpen = false;
try {
  await client.query("BEGIN");
  transactionOpen = true;
  await client.query("SET LOCAL lock_timeout = '5s'");
  await client.query("SET LOCAL statement_timeout = '10s'");

  // Match on auth_subject first (the verified sign-in identity), then fall back
  // to a literal auth subject for accounts created before auth was enabled.
  // `users.auth_subject` stores the Better Auth `"user".id` value — the `"user"`
  // table's primary key is `id`; `userId` only exists on `account`/`session` as a
  // foreign key. Only ACTIVE accounts are promotable: a closed account must not
  // regain reviewer access.
  const account = await client.query(
    `SELECT u.id AS user_id, u.display_name, u.status
       FROM users u
      WHERE (
              u.auth_subject = (SELECT au.id FROM "user" au WHERE lower(au.email) = lower($1))
              OR lower(u.auth_subject) = lower($1)
            )
        AND u.status = 'ACTIVE'
      LIMIT 1`,
    [email],
  );
  const found = account.rows[0];
  if (!found) {
    throw new Error(`No active account found for ${email}. The person must sign up before a role can be granted.`);
  }

  const membership = await client.query(
    `UPDATE community_memberships
        SET role = $2, updated_at = now()
      WHERE user_id = $1 AND status = 'ACTIVE'
      RETURNING community_id, role`,
    [found.user_id, role],
  );
  if (membership.rowCount !== 1) {
    throw new Error(`No active membership found for ${email}. The account may be closed.`);
  }

  await client.query("COMMIT");
  transactionOpen = false;
  // Print the name and role only; never echo secrets or the full row.
  process.stdout.write(`Set ${found.display_name} (${email}) to ${membership.rows[0].role}.\n`);
} catch (error) {
  if (transactionOpen) {
    try {
      await client.query("ROLLBACK");
      transactionOpen = false;
    } catch {
      // Preserve the original error; the connection is discarded in finally.
    }
  }
  throw error;
} finally {
  client.release(transactionOpen);
  await pool.end();
}

function parseConnectionUrl(value) {
  try {
    return new URL(value);
  } catch {
    throw new Error("DATABASE_URL must be a valid PostgreSQL connection URL.");
  }
}
