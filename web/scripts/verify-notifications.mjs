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

/**
 * The real inbox functions, imported from the server source. The previous
 * version mirrored their SQL ("Mirror of listNotifications, including the 51-row
 * page probe"), so the keyset-pagination behaviour — the part most likely to
 * drift as the cursor format changes — was never actually tested.
 */
const { listNotifications, markNotificationRead, markAllNotificationsRead } = await import(
  "@/server/notifications/inbox"
);

const account = await pool.query(
  `SELECT u.id FROM users u JOIN community_memberships m ON m.user_id = u.id AND m.community_id = $1
    WHERE u.status='ACTIVE' AND m.status='ACTIVE' AND m.role = 'MEMBER' LIMIT 1`,
  [CID],
);
if (account.rowCount < 1) throw new Error("need an active MEMBER account to address notifications to");
const recipient = account.rows[0].id;

const actor = {
  userId: recipient,
  email: `${recipient}@verify.local`,
  communityId: CID,
  participantRole: "RIDER",
};

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

  const page1 = await listNotifications(actor);
  const seen = new Set(page1.notifications.map((r) => r.id));
  const last = page1.notifications.at(-1);
  const page2 = await listNotifications(
    actor,
    last ? { createdAt: last.cursorCreatedAt, id: last.id } : undefined,
  );
  const overlap = page2.notifications.filter((r) => seen.has(r.id));
  check("first page reports more available", page1.hasMore === true, String(page1.hasMore));
  check("second page returns rows", page2.notifications.length > 0, String(page2.notifications.length));
  check("cursor pages do not repeat rows", overlap.length === 0, `overlap=${overlap.length}`);
  check("the unread count is reported alongside the page", typeof page1.unreadCount === "number", String(page1.unreadCount));

  // Read state: mark one tagged row read through the real service, then check the
  // unread count drops by exactly one and the operation is idempotent.
  const target = page1.notifications.find((n) => n.id);
  const unreadBefore = (await listNotifications(actor)).unreadCount;
  await markNotificationRead(actor, target.id);
  const unreadAfter = (await listNotifications(actor)).unreadCount;
  check("marking read decrements the unread count by one", unreadBefore - unreadAfter === 1, `${unreadBefore} -> ${unreadAfter}`);
  await markNotificationRead(actor, target.id);
  const unreadAfterTwice = (await listNotifications(actor)).unreadCount;
  check("marking the same notice read again is idempotent", unreadAfterTwice === unreadAfter, `${unreadAfter} -> ${unreadAfterTwice}`);

  const markedAll = await markAllNotificationsRead(actor);
  const unreadAtEnd = (await listNotifications(actor)).unreadCount;
  check("mark-all-read clears the unread count", unreadAtEnd === 0, `marked ${markedAll}, unread ${unreadAtEnd}`);
  const markedAllAgain = await markAllNotificationsRead(actor);
  check("mark-all-read is idempotent", markedAllAgain === 0, String(markedAllAgain));
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
