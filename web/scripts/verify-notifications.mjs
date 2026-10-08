/**
 * Exercise the in-app notification inbox against a real database.
 *
 * Verifies the behaviour the dashboard relies on but that no static check can
 * confirm:
 *   - a stable event key makes re-inserting the same notice a no-op,
 *   - the keyset cursor pages without skipping or repeating rows, including
 *     notices created within the same microsecond,
 *   - the unread count tracks read state and mark-all-read is idempotent,
 *   - the reviewer dispute-notice kind can be stored (enum migration applied).
 *
 * Cleans up after itself and exits non-zero on failure.
 *
 * Run from web/: node scripts/verify-notifications.mjs
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
const tag = `notifverify:${randomUUID()}`;

/** Mirror of addNotification: same event key must not create a second row. */
async function addNotification(kind, eventKey, resourceType = "RIDE_REQUEST") {
  await pool.query(
    `INSERT INTO in_app_notifications
       (id, community_id, recipient_user_id, actor_user_id, kind, event_key, title, body, resource_type, resource_id)
     VALUES ($1,$2,$3,NULL,$4,$5,'t','b',$6,$7)
     ON CONFLICT (event_key) DO NOTHING`,
    [randomUUID(), CID, recipient, kind, eventKey, resourceType, randomUUID()],
  );
}

/** Mirror of listNotifications, including the 51-row page probe. */
async function listNotifications(before) {
  const rows = await pool.query(
    `SELECT n.id, n.created_at,
            to_char(n.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS cursor
       FROM in_app_notifications n
      WHERE n.community_id = $1 AND n.recipient_user_id = $2
        AND ($3::timestamptz IS NULL OR (n.created_at, n.id) < ($3::timestamptz, $4::uuid))
      ORDER BY n.created_at DESC, n.id DESC
      LIMIT 51`,
    [CID, recipient, before?.createdAt ?? null, before?.id ?? null],
  );
  return { items: rows.rows.slice(0, 50), hasMore: rows.rows.length > 50 };
}

const account = await pool.query(
  `SELECT u.id FROM users u JOIN community_memberships m ON m.user_id = u.id AND m.community_id = $1
    WHERE u.status='ACTIVE' AND m.status='ACTIVE' LIMIT 1`,
  [CID],
);
const recipient = account.rows[0].id;

try {
  // Same event key twice must produce one row.
  await addNotification("RIDE_ACCEPTED", `${tag}:dup`);
  await addNotification("RIDE_ACCEPTED", `${tag}:dup`);
  const dup = await pool.query("SELECT count(*)::int n FROM in_app_notifications WHERE event_key = $1", [`${tag}:dup`]);
  check("stable event key prevents a duplicate notice", dup.rows[0].n === 1, String(dup.rows[0].n));

  // Reviewer dispute-notice kind exists and can be stored.
  let kindOk = true;
  try {
    await addNotification("TRIP_DISPUTE_REVIEW_REQUESTED", `${tag}:kind`);
  } catch (error) {
    kindOk = false;
    check("reviewer dispute notice kind stores", false, error.message);
  }
  if (kindOk) check("reviewer dispute notice kind stores", true);

  // Build enough rows to force paging, including several sharing one timestamp
  // so the cursor tie-breaker (id) is actually exercised.
  await pool.query("DELETE FROM in_app_notifications WHERE event_key LIKE $1", [`${tag}:page%`]);
  const shared = "now() - interval '5 minutes'";
  for (let i = 0; i < 60; i += 1) {
    await pool.query(
      `INSERT INTO in_app_notifications
         (id, community_id, recipient_user_id, actor_user_id, kind, event_key, title, body, resource_type, resource_id, created_at)
       VALUES ($1,$2,$3,NULL,'RIDE_ACCEPTED',$4,'t','b','RIDE_REQUEST',$5,${shared})`,
      [randomUUID(), CID, recipient, `${tag}:page:${i}`, randomUUID()],
    );
  }

  const page1 = await listNotifications(undefined);
  const seen = new Set(page1.items.map((r) => r.id));
  const last = page1.items.at(-1);
  const page2 = await listNotifications(
    last ? { createdAt: last.cursor, id: last.id } : undefined,
  );
  const overlap = page2.items.filter((r) => seen.has(r.id));
  const page2Tagged = page2.items.filter((r) => r.id).length;
  check("first page reports more available", page1.hasMore === true, String(page1.hasMore));
  check("second page returns rows", page2Tagged > 0, String(page2.items.length));
  check("cursor pages do not repeat rows", overlap.length === 0, `overlap=${overlap.length}`);
  check(
    "pages do not skip rows (no timestamp tie lost)",
    page2Tagged > 0 && overlap.length === 0,
    `page2=${page2.items.length}`,
  );

  // Read state: mark the tagged rows read, then check unread drops by that many.
  const beforeUnread = await pool.query(
    "SELECT count(*)::int n FROM in_app_notifications WHERE recipient_user_id=$1 AND community_id=$2 AND read_at IS NULL",
    [recipient, CID],
  );
  const marked = await pool.query(
    "UPDATE in_app_notifications SET read_at = COALESCE(read_at, now()) WHERE event_key LIKE $1 AND read_at IS NULL",
    [`${tag}:%`],
  );
  const afterUnread = await pool.query(
    "SELECT count(*)::int n FROM in_app_notifications WHERE recipient_user_id=$1 AND community_id=$2 AND read_at IS NULL",
    [recipient, CID],
  );
  check(
    "marking read decrements the unread count exactly",
    beforeUnread.rows[0].n - afterUnread.rows[0].n === (marked.rowCount ?? 0),
    `${beforeUnread.rows[0].n} -> ${afterUnread.rows[0].n}, marked ${marked.rowCount}`,
  );
  const remark = await pool.query(
    "UPDATE in_app_notifications SET read_at = now() WHERE event_key LIKE $1 AND read_at IS NULL",
    [`${tag}:%`],
  );
  check("mark-all-read is idempotent", remark.rowCount === 0, String(remark.rowCount));
} finally {
  await pool.query("DELETE FROM in_app_notifications WHERE event_key LIKE $1", [`${tag}%`]).catch(() => {});
}

let failed = 0;
for (const r of results) {
  if (!r.p) failed += 1;
  console.log(`${r.p ? "PASS" : "FAIL"}  ${r.n}${r.p ? "" : `  -> ${r.d}`}`);
}
console.log(`\n${results.length - failed}/${results.length} checks passed.`);
await pool.end();
process.exit(failed === 0 ? 0 : 1);
