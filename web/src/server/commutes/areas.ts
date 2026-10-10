import { randomUUID } from "node:crypto";
import type { PoolClient } from "pg";
import type { AuthenticatedActor } from "@/server/auth/actor";
import { assertActiveCommunityMember } from "@/server/community/access";
import { inTransaction } from "@/server/db/pool";
import { normalizeArea } from "@/domain/clock";
import { conflict, forbidden, invalid, notFound } from "@/server/rides/errors";

export type AreaAlias = {
  id: string;
  aliasArea: string;
  canonicalArea: string;
  note: string | null;
  createdAt: string;
};

/**
 * Only reviewers/operators maintain area aliases.
 *
 * An alias is an explicit statement that two spellings mean the same place. If
 * any account could write one, a single user could make their own area match
 * someone else's trip, which is a matching-integrity problem, not a preference.
 */
async function assertAliasManager(client: PoolClient, actor: AuthenticatedActor): Promise<void> {
  const result = await client.query(
    `SELECT 1 FROM community_memberships
      WHERE community_id = $1 AND user_id = $2 AND status = 'ACTIVE'
        AND role IN ('OPERATOR', 'SAFETY_REVIEWER')`,
    [actor.communityId, actor.userId],
  );
  if (result.rowCount !== 1) throw forbidden();
}

export async function listAreaAliases(actor: AuthenticatedActor): Promise<AreaAlias[]> {
  return inTransaction(async (client) => {
    await assertActiveCommunityMember(client, actor.communityId, actor.userId);
    const result = await client.query<AreaAlias>(
      `SELECT id,
              alias_area AS "aliasArea",
              canonical_area AS "canonicalArea",
              note,
              to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt"
         FROM area_aliases
        WHERE community_id = $1
        ORDER BY alias_area ASC, id ASC
        LIMIT 500`,
      [actor.communityId],
    );
    return result.rows;
  });
}

/**
 * Declare that `aliasArea` and `canonicalArea` are the same place.
 *
 * Both are normalized the same way search normalizes them, so an operator writes
 * "Gulberg III" and it is stored as "gulberg iii". Chains are rejected: if the
 * canonical area is itself an alias of something else, following it one hop
 * would disagree with search, so the operator is asked to point both at the same
 * canonical area instead. That keeps resolution unambiguous and cycle-free.
 */
export async function createAreaAlias(input: {
  actor: AuthenticatedActor;
  aliasArea: string;
  canonicalArea: string;
  note: string | null;
}): Promise<AreaAlias> {
  const aliasArea = normalizeArea(input.aliasArea);
  const canonicalArea = normalizeArea(input.canonicalArea);
  if (aliasArea === null) throw invalid("INVALID_ALIAS_AREA", "The alias area must be 1 to 120 characters.");
  if (canonicalArea === null) throw invalid("INVALID_CANONICAL_AREA", "The canonical area must be 1 to 120 characters.");
  if (aliasArea === canonicalArea) {
    throw invalid("AREA_ALIAS_SELF", "An area cannot be an alias of itself.");
  }
  const note = input.note === null ? null : input.note.trim().slice(0, 200) || null;

  return inTransaction(async (client) => {
    await assertAliasManager(client, input.actor);

    // The canonical target must not itself be an alias, or one-hop resolution in
    // search would disagree with what the operator sees here.
    const chained = await client.query(
      "SELECT 1 FROM area_aliases WHERE community_id = $1 AND alias_area = $2 LIMIT 1",
      [input.actor.communityId, canonicalArea],
    );
    if (chained.rowCount === 1) {
      throw conflict(
        "AREA_ALIAS_CHAINED",
        "That canonical area is itself an alias. Point both areas at the same canonical area instead.",
      );
    }

    const id = randomUUID();
    const inserted = await client.query<AreaAlias>(
      `INSERT INTO area_aliases (id, community_id, alias_area, canonical_area, note)
       VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (community_id, alias_area) DO NOTHING
       RETURNING id,
                 alias_area AS "aliasArea",
                 canonical_area AS "canonicalArea",
                 note,
                 to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt"`,
      [id, input.actor.communityId, aliasArea, canonicalArea, note],
    );
    if (inserted.rowCount !== 1) {
      throw conflict("AREA_ALIAS_EXISTS", "That alias already exists. Remove it first to change its target.");
    }
    return inserted.rows[0];
  });
}

export async function deleteAreaAlias(input: {
  actor: AuthenticatedActor;
  aliasId: string;
}): Promise<void> {
  return inTransaction(async (client) => {
    await assertAliasManager(client, input.actor);
    const result = await client.query(
      "DELETE FROM area_aliases WHERE id = $1 AND community_id = $2 RETURNING id",
      [input.aliasId, input.actor.communityId],
    );
    if (result.rowCount !== 1) throw notFound();
  });
}

export type AreaCoordinate = {
  id: string;
  area: string;
  latitude: number;
  longitude: number;
  note: string | null;
  createdAt: string;
};

/**
 * Coordinates are maintained by the same reviewers/operators who maintain
 * aliases: a coordinate is a factual claim about where a place is, and a wrong
 * one silently mismatches riders with drivers, so it is not a user preference.
 */
export async function listAreaCoordinates(actor: AuthenticatedActor): Promise<AreaCoordinate[]> {
  return inTransaction(async (client) => {
    await assertActiveCommunityMember(client, actor.communityId, actor.userId);
    const result = await client.query<AreaCoordinate>(
      `SELECT id,
              area,
              latitude::float8 AS latitude,
              longitude::float8 AS longitude,
              note,
              to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt"
         FROM area_coordinates
        WHERE community_id = $1
        ORDER BY area ASC, id ASC
        LIMIT 500`,
      [actor.communityId],
    );
    return result.rows;
  });
}

/**
 * Record (or update) the coordinate of an area.
 *
 * The area is normalized exactly as search normalizes it, so a coordinate always
 * keys the same string an alias or a trip would. Re-declaring an area updates
 * its position rather than creating a second row, because two positions for one
 * name would make matching depend on row order.
 */
export async function upsertAreaCoordinate(input: {
  actor: AuthenticatedActor;
  area: string;
  latitude: number;
  longitude: number;
  note: string | null;
}): Promise<AreaCoordinate> {
  const area = normalizeArea(input.area);
  if (area === null) throw invalid("INVALID_AREA", "The area must be 1 to 120 characters.");
  if (!Number.isFinite(input.latitude) || input.latitude < -90 || input.latitude > 90) {
    throw invalid("INVALID_LATITUDE", "Latitude must be between -90 and 90.");
  }
  if (!Number.isFinite(input.longitude) || input.longitude < -180 || input.longitude > 180) {
    throw invalid("INVALID_LONGITUDE", "Longitude must be between -180 and 180.");
  }
  const note = input.note === null ? null : input.note.trim().slice(0, 200) || null;

  return inTransaction(async (client) => {
    await assertAliasManager(client, input.actor);
    const saved = await client.query<AreaCoordinate>(
      `INSERT INTO area_coordinates (id, community_id, area, latitude, longitude, note)
       VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (community_id, area) DO UPDATE
         SET latitude = EXCLUDED.latitude,
             longitude = EXCLUDED.longitude,
             note = EXCLUDED.note,
             updated_at = now()
       RETURNING id,
                 area,
                 latitude::float8 AS latitude,
                 longitude::float8 AS longitude,
                 note,
                 to_char(created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS "createdAt"`,
      [randomUUID(), input.actor.communityId, area, input.latitude, input.longitude, note],
    );
    return saved.rows[0];
  });
}

export async function deleteAreaCoordinate(input: {
  actor: AuthenticatedActor;
  coordinateId: string;
}): Promise<void> {
  return inTransaction(async (client) => {
    await assertAliasManager(client, input.actor);
    const result = await client.query(
      "DELETE FROM area_coordinates WHERE id = $1 AND community_id = $2 RETURNING id",
      [input.coordinateId, input.actor.communityId],
    );
    if (result.rowCount !== 1) throw notFound();
  });
}
