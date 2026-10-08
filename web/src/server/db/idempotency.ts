import { createHash } from "node:crypto";
import type { PoolClient } from "pg";

export type IdempotentResult<T> = {
  status: number;
  body: T;
};

export class IdempotencyConflictError extends Error {
  readonly code = "IDEMPOTENCY_KEY_REUSED";

  constructor() {
    super("The idempotency key was already used for a different request.");
    this.name = "IdempotencyConflictError";
  }
}

export class IdempotencyStateError extends Error {
  readonly code = "IDEMPOTENCY_RESULT_UNAVAILABLE";

  constructor() {
    super("The idempotent operation has no committed result.");
    this.name = "IdempotencyStateError";
  }
}

function sha256(value: string): Buffer {
  return createHash("sha256").update(value, "utf8").digest();
}

export function validateIdempotencyKey(key: string): void {
  if (!/^[A-Za-z0-9_-]{16,128}$/.test(key)) {
    throw new TypeError("Idempotency-Key must be 16–128 URL-safe characters.");
  }
}

/**
 * Run the business mutation and persist its replay result in the caller's
 * transaction. Concurrent identical keys serialize on the unique key; a retry
 * returns the committed result for 24 hours. Reusing a key with a different
 * payload during that window fails; after expiry, the key starts a fresh
 * operation.
 */
export async function withIdempotency<T>(args: {
  client: PoolClient;
  actorUserId: string;
  operation: string;
  key: string;
  requestFingerprint: string;
  work: () => Promise<IdempotentResult<T>>;
}): Promise<IdempotentResult<T>> {
  validateIdempotencyKey(args.key);

  const keyHash = sha256(args.key);
  const requestHash = sha256(args.requestFingerprint);
  const inserted = await args.client.query(
    `INSERT INTO idempotency_records
       (actor_user_id, operation, key_sha256, request_sha256, created_at, expires_at)
     VALUES ($1, $2, $3, $4, clock_timestamp(), clock_timestamp() + interval '24 hours')
     ON CONFLICT (actor_user_id, operation, key_sha256) DO UPDATE
       SET request_sha256 = EXCLUDED.request_sha256,
           response_status = NULL,
           response_body = NULL,
           created_at = clock_timestamp(),
           expires_at = clock_timestamp() + interval '24 hours'
       WHERE idempotency_records.expires_at <= clock_timestamp()
     RETURNING actor_user_id`,
    [args.actorUserId, args.operation, keyHash, requestHash],
  );

  if (inserted.rowCount === 0) {
    const existing = await args.client.query<{
      request_sha256: Buffer;
      response_status: number | null;
      response_body: T | null;
    }>(
      `SELECT request_sha256, response_status, response_body
         FROM idempotency_records
        WHERE actor_user_id = $1 AND operation = $2 AND key_sha256 = $3
        FOR UPDATE`,
      [args.actorUserId, args.operation, keyHash],
    );

    const row = existing.rows[0];
    if (!row) throw new IdempotencyStateError();
    if (!row.request_sha256.equals(requestHash)) throw new IdempotencyConflictError();
    if (row.response_status === null || row.response_body === null) {
      throw new IdempotencyStateError();
    }

    return { status: row.response_status, body: row.response_body };
  }

  const result = await args.work();
  await args.client.query(
    `UPDATE idempotency_records
        SET response_status = $4, response_body = $5::jsonb
      WHERE actor_user_id = $1 AND operation = $2 AND key_sha256 = $3`,
    [
      args.actorUserId,
      args.operation,
      keyHash,
      result.status,
      JSON.stringify(result.body),
    ],
  );

  return result;
}
