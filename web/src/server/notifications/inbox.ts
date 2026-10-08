import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { AuthenticatedActor } from "@/server/auth/actor";
import { assertActiveCommunityMember } from "@/server/community/access";
import { inTransaction } from "@/server/db/pool";
import { notFound } from "@/server/rides/errors";

export type NotificationKind =
  | "RIDE_REQUESTED"
  | "RIDE_ACCEPTED"
  | "RIDE_REJECTED"
  | "RIDE_CANCELLED"
  | "TRIP_CANCELLED"
  | "COMPLETION_CONFIRMED"
  | "TRIP_COMPLETED"
  | "TRIP_DISPUTED"
  | "TRIP_DISPUTE_REVIEW_REQUESTED"
  | "TRIP_DISPUTE_RESOLVED"
  | "COMPLETION_EXPIRED"
  | "SAFETY_REPORT_RECEIVED"
  | "SAFETY_REPORT_STATUS_UPDATED";

export async function addNotification(client: PoolClient, input: {
  communityId: string;
  recipientUserId: string;
  actorUserId: string | null;
  kind: NotificationKind;
  eventKey: string;
  title: string;
  body: string;
  resourceType: "RIDE_REQUEST" | "TRIP_OCCURRENCE" | "SAFETY_REPORT";
  resourceId: string;
}): Promise<void> {
  if (input.recipientUserId === input.actorUserId) return;
  await client.query(
    `INSERT INTO in_app_notifications
       (id, community_id, recipient_user_id, actor_user_id, kind, event_key, title, body, resource_type, resource_id)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (event_key) DO NOTHING`,
    [randomUUID(), input.communityId, input.recipientUserId, input.actorUserId, input.kind, input.eventKey,
      input.title, input.body, input.resourceType, input.resourceId],
  );
}

export type InboxNotification = {
  id: string;
  kind: NotificationKind;
  title: string;
  body: string;
  resourceType: "RIDE_REQUEST" | "TRIP_OCCURRENCE" | "SAFETY_REPORT";
  resourceId: string;
  createdAt: string;
  cursorCreatedAt: string;
  readAt: string | null;
};

export async function listNotifications(
  actor: AuthenticatedActor,
  before?: { createdAt: string; id: string },
): Promise<{ notifications: InboxNotification[]; unreadCount: number; hasMore: boolean }> {
  return inTransaction(async (client) => {
    await assertActiveCommunityMember(client, actor.communityId, actor.userId);
    const result = await client.query<InboxNotification & { unreadCount: string }>(
      `SELECT n.id,
              n.kind,
              n.title,
              n.body,
              n.resource_type AS "resourceType",
              n.resource_id AS "resourceId",
              to_char(n.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS "createdAt",
              to_char(n.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS "cursorCreatedAt",
              CASE WHEN n.read_at IS NULL THEN NULL ELSE to_char(n.read_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') END AS "readAt"
         FROM in_app_notifications n
        WHERE n.community_id = $1 AND n.recipient_user_id = $2
          AND ($3::timestamptz IS NULL OR (n.created_at, n.id) < ($3::timestamptz, $4::uuid))
        ORDER BY n.created_at DESC, n.id DESC
        LIMIT 51`,
      [actor.communityId, actor.userId, before?.createdAt ?? null, before?.id ?? null],
    );
    const unreadResult = await client.query<{ unreadCount: string }>(
      `SELECT count(*)::text AS "unreadCount" FROM in_app_notifications
        WHERE community_id = $1 AND recipient_user_id = $2 AND read_at IS NULL`,
      [actor.communityId, actor.userId],
    );
    const unreadCount = Number(unreadResult.rows[0]?.unreadCount ?? 0);
    const hasMore = result.rows.length > 50;
    const notifications = result.rows.slice(0, 50).map(({ id, kind, title, body, resourceType, resourceId, createdAt, cursorCreatedAt, readAt }) => ({
      id, kind, title, body, resourceType, resourceId, createdAt, cursorCreatedAt, readAt,
    }));
    return { notifications, unreadCount, hasMore };
  });
}

export async function markNotificationRead(actor: AuthenticatedActor, notificationId: string): Promise<void> {
  await inTransaction(async (client) => {
    await assertActiveCommunityMember(client, actor.communityId, actor.userId);
    const result = await client.query(
      `UPDATE in_app_notifications SET read_at = COALESCE(read_at, now())
        WHERE id = $1 AND community_id = $2 AND recipient_user_id = $3
        RETURNING id`,
      [notificationId, actor.communityId, actor.userId],
    );
    if (result.rowCount !== 1) throw notFound();
  });
}

export async function markAllNotificationsRead(actor: AuthenticatedActor): Promise<number> {
  return inTransaction(async (client) => {
    await assertActiveCommunityMember(client, actor.communityId, actor.userId);
    const result = await client.query(
      `UPDATE in_app_notifications SET read_at = now()
        WHERE community_id = $1 AND recipient_user_id = $2 AND read_at IS NULL`,
      [actor.communityId, actor.userId],
    );
    return result.rowCount ?? 0;
  });
}
