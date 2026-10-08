import { listNotifications, markAllNotificationsRead, markNotificationRead } from "@/server/notifications/inbox";
import { HttpInputError, readJsonObject, requireUuid, withActor } from "@/server/http/responses";

export async function GET(request: Request): Promise<Response> {
  return withActor(async (actor) => {
    const params = new URL(request.url).searchParams;
    const beforeCreatedAt = params.get("beforeCreatedAt");
    const beforeId = params.get("beforeId");
    if ((beforeCreatedAt === null) !== (beforeId === null)) {
      throw new HttpInputError("Both notification cursor values are required.");
    }
    let before: { createdAt: string; id: string } | undefined;
    if (beforeCreatedAt !== null && beforeId !== null) {
      const timestampMatch = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.\d{1,6})?Z$/.exec(beforeCreatedAt);
      const timestampDate = timestampMatch && new Date(Date.UTC(
        Number(timestampMatch[1]), Number(timestampMatch[2]) - 1, Number(timestampMatch[3]),
        Number(timestampMatch[4]), Number(timestampMatch[5]), Number(timestampMatch[6]),
      ));
      if (!timestampMatch || !timestampDate || timestampDate.getUTCFullYear() !== Number(timestampMatch[1]) ||
        timestampDate.getUTCMonth() !== Number(timestampMatch[2]) - 1 || timestampDate.getUTCDate() !== Number(timestampMatch[3]) ||
        Number(timestampMatch[4]) > 23 || Number(timestampMatch[5]) > 59 || Number(timestampMatch[6]) > 59) {
        throw new HttpInputError("Notification cursor date is invalid.");
      }
      before = { createdAt: beforeCreatedAt, id: requireUuid(beforeId, "beforeId") };
    }
    return Response.json(await listNotifications(actor, before));
  });
}

export async function PATCH(request: Request): Promise<Response> {
  return withActor(async (actor) => {
    const body = await readJsonObject(request);
    if (body.markAll === true) {
      const updated = await markAllNotificationsRead(actor);
      return Response.json({ updated });
    }
    if (typeof body.id !== "string") throw new HttpInputError("Notification id is required.");
    await markNotificationRead(actor, requireUuid(body.id, "id"));
    return Response.json({ updated: 1 });
  });
}
