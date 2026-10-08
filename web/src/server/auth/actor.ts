import { randomUUID } from "node:crypto";
import { headers } from "next/headers";
import { inTransaction } from "@/server/db/pool";
import { ensureMarketplace, MARKETPLACE_ID } from "@/server/auth/marketplace";

export type ParticipantRole = "RIDER" | "DRIVER";

export type AuthenticatedActor = {
  userId: string;
  /** Internal marketplace tenant. It is not a user-selected community. */
  communityId: string;
  participantRole: ParticipantRole;
};

export type PilotAccessState =
  | { status: "AUTH_DISABLED" }
  | { status: "SIGNED_OUT" }
  | { status: "NOT_ELIGIBLE" }
  | { status: "ACTIVE"; actor: AuthenticatedActor };

export class AuthenticationRequiredError extends Error {
  readonly status = 401;

  constructor() {
    super("Sign in is required.");
    this.name = "AuthenticationRequiredError";
  }
}

export class AccountUnavailableError extends Error {
  readonly status = 403;

  constructor() {
    super("This account is not available.");
    this.name = "AccountUnavailableError";
  }
}

export class AuthenticationDisabledError extends Error {
  readonly status = 503;

  constructor() {
    super("Authentication is not enabled for this deployment.");
    this.name = "AuthenticationDisabledError";
  }
}

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export async function getPilotAccessState(signupRole?: ParticipantRole): Promise<PilotAccessState> {
  if (process.env.AUTH_ENABLED !== "true") return { status: "AUTH_DISABLED" };
  const requestHeaders = await headers();
  const { auth } = await import("@/server/auth/config");
  const session = await auth.api.getSession({ headers: requestHeaders });
  if (!session) return { status: "SIGNED_OUT" };

  const authSubject = session.user.id.trim();
  const email = session.user.email.trim().toLowerCase();
  const displayName = session.user.name.trim();
  if (
    !session.user.emailVerified ||
    authSubject.length < 1 || authSubject.length > 255 ||
    email.length < 3 || email.length > 254 ||
    displayName.length < 1 || displayName.length > 80 ||
    !UUID_PATTERN.test(MARKETPLACE_ID)
  ) {
    return { status: "NOT_ELIGIBLE" };
  }

  return inTransaction(async (client) => {
    await ensureMarketplace(client);
    await client.query("SELECT pg_advisory_xact_lock(hashtextextended($1, 0))", [authSubject]);

    const existingResult = await client.query<{
      id: string;
      account_status: string;
      membership_status: string | null;
      participant_role: ParticipantRole;
    }>(
      `SELECT u.id, u.status AS account_status, m.status AS membership_status,
              u.participant_role
         FROM users u
         LEFT JOIN community_memberships m
           ON m.user_id = u.id AND m.community_id = $2
        WHERE u.auth_subject = $1`,
      [authSubject, MARKETPLACE_ID],
    );
    const existing = existingResult.rows[0];
    if (existing) {
      if (existing.account_status !== "ACTIVE") return { status: "NOT_ELIGIBLE" };
      if (existing.membership_status !== "ACTIVE") {
        await client.query(
          `INSERT INTO community_memberships
             (community_id, user_id, status, role, reviewed_by, reviewed_at)
           VALUES ($1, $2, 'ACTIVE', 'MEMBER', $2, now())
           ON CONFLICT (community_id, user_id) DO UPDATE
             SET status = 'ACTIVE', role = 'MEMBER', reviewed_by = $2,
                 reviewed_at = now(), updated_at = now()`,
          [MARKETPLACE_ID, existing.id],
        );
      }
      return {
        status: "ACTIVE",
        actor: { userId: existing.id, communityId: MARKETPLACE_ID, participantRole: existing.participant_role },
      };
    }

    const userId = randomUUID();
    const participantRole = signupRole === "DRIVER" ? "DRIVER" : "RIDER";
    await client.query(
      `INSERT INTO users (id, auth_subject, display_name, participant_role)
       VALUES ($1, $2, $3, $4)`,
      [userId, authSubject, displayName, participantRole],
    );
    await client.query(
      `INSERT INTO community_memberships
         (community_id, user_id, status, role, reviewed_by, reviewed_at)
       VALUES ($1, $2, 'ACTIVE', 'MEMBER', $2, now())`,
      [MARKETPLACE_ID, userId],
    );
    return {
      status: "ACTIVE",
      actor: { userId, communityId: MARKETPLACE_ID, participantRole },
    };
  });
}

export async function requireAuthenticatedActor(): Promise<AuthenticatedActor> {
  const access = await getPilotAccessState();
  if (access.status === "AUTH_DISABLED") throw new AuthenticationDisabledError();
  if (access.status === "SIGNED_OUT") throw new AuthenticationRequiredError();
  if (access.status === "NOT_ELIGIBLE") throw new AccountUnavailableError();
  return access.actor;
}
