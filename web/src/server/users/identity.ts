import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import { inTransaction } from "@/server/db/pool";
import { assertActiveCommunityMember } from "@/server/community/access";
import { lockUserActions } from "@/server/users/action-lock";
import { invalid } from "@/server/rides/errors";
import { summariseRatingsFor } from "@/server/users/ratings";
import type { AuthenticatedActor } from "@/server/auth/actor";

export type Vehicle = {
  id: string;
  make: string;
  model: string;
  colour: string;
  plate: string;
  seatCapacity: number;
};

export type MyProfile = {
  displayName: string;
  phone: string | null;
  phoneVerified: boolean;
  vehicle: Vehicle | null;
};

/**
 * The identity fields a rider needs to recognise their driver, and vice versa.
 *
 * `phone` and `vehicle` are private until a seat is confirmed — the same rule the
 * meeting detail uses. Exposed only through `getCounterpartIdentity`, which is
 * called for a request the caller is a participant on and which is ACCEPTED, so
 * a driver's number and plate are not readable by every rider who searches.
 */
export type CounterpartIdentity = {
  displayName: string;
  phone: string | null;
  phoneVerified: boolean;
  vehicle: Vehicle | null;
  /**
   * Reputation, carried alongside the identity because a rider deciding whether to
   * get in the car needs both in one look. `average` is null until enough ratings
   * exist — one five-star rating is not a reputation and is not shown as one.
   */
  rating: { average: number | null; count: number; hasEnoughForAverage: boolean };
};

const PHONE_MAX = 20;
const PHONE_MIN = 7;

/**
 * Normalize a phone number to a comparable form, or null when blank.
 *
 * Accepts the shapes people actually type for a Pakistani mobile — `03001234567`,
 * `+92 300 1234567`, `(0300) 123-4567` — and keeps a single leading `+` when the
 * caller supplied one, because a driver abroad may need a country code. It does
 * not attempt full E.164 validation: the app cannot know every country's rules,
 * and rejecting a genuinely valid number is worse than storing an odd one.
 */
export function normalizePhone(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  if (trimmed.length === 0) return null;
  const hasPlus = trimmed.startsWith("+");
  const digits = trimmed.replace(/[^0-9]/g, "");
  return `${hasPlus ? "+" : ""}${digits}`;
}

function assertValidPhone(phone: string | null): void {
  if (phone === null) return;
  const digits = phone.replace(/[^0-9]/g, "");
  if (digits.length < PHONE_MIN || phone.length > PHONE_MAX) {
    throw invalid("INVALID_PHONE", "Enter a phone number of 7 to 20 digits.");
  }
}

/** Read the caller's own profile, including anything private. */
export async function getMyProfile(actor: AuthenticatedActor): Promise<MyProfile> {
  return inTransaction(async (client) => {
    await assertActiveCommunityMember(client, actor.communityId, actor.userId);
    const result = await client.query<{ displayName: string; phone: string | null; phoneVerifiedAt: Date | null }>(
      `SELECT display_name AS "displayName",
              phone,
              phone_verified_at AS "phoneVerifiedAt"
         FROM users WHERE id = $1`,
      [actor.userId],
    );
    const row = result.rows[0];
    return {
      displayName: row?.displayName ?? "",
      phone: row?.phone ?? null,
      phoneVerified: row?.phoneVerifiedAt !== null && row?.phoneVerifiedAt !== undefined,
      vehicle: await readVehicle(client, actor.userId),
    };
  });
}

async function readVehicle(client: PoolClient, userId: string): Promise<Vehicle | null> {
  const result = await client.query<Vehicle>(
    `SELECT id,
            make,
            model,
            colour,
            plate,
            seat_capacity AS "seatCapacity"
       FROM driver_vehicles
      WHERE user_id = $1`,
    [userId],
  );
  return result.rows[0] ?? null;
}

/**
 * Update the caller's own profile: display name, phone, and optionally the
 * vehicle. An absent `vehicle` key leaves the vehicle untouched; an explicit
 * `null` removes it, which is how a driver stops offering a car.
 */
export async function updateMyProfile(input: {
  actor: AuthenticatedActor;
  displayName?: string;
  phone?: string | null;
  vehicle?: { make: string; model: string; colour: string; plate: string; seatCapacity: number } | null;
}): Promise<MyProfile> {
  const displayName = input.displayName === undefined ? undefined : input.displayName.trim();
  if (displayName !== undefined && (displayName.length < 1 || displayName.length > 80)) {
    throw invalid("INVALID_DISPLAY_NAME", "Your display name must be 1 to 80 characters.");
  }
  const phone = input.phone === undefined ? undefined : normalizePhone(input.phone);
  if (phone !== undefined) assertValidPhone(phone);

  let vehicle = input.vehicle;
  if (vehicle !== undefined && vehicle !== null) {
    vehicle = {
      make: vehicle.make.trim(),
      model: vehicle.model.trim(),
      colour: vehicle.colour.trim(),
      plate: vehicle.plate.trim().toUpperCase(),
      seatCapacity: vehicle.seatCapacity,
    };
    if (!vehicle.make) throw invalid("INVALID_VEHICLE", "Enter the vehicle make.");
    if (!vehicle.model) throw invalid("INVALID_VEHICLE", "Enter the vehicle model.");
    if (!vehicle.colour) throw invalid("INVALID_VEHICLE", "Enter the vehicle colour.");
    if (!vehicle.plate) throw invalid("INVALID_VEHICLE", "Enter the vehicle plate.");
    if (!Number.isInteger(vehicle.seatCapacity) || vehicle.seatCapacity < 1 || vehicle.seatCapacity > 8) {
      throw invalid("INVALID_VEHICLE", "The vehicle carries between 1 and 8 passengers.");
    }
  }

  return inTransaction(async (client) => {
    await lockUserActions(client, [input.actor.userId]);
    await assertActiveCommunityMember(client, input.actor.communityId, input.actor.userId);

    // Changing the phone invalidates any previous verification: a number that was
    // confirmed for one value must not inherit that trust after an edit.
    const updated = await client.query(
      `UPDATE users
          SET display_name = COALESCE($2, display_name),
              phone = CASE WHEN $3::boolean THEN $4 ELSE phone END,
              phone_verified_at = CASE WHEN $3::boolean AND phone IS DISTINCT FROM $4 THEN NULL ELSE phone_verified_at END,
              updated_at = now()
        WHERE id = $1 AND status = 'ACTIVE'`,
      [input.actor.userId, displayName ?? null, phone !== undefined, phone ?? null],
    );
    if (updated.rowCount !== 1) throw invalid("ACCOUNT_NOT_ACTIVE", "This account is not active.");

    if (vehicle !== undefined) {
      if (vehicle === null) {
        await client.query("DELETE FROM driver_vehicles WHERE user_id = $1", [input.actor.userId]);
      } else {
        await client.query(
          `INSERT INTO driver_vehicles (id, user_id, make, model, colour, plate, seat_capacity)
           VALUES ($1, $2, $3, $4, $5, $6, $7)
           ON CONFLICT (user_id) DO UPDATE
             SET make = EXCLUDED.make,
                 model = EXCLUDED.model,
                 colour = EXCLUDED.colour,
                 plate = EXCLUDED.plate,
                 seat_capacity = EXCLUDED.seat_capacity,
                 updated_at = now()`,
          [randomUUID(), input.actor.userId, vehicle.make, vehicle.model, vehicle.colour, vehicle.plate, vehicle.seatCapacity],
        );
      }
    }

    const profile = await client.query<{ displayName: string; phone: string | null; phoneVerifiedAt: Date | null }>(
      `SELECT display_name AS "displayName", phone, phone_verified_at AS "phoneVerifiedAt"
         FROM users WHERE id = $1`,
      [input.actor.userId],
    );
    const row = profile.rows[0];
    return {
      displayName: row?.displayName ?? "",
      phone: row?.phone ?? null,
      phoneVerified: row?.phoneVerifiedAt !== null && row?.phoneVerifiedAt !== undefined,
      vehicle: await readVehicle(client, input.actor.userId),
    };
  });
}

/**
 * The counterpart's identity for one request, revealed only to a participant and
 * only while the seat is confirmed.
 *
 * This is the privacy boundary for the whole phase. Returns null — rather than an
 * empty object — when the caller is not a participant or the request is not
 * ACCEPTED, so a caller cannot distinguish "no detail on file" from "not allowed
 * to see it", which would itself leak the existence of a phone number.
 */
export async function getCounterpartIdentity(input: {
  actor: AuthenticatedActor;
  requestId: string;
}): Promise<CounterpartIdentity | null> {
  return inTransaction(async (client) => {
    await assertActiveCommunityMember(client, input.actor.communityId, input.actor.userId);
    const result = await client.query<{
      status: string;
      rider_user_id: string;
      driver_user_id: string;
    }>(
      `SELECT r.status, r.rider_user_id, o.driver_user_id
         FROM ride_requests r
         JOIN trip_occurrences o ON o.id = r.trip_occurrence_id AND o.community_id = r.community_id
        WHERE r.id = $1 AND r.community_id = $2`,
      [input.requestId, input.actor.communityId],
    );
    const row = result.rows[0];
    if (!row) return null;

    // Participant check first, then the status gate. Both must hold; a
    // non-participant learns nothing about the request either way.
    const isRider = row.rider_user_id === input.actor.userId;
    const isDriver = row.driver_user_id === input.actor.userId;
    if (!isRider && !isDriver) return null;
    if (row.status !== "ACCEPTED") return null;

    const counterpartId = isRider ? row.driver_user_id : row.rider_user_id;
    const counterpart = await client.query<{ displayName: string; phone: string | null; phoneVerifiedAt: Date | null }>(
      `SELECT display_name AS "displayName", phone, phone_verified_at AS "phoneVerifiedAt"
         FROM users WHERE id = $1 AND status = 'ACTIVE'`,
      [counterpartId],
    );
    const person = counterpart.rows[0];
    if (!person) return null;

    const summary = (await summariseRatingsFor(client, input.actor.communityId, [counterpartId])).get(counterpartId);
    return {
      displayName: person.displayName,
      phone: person.phone,
      phoneVerified: person.phoneVerifiedAt !== null && person.phoneVerifiedAt !== undefined,
      // A rider is not expected to have a vehicle; only a driver's is returned.
      vehicle: isRider ? await readVehicle(client, counterpartId) : null,
      rating: summary ?? { average: null, count: 0, hasEnoughForAverage: false },
    };
  });
}
