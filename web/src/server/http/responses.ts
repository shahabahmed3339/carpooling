import { headers } from "next/headers";
import {
  AuthenticationDisabledError,
  AuthenticationRequiredError,
  AccountUnavailableError,
  requireAuthenticatedActor,
} from "@/server/auth/actor";
import { IdempotencyConflictError, validateIdempotencyKey } from "@/server/db/idempotency";
import { RideDomainError } from "@/server/rides/errors";

export class HttpInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "HttpInputError";
  }
}

export async function readJsonObject(request: Request): Promise<Record<string, unknown>> {
  let value: unknown;
  try {
    value = await request.json();
  } catch {
    throw new HttpInputError("Request body must be valid JSON.");
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new HttpInputError("Request body must be a JSON object.");
  }
  return value as Record<string, unknown>;
}

export function requiredString(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim().length === 0) {
    throw new HttpInputError(`${field} is required.`);
  }
  return value.trim();
}

export function requiredInteger(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isInteger(value)) {
    throw new HttpInputError(`${field} must be an integer.`);
  }
  return value;
}

export function requiredIntegerArray(value: unknown, field: string): number[] {
  if (!Array.isArray(value) || value.some((entry) => typeof entry !== "number" || !Number.isInteger(entry))) {
    throw new HttpInputError(`${field} must be an array of integers.`);
  }
  return value as number[];
}

export function requireIdempotencyKey(request: Request): string {
  const key = requiredString(request.headers.get("Idempotency-Key"), "Idempotency-Key");
  try {
    validateIdempotencyKey(key);
  } catch {
    throw new HttpInputError("Idempotency-Key must be 16–128 URL-safe characters.");
  }
  return key;
}

export function requireUuid(value: string, field: string): string {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)) {
    throw new HttpInputError(`${field} must be a valid identifier.`);
  }
  return value;
}

export async function withActor(
  operation: (actor: Awaited<ReturnType<typeof requireAuthenticatedActor>>) => Promise<Response>,
): Promise<Response> {
  let actorUserId: string | undefined;
  let actorParticipantRole: string | undefined;
  const privateResponse = (response: Response): Response => {
    // Authenticated API payloads contain account-, trip-, or moderation-specific
    // data. Prevent browsers and intermediary caches from reusing them across
    // sessions, including responses that represent errors.
    response.headers.set("Cache-Control", "private, no-store");
    if (actorUserId) response.headers.set("X-Carpool-Actor", actorUserId);
    if (actorParticipantRole) response.headers.set("X-Carpool-Mode", actorParticipantRole);
    return response;
  };

  try {
    const expectedActorId = (await headers()).get("X-Expected-Carpool-Actor");
    const actor = await requireAuthenticatedActor();
    actorUserId = actor.userId;
    actorParticipantRole = actor.participantRole;
    if (expectedActorId && expectedActorId !== actor.userId) {
      return privateResponse(Response.json({
        error: { code: "ACCOUNT_SESSION_CHANGED", message: "The signed-in account changed. Reload the page before continuing." },
      }, { status: 409 }));
    }
    return privateResponse(await operation(actor));
  } catch (error) {
    if (error instanceof AuthenticationDisabledError) {
      return privateResponse(Response.json({ error: { code: "AUTH_DISABLED", message: error.message } }, { status: 503 }));
    }
    if (error instanceof AuthenticationRequiredError) {
      return privateResponse(Response.json({ error: { code: "AUTH_REQUIRED", message: error.message } }, { status: 401 }));
    }
    if (error instanceof AccountUnavailableError) {
      return privateResponse(Response.json({
        error: { code: "ACCOUNT_UNAVAILABLE", message: error.message },
      }, { status: 403 }));
    }
    if (error instanceof HttpInputError) {
      return privateResponse(Response.json({
        error: { code: "INVALID_REQUEST", message: error.message },
      }, { status: 400 }));
    }
    if (error instanceof RideDomainError) {
      return privateResponse(Response.json({
        error: { code: error.code, message: error.message },
      }, { status: error.status }));
    }
    if (error instanceof IdempotencyConflictError) {
      return privateResponse(Response.json({ error: { code: error.code, message: error.message } }, { status: 409 }));
    }
    console.error("Carpool API request failed.");
    return privateResponse(Response.json({ error: { code: "INTERNAL_ERROR", message: "The request could not be completed." } }, { status: 500 }));
  }
}

export function jsonResult(result: { status: number; body: unknown }): Response {
  return Response.json(result.body, { status: result.status });
}
