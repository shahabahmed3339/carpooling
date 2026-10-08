/**
 * Exercise db:set-reviewer-role against a real database.
 *
 * Reviewer access is the only way into the moderation queue and the command is
 * the only way to grant it, so it must work and must refuse the cases that would
 * be dangerous (unknown account, closed account, invalid role). The command is
 * run as a child process so this tests the real entry point, not a copy.
 *
 * This test found a real bug: the command's lookup selected `"user"."userId"`,
 * but that table's primary key is `id` (`userId` exists only on `account` and
 * `session` as a foreign key), so every invocation failed and no reviewer could
 * ever be promoted. The lookup now uses `"user".id`.
 *
 * Cleans up after itself and exits non-zero on failure.
 *
 * Run from web/: node scripts/verify-reviewer-role.mjs
 */
import nextEnv from "@next/env";
import { randomUUID } from "node:crypto";
import { spawnSync } from "node:child_process";
import { Pool } from "pg";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd(), true, { info: () => {}, error: () => {} });
const url = new URL(process.env.DATABASE_URL);
url.searchParams.delete("sslmode");
const pool = new Pool({
  connectionString: url.toString(),
  max: 2,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: true } : undefined,
});

const CID = "00000000-0000-4000-8000-000000000002";
const results = [];
const check = (n, p, d) => results.push({ n, p, d });
const tag = `rr${randomUUID().slice(0, 8)}`;

/**
 * The command resolves the account through the `"user"` table's email, so build
 * a verified auth row plus the matching app row for each fixture.
 */
async function createAuthBackedAccount(email, status) {
  const authId = randomUUID();
  const userId = randomUUID();
  await pool.query(
    `INSERT INTO "user" (id, name, email, "emailVerified", "createdAt", "updatedAt")
     VALUES ($1, $2, $3, true, now(), now())`,
    [authId, `${tag}-name`, email],
  );
  await pool.query(
    `INSERT INTO users (id, auth_subject, display_name, participant_role, status)
     VALUES ($1, $2, $3, 'RIDER', $4)`,
    [userId, authId, `${tag}-display`, status],
  );
  await pool.query(
    `INSERT INTO community_memberships (community_id, user_id, status, role, reviewed_by, reviewed_at)
     VALUES ($1, $2, 'ACTIVE', 'MEMBER', $2, now())`,
    [CID, userId],
  );
  return { authId, userId, email };
}

function runCommand(...args) {
  const result = spawnSync(process.execPath, ["./scripts/set-reviewer-role.mjs", ...args], {
    cwd: process.cwd(),
    encoding: "utf8",
    env: process.env,
  });
  return { code: result.status, out: `${result.stdout}${result.stderr}` };
}

async function roleOf(userId) {
  const row = await pool.query(
    "SELECT role FROM community_memberships WHERE community_id = $1 AND user_id = $2",
    [CID, userId],
  );
  return row.rows[0]?.role;
}

const created = [];
try {
  const reviewer = await createAuthBackedAccount(`${tag}-reviewer@example.invalid`, "ACTIVE");
  const other = await createAuthBackedAccount(`${tag}-other@example.invalid`, "ACTIVE");
  const closed = await createAuthBackedAccount(`${tag}-closed@example.invalid`, "DEACTIVATED");
  created.push(reviewer, other, closed);

  const promote = runCommand(reviewer.email, "SAFETY_REVIEWER");
  check(
    "promotes an active account to SAFETY_REVIEWER",
    promote.code === 0 && (await roleOf(reviewer.userId)) === "SAFETY_REVIEWER",
    `${promote.code} role=${await roleOf(reviewer.userId)} ${promote.out.trim()}`,
  );

  const toOperator = runCommand(reviewer.email, "OPERATOR");
  check(
    "changes an existing reviewer to OPERATOR",
    toOperator.code === 0 && (await roleOf(reviewer.userId)) === "OPERATOR",
    `role=${await roleOf(reviewer.userId)}`,
  );

  const demote = runCommand(reviewer.email, "MEMBER");
  check(
    "demotes back to MEMBER",
    demote.code === 0 && (await roleOf(reviewer.userId)) === "MEMBER",
    `role=${await roleOf(reviewer.userId)}`,
  );

  const unknown = runCommand(`${tag}-nobody@example.invalid`, "SAFETY_REVIEWER");
  check(
    "refuses an unknown email",
    unknown.code !== 0 && /No active account found/i.test(unknown.out),
    `${unknown.code} ${unknown.out.trim()}`,
  );

  const closedAttempt = runCommand(closed.email, "SAFETY_REVIEWER");
  check(
    "refuses a closed account",
    closedAttempt.code !== 0 && (await roleOf(closed.userId)) === "MEMBER",
    `${closedAttempt.code} role=${await roleOf(closed.userId)}`,
  );

  const badRole = runCommand(other.email, "SUPERUSER");
  check(
    "refuses an invalid role",
    badRole.code !== 0 && (await roleOf(other.userId)) === "MEMBER",
    `${badRole.code} role=${await roleOf(other.userId)}`,
  );

  const noArgs = runCommand();
  check("refuses to run without arguments", noArgs.code !== 0 && /Usage:/i.test(noArgs.out), `${noArgs.code}`);

  check("an unrelated account keeps its role", (await roleOf(other.userId)) === "MEMBER", `role=${await roleOf(other.userId)}`);
} finally {
  for (const acct of created) {
    await pool.query("DELETE FROM community_memberships WHERE user_id = $1", [acct.userId]).catch(() => {});
    await pool.query("DELETE FROM users WHERE id = $1", [acct.userId]).catch(() => {});
    await pool.query(`DELETE FROM "user" WHERE id = $1`, [acct.authId]).catch(() => {});
  }
}

let failed = 0;
for (const r of results) {
  if (!r.p) failed += 1;
  console.log(`${r.p ? "PASS" : "FAIL"}  ${r.n}${r.p ? "" : `  -> ${r.d}`}`);
}
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
await pool.end();
process.exit(failed === 0 ? 0 : 1);
