import nextEnv from "@next/env";
import { readdir } from "node:fs/promises";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { Pool } from "pg";

/**
 * Check that a deployment can actually operate, not just connect.
 *
 * A running app can still be unusable in ways nothing surfaces: migrations half
 * applied, no reviewer promoted (so the moderation queue is invisible to
 * everyone), an empty completion policy, or integrity violations already in the
 * data. This prints a clear report and exits non-zero on a blocking problem, so
 * it can gate a deploy or be run after one.
 *
 * Usage:
 *   node ./scripts/health-check.mjs
 *
 * BLOCKING failures exit 1. Warnings do not, but are listed because they mean a
 * capability is missing rather than broken.
 */

const { loadEnvConfig } = nextEnv;
loadEnvConfig(process.cwd(), process.env.NODE_ENV === "development", {
  info: () => {},
  error: () => {},
});

const connectionString = process.env.DATABASE_URL;
if (!connectionString) {
  console.error("Set DATABASE_URL before running the health check.");
  process.exit(1);
}

const url = new URL(connectionString);
url.searchParams.delete("sslmode");
const pool = new Pool({
  connectionString: url.toString(),
  application_name: "carpool-health-check",
  max: 2,
  connectionTimeoutMillis: 8_000,
  ...(process.env.DATABASE_SSL === "true" ? { ssl: { rejectUnauthorized: true } } : {}),
});

const blocking = [];
const warnings = [];
const ok = [];
const fail = (name, detail) => blocking.push({ name, detail });
const warn = (name, detail) => warnings.push({ name, detail });
const pass = (name, detail) => ok.push({ name, detail });

const EXPECTED_KINDS = [
  "RIDE_REQUESTED",
  "RIDE_ACCEPTED",
  "RIDE_REJECTED",
  "RIDE_CANCELLED",
  "TRIP_CANCELLED",
  "COMPLETION_CONFIRMED",
  "TRIP_COMPLETED",
  "TRIP_DISPUTED",
  "COMPLETION_EXPIRED",
  "SAFETY_REPORT_RECEIVED",
  "SAFETY_REPORT_STATUS_UPDATED",
  "TRIP_DISPUTE_REVIEW_REQUESTED",
];

/** Tables and columns the running app requires; a missing one is fatal. */
const REQUIRED = [
  ["users", ["id", "auth_subject", "display_name", "participant_role", "status"]],
  ["communities", ["id", "name", "status", "support_contact", "support_hours"]],
  ["community_memberships", ["community_id", "user_id", "status", "role"]],
  ["commute_templates", ["id", "community_id", "owner_user_id", "origin_area", "destination_area", "contribution_note"]],
  ["trip_occurrences", ["id", "status", "seat_capacity", "seats_reserved", "contribution_note"]],
  ["ride_requests", ["id", "status", "rider_confirmed_completion", "driver_confirmed_completion"]],
  ["trip_disputes", ["id", "resolved_at", "resolution"]],
  ["safety_reports", ["id", "status", "assigned_to", "resolution_notes"]],
  ["safety_report_events", ["id", "report_id", "to_status"]],
  ["in_app_notifications", ["id", "recipient_user_id", "kind", "event_key", "read_at"]],
  ["trip_no_show_evidence", ["ride_request_id", "outcome"]],
  ["trip_policy", ["id", "completion_window"]],
  ["area_aliases", ["id", "community_id", "alias_area", "canonical_area"]],
  ["idempotency_records", ["actor_user_id", "operation", "key_sha256", "expires_at"]],
  ["schema_migrations", ["version", "checksum"]],
];

// --- Migrations: files on disk must all be recorded as applied -------------
try {
  const directory = new URL("../db/migrations/", import.meta.url);
  const files = (await readdir(directory)).filter((name) => name.endsWith(".sql")).sort();
  const applied = await pool.query("SELECT version, checksum FROM schema_migrations");
  const appliedByVersion = new Map(applied.rows.map((r) => [r.version, r.checksum]));

  const unapplied = files.filter((name) => !appliedByVersion.has(name));
  if (unapplied.length > 0) {
    fail("all migrations applied", `not applied: ${unapplied.join(", ")}. Run: npm run db:migrate`);
  } else {
    pass("all migrations applied", `${files.length} migration(s)`);
  }

  // A checksum mismatch means the database was built from a different file than
  // the one on disk — the schema may not be what the code expects.
  const mismatched = [];
  for (const name of files) {
    const recorded = appliedByVersion.get(name);
    if (!recorded) continue;
    const sql = await readFile(new URL(name, directory), "utf8");
    const checksum = createHash("sha256").update(sql).digest();
    if (!checksum.equals(recorded)) mismatched.push(name);
  }
  if (mismatched.length > 0) {
    warn(
      "migration checksums match disk",
      `${mismatched.join(", ")} differ from the recorded checksum. The runner will refuse to continue; reconcile deliberately if the schema was verified by hand.`,
    );
  } else {
    pass("migration checksums match disk", "");
  }
} catch (error) {
  fail("migrations readable", error.message);
}

// --- Required tables and columns ------------------------------------------
try {
  const result = await pool.query(
    `SELECT table_name, column_name FROM information_schema.columns WHERE table_schema = current_schema()`,
  );
  const byTable = new Map();
  for (const row of result.rows) {
    if (!byTable.has(row.table_name)) byTable.set(row.table_name, new Set());
    byTable.get(row.table_name).add(row.column_name);
  }
  const missing = [];
  for (const [table, columns] of REQUIRED) {
    const present = byTable.get(table);
    if (!present) {
      missing.push(`${table} (whole table)`);
      continue;
    }
    for (const column of columns) {
      if (!present.has(column)) missing.push(`${table}.${column}`);
    }
  }
  if (missing.length > 0) {
    fail("required schema present", `missing: ${missing.join(", ")}`);
  } else {
    pass("required schema present", `${REQUIRED.length} tables`);
  }
} catch (error) {
  fail("schema introspection", error.message);
}

// --- Notification enum has every kind the code can write ------------------
try {
  const result = await pool.query(
    `SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid = e.enumtypid
      WHERE t.typname = 'notification_kind' ORDER BY e.enumsortorder`,
  );
  const present = new Set(result.rows.map((r) => r.enumlabel));
  const missingKinds = EXPECTED_KINDS.filter((k) => !present.has(k));
  if (missingKinds.length > 0) {
    // A missing kind means a state change would throw at runtime.
    fail("notification kinds present", `missing: ${missingKinds.join(", ")}`);
  } else {
    pass("notification kinds present", `${present.size} kind(s)`);
  }
} catch (error) {
  fail("notification kind check", error.message);
}

// --- Append-only guard on safety-report events ---------------------------
try {
  const triggers = await pool.query(
    `SELECT tgname FROM pg_trigger WHERE tgrelid = 'safety_report_events'::regclass AND NOT tgisinternal`,
  );
  const names = new Set(triggers.rows.map((r) => r.tgname));
  const hasUpdate = [...names].some((n) => n.includes("append_only"));
  const hasTruncate = [...names].some((n) => n.includes("no_truncate"));
  if (!hasUpdate || !hasTruncate) {
    fail(
      "safety-report events are append-only",
      `missing guard: ${!hasUpdate ? "UPDATE/DELETE " : ""}${!hasTruncate ? "TRUNCATE" : ""}`.trim(),
    );
  } else {
    pass("safety-report events are append-only", "UPDATE/DELETE + TRUNCATE guards");
  }
} catch (error) {
  fail("append-only guard check", error.message);
}

// --- Marketplace scope and completion policy ------------------------------
try {
  const marketplace = await pool.query(
    `SELECT id, status FROM communities WHERE status = 'ACTIVE' ORDER BY id LIMIT 1`,
  );
  if (marketplace.rowCount !== 1) {
    // No active scope means signup cannot place a user anywhere.
    fail("an active community scope exists", `${marketplace.rowCount} active community row(s)`);
  } else {
    pass("an active community scope exists", marketplace.rows[0].id);
  }
} catch (error) {
  fail("community scope check", error.message);
}

try {
  const policy = await pool.query("SELECT count(*)::int AS n FROM trip_policy WHERE id = true");
  if (policy.rows[0]?.n !== 1) {
    // Without this the completion sweep throws and requests never settle.
    fail("completion policy is configured", "trip_policy row missing");
  } else {
    pass("completion policy is configured", "");
  }
} catch (error) {
  fail("completion policy check", error.message);
}

// --- A reviewer exists (otherwise the queue is unreachable) ---------------
try {
  const reviewers = await pool.query(
    `SELECT count(*)::int AS n FROM community_memberships
      WHERE status = 'ACTIVE' AND role IN ('OPERATOR', 'SAFETY_REVIEWER')`,
  );
  const count = reviewers.rows[0]?.n ?? 0;
  if (count === 0) {
    // Not fatal for a fresh dev database, but a real deployment with reports
    // arriving and no reviewer is an operational failure waiting to happen.
    warn(
      "at least one reviewer exists",
      "no ACTIVE OPERATOR/SAFETY_REVIEWER membership: the moderation queue is unreachable. Run: npm run db:set-reviewer-role -- <email> SAFETY_REVIEWER",
    );
  } else {
    pass("at least one reviewer exists", `${count} account(s)`);
  }
} catch (error) {
  fail("reviewer check", error.message);
}

// --- Integrity: the invariants that must never be violated ----------------
try {
  const checks = [
    ["no trip is overbooked", "SELECT id FROM trip_occurrences WHERE seats_reserved > seat_capacity LIMIT 1"],
    [
      "seats_reserved equals accepted requests",
      `SELECT o.id FROM trip_occurrences o
        WHERE o.status = 'OPEN' AND o.seats_reserved <> (
          SELECT count(*) FROM ride_requests r WHERE r.trip_occurrence_id = o.id AND r.status = 'ACCEPTED') LIMIT 1`,
    ],
    [
      "open disputes match DISPUTED requests",
      `SELECT d.id FROM trip_disputes d JOIN ride_requests r ON r.id = d.ride_request_id
        WHERE d.resolved_at IS NULL AND r.status <> 'DISPUTED' LIMIT 1`,
    ],
    [
      "no stray alias cycles",
      `SELECT a1.id FROM area_aliases a1
        JOIN area_aliases a2 ON a2.community_id = a1.community_id AND a2.alias_area = a1.canonical_area LIMIT 1`,
    ],
  ];
  const violated = [];
  for (const [name, query] of checks) {
    const result = await pool.query(query);
    if (result.rowCount > 0) violated.push(name);
  }
  if (violated.length > 0) {
    fail("data invariants hold", violated.join("; "));
  } else {
    pass("data invariants hold", `${checks.length} invariant(s)`);
  }
} catch (error) {
  fail("integrity check", error.message);
}

// --- Report ----------------------------------------------------------------
console.log("\n=== Carpool health check ===\n");
for (const item of ok) console.log(`OK       ${item.name}${item.detail ? ` — ${item.detail}` : ""}`);
for (const item of warnings) console.log(`WARNING  ${item.name} — ${item.detail}`);
for (const item of blocking) console.log(`FAIL     ${item.name} — ${item.detail}`);

console.log(
  `\n${ok.length} ok, ${warnings.length} warning(s), ${blocking.length} blocking failure(s).`,
);
if (blocking.length > 0) {
  console.log("\nThis deployment is not ready: fix the FAIL items above.");
} else if (warnings.length > 0) {
  console.log("\nUsable, but the warnings above mean a capability is missing.");
} else {
  console.log("\nNo blocking problems found.");
}

await pool.end();
process.exit(blocking.length === 0 ? 0 : 1);
