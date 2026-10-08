import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { parseClockMinutes, normalizeArea } from "@/domain/clock";
import { assertActiveCommunityMember, assertParticipantRole } from "@/server/community/access";
import { withIdempotency, type IdempotentResult } from "@/server/db/idempotency";
import { inTransaction } from "@/server/db/pool";
import { conflict, invalid, notFound } from "@/server/rides/errors";
import type { AuthenticatedActor } from "@/server/auth/actor";

export type CommuteRole = "OFFERING" | "SEEKING" | "EITHER";

export type CommuteTemplateInput = {
  originArea: string;
  destinationArea: string;
  departureWindowStart: string;
  departureWindowEnd: string;
  weekdays: number[];
  role: CommuteRole;
  seatsOffered: number;
};

export type CommuteTemplateRecord = CommuteTemplateInput & {
  id: string;
  timezone: "Asia/Karachi";
  isActive: boolean;
  version: number;
};

function normalizeInput(input: CommuteTemplateInput): CommuteTemplateInput {
  const originArea = normalizeArea(input.originArea);
  const destinationArea = normalizeArea(input.destinationArea);
  const start = parseClockMinutes(input.departureWindowStart);
  const end = parseClockMinutes(input.departureWindowEnd);

  if (originArea === null) {
    throw invalid("INVALID_ORIGIN_AREA", "Origin area must be 1 to 120 characters.");
  }
  if (destinationArea === null) {
    throw invalid("INVALID_DESTINATION_AREA", "Destination area must be 1 to 120 characters.");
  }
  if (start === null || end === null || start > end) {
    throw invalid("INVALID_DEPARTURE_WINDOW", "Departure window must be a valid, ordered local time range.");
  }
  if (
    input.weekdays.length < 1 ||
    input.weekdays.some((day) => !Number.isInteger(day) || day < 0 || day > 6) ||
    new Set(input.weekdays).size !== input.weekdays.length
  ) {
    throw invalid("INVALID_WEEKDAYS", "Choose one or more unique weekdays.");
  }
  if (!(["OFFERING", "SEEKING", "EITHER"] as const).includes(input.role)) {
    throw invalid("INVALID_COMMUTE_ROLE", "Choose a supported commute role.");
  }
  if (!Number.isInteger(input.seatsOffered) || input.seatsOffered < 0 || input.seatsOffered > 8) {
    throw invalid("INVALID_SEAT_COUNT", "Seats offered must be a whole number from 0 to 8.");
  }
  if (input.role === "OFFERING" && input.seatsOffered < 1) {
    throw invalid("SEATS_REQUIRED", "A commute offering rides must offer at least one seat.");
  }
  if (input.role === "SEEKING" && input.seatsOffered !== 0) {
    throw invalid("SEATS_NOT_ALLOWED", "A ride-seeking commute cannot offer seats.");
  }

  return {
    ...input,
    originArea,
    destinationArea,
    weekdays: [...input.weekdays].sort((a, b) => a - b),
  };
}

async function insertWeekdays(
  client: PoolClient,
  commuteTemplateId: string,
  weekdays: number[],
): Promise<void> {
  await client.query(
    `INSERT INTO commute_template_weekdays (commute_template_id, weekday)
     SELECT $1, days.weekday::smallint FROM unnest($2::int[]) AS days(weekday)`,
    [commuteTemplateId, weekdays],
  );
}

export async function createCommuteTemplate(input: {
  actor: AuthenticatedActor;
  commute: CommuteTemplateInput;
  idempotencyKey: string;
}): Promise<IdempotentResult<CommuteTemplateRecord>> {
  const commute = normalizeInput(input.commute);
  assertParticipantRole(input.actor.participantRole, commute.role === "OFFERING" ? "DRIVER" : "RIDER");
  if (commute.role === "EITHER") throw invalid("INVALID_COMMUTE_ROLE", "Choose the role associated with your account.");

  return inTransaction(async (client) => {
    await assertActiveCommunityMember(client, input.actor.communityId, input.actor.userId);

    return withIdempotency<CommuteTemplateRecord>({
      client,
      actorUserId: input.actor.userId,
      operation: "commute-template.create",
      key: input.idempotencyKey,
      requestFingerprint: JSON.stringify({
        communityId: input.actor.communityId,
        commute,
      }),
      work: async () => {
        const id = randomUUID();
        await client.query(
          `INSERT INTO commute_templates (
             id, community_id, owner_user_id, origin_area, destination_area,
             departure_window_start, departure_window_end, timezone,
             role, seats_offered
           ) VALUES ($1, $2, $3, $4, $5, $6::time, $7::time, 'Asia/Karachi', $8, $9)`,
          [
            id,
            input.actor.communityId,
            input.actor.userId,
            commute.originArea,
            commute.destinationArea,
            commute.departureWindowStart,
            commute.departureWindowEnd,
            commute.role,
            commute.seatsOffered,
          ],
        );
        await insertWeekdays(client, id, commute.weekdays);

        return {
          status: 201,
          body: {
            ...commute,
            id,
            timezone: "Asia/Karachi",
            isActive: true,
            version: 1,
          },
        };
      },
    });
  });
}

export async function updateCommuteTemplate(input: {
  actor: AuthenticatedActor;
  commuteTemplateId: string;
  expectedVersion: number;
  commute: CommuteTemplateInput;
  idempotencyKey: string;
}): Promise<IdempotentResult<CommuteTemplateRecord>> {
  const commute = normalizeInput(input.commute);
  assertParticipantRole(input.actor.participantRole, commute.role === "OFFERING" ? "DRIVER" : "RIDER");
  if (commute.role === "EITHER") throw invalid("INVALID_COMMUTE_ROLE", "Choose the role associated with your account.");
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) {
    throw invalid("INVALID_VERSION", "A positive expected version is required.");
  }

  return inTransaction(async (client) => {
    await assertActiveCommunityMember(client, input.actor.communityId, input.actor.userId);
    return withIdempotency<CommuteTemplateRecord>({
      client,
      actorUserId: input.actor.userId,
      operation: "commute-template.update",
      key: input.idempotencyKey,
      requestFingerprint: JSON.stringify({
        communityId: input.actor.communityId,
        commuteTemplateId: input.commuteTemplateId,
        expectedVersion: input.expectedVersion,
        commute,
      }),
      work: async () => {
        const updated = await client.query<{ version: number; is_active: boolean }>(
          `UPDATE commute_templates
              SET origin_area = $4,
                  destination_area = $5,
                  departure_window_start = $6::time,
                  departure_window_end = $7::time,
                  role = $8,
                  seats_offered = $9,
                  version = version + 1,
                  updated_at = now()
            WHERE id = $1
              AND community_id = $2
              AND owner_user_id = $3
              AND version = $10
            RETURNING version, is_active`,
          [
            input.commuteTemplateId,
            input.actor.communityId,
            input.actor.userId,
            commute.originArea,
            commute.destinationArea,
            commute.departureWindowStart,
            commute.departureWindowEnd,
            commute.role,
            commute.seatsOffered,
            input.expectedVersion,
          ],
        );

        if (updated.rowCount !== 1) {
          const owned = await client.query(
            `SELECT 1 FROM commute_templates
              WHERE id = $1 AND community_id = $2 AND owner_user_id = $3`,
            [input.commuteTemplateId, input.actor.communityId, input.actor.userId],
          );
          if (owned.rowCount !== 1) throw notFound();
          throw conflict("COMMUTE_CHANGED", "This commute changed. Reload it before saving again.");
        }

        await client.query(
          "DELETE FROM commute_template_weekdays WHERE commute_template_id = $1",
          [input.commuteTemplateId],
        );
        await insertWeekdays(client, input.commuteTemplateId, commute.weekdays);

        return {
          status: 200,
          body: {
            ...commute,
            id: input.commuteTemplateId,
            timezone: "Asia/Karachi",
            isActive: updated.rows[0].is_active,
            version: updated.rows[0].version,
          },
        };
      },
    });
  });
}

export async function listOwnCommuteTemplates(actor: AuthenticatedActor): Promise<CommuteTemplateRecord[]> {
  return inTransaction(async (client) => {
    await assertActiveCommunityMember(client, actor.communityId, actor.userId);
    const result = await client.query<{
      id: string;
      origin_area: string;
      destination_area: string;
      departure_window_start: string;
      departure_window_end: string;
      timezone: "Asia/Karachi";
      role: CommuteRole;
      seats_offered: number;
      weekdays: number[];
      is_active: boolean;
      version: number;
    }>(
      `SELECT t.id, t.origin_area, t.destination_area,
              to_char(t.departure_window_start, 'HH24:MI') AS departure_window_start,
              to_char(t.departure_window_end, 'HH24:MI') AS departure_window_end,
              t.timezone, t.role, t.seats_offered,
              array_agg(d.weekday ORDER BY d.weekday) AS weekdays,
              t.is_active, t.version
         FROM commute_templates t
         JOIN commute_template_weekdays d ON d.commute_template_id = t.id
        WHERE t.community_id = $1 AND t.owner_user_id = $2
        GROUP BY t.id
        ORDER BY t.created_at DESC, t.id
        LIMIT 50`,
      [actor.communityId, actor.userId],
    );

    return result.rows.map((row) => ({
      id: row.id,
      originArea: row.origin_area,
      destinationArea: row.destination_area,
      departureWindowStart: row.departure_window_start,
      departureWindowEnd: row.departure_window_end,
      timezone: row.timezone,
      role: row.role,
      seatsOffered: row.seats_offered,
      weekdays: row.weekdays,
      isActive: row.is_active,
      version: row.version,
    }));
  });
}
