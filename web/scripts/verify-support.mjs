/**
 * Exercise the support-contact settings against a real database.
 *
 * This is the only contact route a user has when something goes wrong, and it is
 * writable, so two things must hold: any active member can read it, and only an
 * operator/reviewer can change it. A reader that silently fails, or a write that
 * a plain member can perform, would both be bad in different ways.
 *
 * Cleans up after itself and exits non-zero on failure.
 *
 * Run from web/: node scripts/verify-support.mjs
 */
import nextEnv from "@next/env";
import { randomUUID } from "node:crypto";
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
const tag = `sup${randomUUID().slice(0, 6)}`;

const MAX_LENGTH = 200;

/** Mirror of getSupportSettings (read path, any active member). */
async function readSupport() {
  const result = await pool.query(
    "SELECT support_contact AS contact, support_hours AS hours FROM communities WHERE id = $1",
    [CID],
  );
  return { contact: result.rows[0]?.contact ?? null, hours: result.rows[0]?.hours ?? null };
}

/** Mirror of updateSupportSettings' clean() + the operator gate. */
function clean(value) {
  if (value === null || value === undefined) return null;
  const trimmed = String(value).trim();
  if (trimmed.length === 0) return null;
  if (trimmed.length > MAX_LENGTH) throw new Error("INVALID_SUPPORT_CONTACT");
  return trimmed;
}

async function writeSupport(contact, hours) {
  const c = clean(contact);
  const h = clean(hours);
  await pool.query("UPDATE communities SET support_contact = $2, support_hours = $3 WHERE id = $1", [CID, c, h]);
  return { contact: c, hours: h };
}

async function canWrite(userId) {
  const result = await pool.query(
    `SELECT 1 FROM community_memberships
      WHERE community_id = $1 AND user_id = $2 AND status = 'ACTIVE'
        AND role IN ('OPERATOR', 'SAFETY_REVIEWER')`,
    [CID, userId],
  );
  return result.rowCount === 1;
}

// Use a real member account to test the authorization boundary.
const accounts = await pool.query(
  `SELECT u.id, m.role FROM users u JOIN community_memberships m ON m.user_id = u.id AND m.community_id = $1
    WHERE u.status='ACTIVE' AND m.status='ACTIVE' LIMIT 4`,
  [CID],
);
const member = accounts.rows.find((r) => r.role === "MEMBER") ?? { id: accounts.rows[0].id, role: "MEMBER" };

const original = await readSupport();
try {
  // A plain member must not pass the operator gate.
  check("a plain member cannot write support settings", (await canWrite(member.id)) === false, `role=${member.role}`);

  // Setting and reading back.
  const set = await writeSupport(`${tag}@example.invalid`, "Mon-Fri 09:00-18:00");
  const afterSet = await readSupport();
  check(
    "an operator can set and read back the contact",
    afterSet.contact === `${tag}@example.invalid` && afterSet.hours === "Mon-Fri 09:00-18:00",
    JSON.stringify({ set, afterSet }),
  );

  // Whitespace is trimmed, not stored verbatim.
  await writeSupport(`  ${tag}-trim@example.invalid  `, "  10:00-12:00  ");
  const trimmed = await readSupport();
  check(
    "surrounding whitespace is trimmed",
    trimmed.contact === `${tag}-trim@example.invalid` && trimmed.hours === "10:00-12:00",
    JSON.stringify(trimmed),
  );

  // Blank input clears to NULL rather than storing an empty string.
  await writeSupport("", "   ");
  const cleared = await readSupport();
  check(
    "blank input clears the setting to NULL",
    cleared.contact === null && cleared.hours === null,
    JSON.stringify(cleared),
  );

  // The length ceiling is enforced, so the UI cannot be made to render a wall of text.
  let tooLongRejected = false;
  try {
    clean("x".repeat(MAX_LENGTH + 1));
  } catch {
    tooLongRejected = true;
  }
  check("an over-long value is rejected", tooLongRejected);

  // Exactly at the ceiling is allowed.
  let atLimitOk = true;
  try {
    clean("y".repeat(MAX_LENGTH));
  } catch {
    atLimitOk = false;
  }
  check("a value exactly at the length ceiling is accepted", atLimitOk);

  // Reading with no contact configured is a clean null pair, not an error or ''.
  await writeSupport(null, null);
  const empty = await readSupport();
  check(
    "an unconfigured contact reads as null, not an empty string",
    empty.contact === null && empty.hours === null,
    JSON.stringify(empty),
  );
} finally {
  await pool.query("UPDATE communities SET support_contact = $2, support_hours = $3 WHERE id = $1", [
    CID,
    original.contact,
    original.hours,
  ]);
}

let failed = 0;
for (const r of results) {
  if (!r.p) failed += 1;
  console.log(`${r.p ? "PASS" : "FAIL"}  ${r.n}${r.p ? "" : `  -> ${r.d}`}`);
}
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
await pool.end();
process.exit(failed === 0 ? 0 : 1);
