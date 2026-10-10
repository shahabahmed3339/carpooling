/**
 * Exercise the display-only cost-sharing note against a real database.
 *
 * The note is copied from a commute onto each trip occurrence when a date is
 * published. The behaviours worth protecting are the ones that are easy to break
 * silently:
 *   - the note reaches the published trip at all,
 *   - editing the commute afterwards does NOT rewrite an already published trip
 *     (a trip advertises the terms it was published with),
 *   - the length ceiling is enforced by the database, not only by the app,
 *   - an empty note is stored as NULL rather than an empty string.
 *
 * Cleans up after itself and exits non-zero on failure.
 *
 * Run from web/: node scripts/verify-contribution.mjs
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
  max: 1,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: true } : undefined,
});

const CID = "00000000-0000-4000-8000-000000000002";
const results = [];
const check = (n, p, d) => results.push({ n, p, d });
const tag = `cnt${randomUUID().slice(0, 8)}`;

/**
 * The real publish service, imported from the server source. The previous
 * version mirrored its INSERT by hand (including the `contribution_note` copy),
 * so a change to how a trip snapshots the note would not have been observed.
 */
const { createTripOccurrence } = await import("@/server/rides/requests");

const account = await pool.query(
  `SELECT u.id FROM users u JOIN community_memberships m ON m.user_id = u.id AND m.community_id = $1
    WHERE u.status='ACTIVE' AND m.status='ACTIVE' LIMIT 1`,
  [CID],
);
const driver = account.rows[0].id;
const commuteId = randomUUID();
const trips = [];

/** Publish a date through the real service; returns the created trip row. */
async function publish(date) {
  const result = await createTripOccurrence({
    actor: { userId: driver, email: `${driver}@verify.local`, communityId: CID, participantRole: "DRIVER" },
    commuteTemplateId: commuteId,
    tripDate: date,
    idempotencyKey: randomUUID(),
  });
  const tripId = result.body.tripOccurrenceId;
  trips.push(tripId);
  const row = await pool.query(
    "SELECT id, contribution_note FROM trip_occurrences WHERE id = $1",
    [tripId],
  );
  return row.rows[0];
}

try {
  await pool.query(
    `INSERT INTO commute_templates (id, community_id, owner_user_id, origin_area, destination_area,
       departure_window_start, departure_window_end, role, seats_offered, contribution_note)
     VALUES ($1,$2,$3,$4,$5,'08:00','08:20','OFFERING',2,'Share fuel cost')`,
    [commuteId, CID, driver, `${tag}G`, `${tag}D`],
  );
  // The real publish service only accepts a date the commute's weekdays cover.
  for (const weekday of [0, 1, 2]) {
    await pool.query(
      "INSERT INTO commute_template_weekdays (commute_template_id, weekday) VALUES ($1, $2)",
      [commuteId, weekday],
    );
  }

  const first = await publish("2099-01-04");
  check("published trip exists", Boolean(first?.id), JSON.stringify(first));
  check("contribution note is copied to the published trip", first?.contribution_note === "Share fuel cost", JSON.stringify(first));

  // Editing the commute must not change the trip that is already published.
  await pool.query("UPDATE commute_templates SET contribution_note = 'Changed later' WHERE id = $1", [commuteId]);
  const still = await pool.query("SELECT contribution_note FROM trip_occurrences WHERE id = $1", [first.id]);
  check(
    "editing the commute does not rewrite an already published trip",
    still.rows[0]?.contribution_note === "Share fuel cost",
    JSON.stringify(still.rows[0]),
  );

  // A later publication picks up the new note.
  const second = await publish("2099-01-05");
  check("a later publication uses the current note", second?.contribution_note === "Changed later", JSON.stringify(second));

  // With no note anywhere, the stored value is NULL, not an empty string.
  const commuteId2 = randomUUID();
  await pool.query(
    `INSERT INTO commute_templates (id, community_id, owner_user_id, origin_area, destination_area,
       departure_window_start, departure_window_end, role, seats_offered, contribution_note)
     VALUES ($1,$2,$3,$4,$5,'09:00','09:20','OFFERING',1,NULL)`,
    [commuteId2, CID, driver, `${tag}G2`, `${tag}D2`],
  );
  await pool.query(
    "INSERT INTO commute_template_weekdays (commute_template_id, weekday) VALUES ($1, 2)",
    [commuteId2],
  );
  // Publish through the same real service under the no-note commute.
  const noneResult = await createTripOccurrence({
    actor: { userId: driver, email: `${driver}@verify.local`, communityId: CID, participantRole: "DRIVER" },
    commuteTemplateId: commuteId2,
    tripDate: "2099-01-06",
    idempotencyKey: randomUUID(),
  });
  trips.push(noneResult.body.tripOccurrenceId);
  const noNote = await pool.query(
    "SELECT contribution_note FROM trip_occurrences WHERE id = $1",
    [noneResult.body.tripOccurrenceId],
  );
  check("an absent note is stored as NULL", noNote.rows[0]?.contribution_note === null, JSON.stringify(noNote.rows[0]));

  // The ceiling is enforced by the schema, independently of the application.
  let ceilingEnforced = false;
  try {
    await pool.query("UPDATE commute_templates SET contribution_note = $2 WHERE id = $1", [commuteId, "x".repeat(161)]);
  } catch {
    ceilingEnforced = true;
  }
  check("over-long note is rejected by the database", ceilingEnforced);

  await pool.query("DELETE FROM commute_templates WHERE id = $1", [commuteId2]).catch(() => {});
} finally {
  for (const id of trips) await pool.query("DELETE FROM trip_occurrences WHERE id = $1", [id]).catch(() => {});
  await pool.query("DELETE FROM commute_templates WHERE id = $1", [commuteId]).catch(() => {});
}

let failed = 0;
for (const r of results) {
  if (!r.p) failed += 1;
  console.log(`${r.p ? "PASS" : "FAIL"}  ${r.n}${r.p ? "" : `  -> ${r.d}`}`);
}
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
await pool.end();
process.exit(failed === 0 ? 0 : 1);
