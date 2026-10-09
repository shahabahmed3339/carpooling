/**
 * Verify cross-table data integrity for the newer features.
 *
 * `verify-completion.mjs` covers trip/request completion invariants. This covers
 * the areas added since — disputes, notifications, safety reports, cost sharing,
 * and account closure — because a defect there is silent: the UI reads
 * consistently from a bad row, so nothing looks wrong until a participant is
 * affected. Every check is read-only and reports the offending row ids.
 *
 * Run from web/: node scripts/verify-integrity.mjs
 */
import nextEnv from "@next/env";
import { Pool } from "pg";

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd(), true, { info: () => {}, error: () => {} });
if (!process.env.DATABASE_URL) {
  // loadEnvConfig reads .env.local from the current directory, so running this
  // from the repository root silently finds no DATABASE_URL. Say so plainly
  // instead of failing on `new URL(undefined)`.
  console.error("verify-integrity must run from web/ (it reads web/.env.local). cd web && node scripts/verify-integrity.mjs");
  process.exit(1);
}
const url = new URL(process.env.DATABASE_URL);
url.searchParams.delete("sslmode");
const pool = new Pool({
  connectionString: url.toString(),
  max: 2,
  ssl: process.env.DATABASE_SSL === "true" ? { rejectUnauthorized: true } : undefined,
});

const results = [];
const check = (name, pass, detail) => results.push({ name, pass, detail });

async function sql(name, query, detailOf = (rows) => JSON.stringify(rows.slice(0, 5))) {
  const result = await pool.query(query);
  check(name, result.rowCount === 0, result.rowCount === 0 ? "" : detailOf(result.rows));
}

try {
  // --- Disputes -----------------------------------------------------------
  // A dispute must belong to a request in the same community, and an unresolved
  // dispute must correspond to a request that is actually DISPUTED. A resolved
  // dispute that left its request stranded would silently block review forever.
  await sql(
    "no dispute points at a request in another community",
    `SELECT d.id FROM trip_disputes d
       JOIN ride_requests r ON r.id = d.ride_request_id
      WHERE r.community_id <> d.community_id LIMIT 5`,
  );
  await sql(
    "an open dispute has a DISPUTED request",
    `SELECT d.id, r.status FROM trip_disputes d
       JOIN ride_requests r ON r.id = d.ride_request_id
      WHERE d.resolved_at IS NULL AND r.status <> 'DISPUTED' LIMIT 5`,
  );
  await sql(
    "an unresolved dispute never carries a resolution note",
    `SELECT id FROM trip_disputes
      WHERE resolved_at IS NULL AND resolution IS NOT NULL LIMIT 5`,
  );
  await sql(
    "a resolved dispute records when it was resolved",
    `SELECT id FROM trip_disputes
      WHERE resolved_at IS NOT NULL AND resolution IS NULL LIMIT 5`,
  );

  // A request only becomes COMPLETED when both sides confirmed. Migration 0024
  // makes that a database constraint, so a one-sided COMPLETED cannot exist;
  // this is the check that would have caught the rows it repaired.
  await sql(
    "no request is COMPLETED without both confirmations",
    `SELECT id FROM ride_requests
      WHERE status = 'COMPLETED'
        AND (rider_confirmed_completion = false OR driver_confirmed_completion = false OR completed_at IS NULL)
      LIMIT 5`,
  );

  // --- Notifications ------------------------------------------------------
  // Every notice must name a recipient that still exists and belong to the same
  // community as the row it describes. A dangling recipient would be invisible
  // to everyone while still occupying an event key.
  await sql(
    "every notification recipient exists",
    `SELECT n.id FROM in_app_notifications n
       LEFT JOIN users u ON u.id = n.recipient_user_id
      WHERE u.id IS NULL LIMIT 5`,
  );
  await sql(
    "every notification community exists",
    `SELECT n.id FROM in_app_notifications n
       LEFT JOIN communities c ON c.id = n.community_id
      WHERE c.id IS NULL LIMIT 5`,
  );
  await sql(
    "a notification is not sent to its own actor",
    `SELECT id FROM in_app_notifications
      WHERE actor_user_id IS NOT NULL AND actor_user_id = recipient_user_id LIMIT 5`,
  );

  // --- Safety reports -----------------------------------------------------
  await sql(
    "no safety report points at a request in another community",
    `SELECT r.id FROM safety_reports r
       JOIN trip_occurrences o ON o.id = r.trip_occurrence_id
      WHERE o.community_id <> r.community_id LIMIT 5`,
  );
  await sql(
    "a safety report's participants are both members of its community",
    `SELECT r.id FROM safety_reports r
      WHERE NOT EXISTS (SELECT 1 FROM community_memberships m
                         WHERE m.community_id = r.community_id AND m.user_id = r.reporter_user_id)
         OR NOT EXISTS (SELECT 1 FROM community_memberships m
                         WHERE m.community_id = r.community_id AND m.user_id = r.reported_user_id)
      LIMIT 5`,
  );
  // Reviewer-only history must agree with the report's current status.
  await sql(
    "the latest audit event matches the report's current status",
    `SELECT r.id, r.status, e.to_status
       FROM safety_reports r
       JOIN LATERAL (
         SELECT to_status FROM safety_report_events ev
          WHERE ev.report_id = r.id
          ORDER BY ev.created_at DESC, ev.id DESC LIMIT 1
       ) e ON true
      WHERE e.to_status <> r.status LIMIT 10`,
  );
  await sql(
    "a closed safety report is assigned to a reviewer",
    `SELECT id FROM safety_reports
      WHERE status IN ('RESOLVED','DISMISSED') AND assigned_to IS NULL LIMIT 5`,
  );

  // --- Cost sharing -------------------------------------------------------
  // The schema already forbids blank or over-long notes, so re-checking that
  // would be a vacuously-true check that only looks like coverage. What the
  // schema cannot express is that a published trip carries the note its commute
  // had *at publication time*: a trip must never carry a note that no version of
  // its commute ever had. Compare against the commute's current note only when no
  // edit has occurred since publication (updated_at <= created_at).
  await sql(
    "a published trip's note is never one its current commute never had",
    `SELECT o.id, o.contribution_note, t.contribution_note AS commute_note
       FROM trip_occurrences o
       JOIN commute_templates t ON t.id = o.commute_template_id
      WHERE o.contribution_note IS NOT NULL
        AND t.updated_at <= o.created_at
        AND o.contribution_note IS DISTINCT FROM t.contribution_note
      LIMIT 5`,
  );

  // --- Account closure ----------------------------------------------------
  // A closed account must not retain a sign-in identity or an active membership,
  // and must not have been erased to an ambiguous value.
  await sql(
    "deactivated accounts have no live auth subject",
    `SELECT id FROM users WHERE status = 'DEACTIVATED' AND auth_subject NOT LIKE 'deleted:%' LIMIT 5`,
  );
  await sql(
    "deactivated accounts keep no real display name",
    `SELECT id, display_name FROM users WHERE status = 'DEACTIVATED' AND display_name <> 'Closed account' LIMIT 5`,
  );
  await sql(
    "deactivated accounts hold no ACTIVE membership",
    `SELECT m.user_id FROM community_memberships m
       JOIN users u ON u.id = m.user_id
      WHERE u.status = 'DEACTIVATED' AND m.status = 'ACTIVE' LIMIT 5`,
  );
  await sql(
    "a deactivated account left no open ride request",
    `SELECT r.id FROM ride_requests r
       JOIN users u ON u.id = r.rider_user_id
      WHERE u.status = 'DEACTIVATED' AND r.status IN ('REQUESTED','ACCEPTED') LIMIT 5`,
  );

  // --- Memberships --------------------------------------------------------
  await sql(
    "every membership references an existing community",
    `SELECT m.user_id FROM community_memberships m
       LEFT JOIN communities c ON c.id = m.community_id WHERE c.id IS NULL LIMIT 5`,
  );

  // --- Area aliases -------------------------------------------------------
  // An alias is what makes two spellings match, so a broken row silently widens
  // or narrows matching for everyone in the scope. The schema forbids self-
  // aliases, so the checks here are the ones it cannot express.
  await sql(
    "every area alias belongs to an existing community",
    `SELECT a.alias_area FROM area_aliases a
       LEFT JOIN communities c ON c.id = a.community_id WHERE c.id IS NULL LIMIT 5`,
  );
  await sql(
    "no alias points at itself",
    `SELECT alias_area FROM area_aliases WHERE alias_area = canonical_area LIMIT 5`,
  );
  await sql(
    "no alias is unnormalized (blank or untrimmed)",
    `SELECT alias_area FROM area_aliases
      WHERE alias_area <> lower(regexp_replace(trim(alias_area), '[[:space:]]+', ' ', 'g'))
         OR canonical_area <> lower(regexp_replace(trim(canonical_area), '[[:space:]]+', ' ', 'g'))
      LIMIT 5`,
  );
  // A cycle (a -> b -> a) would make resolution non-deterministic: the service
  // rejects it and this confirms none slipped in. Also covers an alias that
  // shadows another alias's canonical, which is the same shape.
  await sql(
    "no alias chain forms a cycle",
    `SELECT a1.alias_area FROM area_aliases a1
       JOIN area_aliases a2
         ON a2.community_id = a1.community_id AND a2.alias_area = a1.canonical_area
      LIMIT 5`,
  );

  // --- Support contact ----------------------------------------------------
  // A blank support contact cannot exist: the schema CHECK forbids it. Re-checking
  // that here would be a vacuously-true check, so this target is deliberately
  // skipped. The length ceiling is likewise enforced by the schema, and the
  // trim-to-NULL behaviour is covered by `npm run verify:support`.

  const summary = await pool.query(`
    SELECT
      (SELECT count(*)::int FROM users WHERE status = 'ACTIVE') AS active_users,
      (SELECT count(*)::int FROM users WHERE status = 'DEACTIVATED') AS closed_users,
      (SELECT count(*)::int FROM trip_occurrences) AS trips,
      (SELECT count(*)::int FROM ride_requests) AS requests,
      (SELECT count(*)::int FROM trip_disputes WHERE resolved_at IS NULL) AS open_disputes,
      (SELECT count(*)::int FROM safety_reports WHERE status IN ('RECEIVED','IN_REVIEW')) AS open_reports,
      (SELECT count(*)::int FROM in_app_notifications) AS notifications,
      (SELECT count(*)::int FROM area_aliases) AS area_aliases,
      (SELECT count(*)::int FROM communities WHERE support_contact IS NOT NULL) AS communities_with_support`);
  console.log("\nSummary:", JSON.stringify(summary.rows[0]));
} catch (error) {
  console.error("verify-integrity failed:", error.message);
  await pool.end().catch(() => {});
  process.exit(1);
}

let failed = 0;
for (const r of results) {
  if (!r.pass) failed += 1;
  console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.name}${r.pass ? "" : `  -> ${r.detail}`}`);
}
console.log(`\n${results.length - failed}/${results.length} integrity checks hold.`);
await pool.end();
process.exit(failed === 0 ? 0 : 1);
