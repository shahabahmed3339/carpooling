/**
 * The dashboard's authenticated fetch layer.
 *
 * Moved verbatim from the old single-page dashboard so the split pages share one
 * implementation. The behaviour is deliberately unchanged, because it carries
 * several guarantees that are easy to lose when code is copied:
 *
 *   * every response is checked for `X-Carpool-Actor`, so a request answered for a
 *     different account (a second tab having signed in as someone else) reloads
 *     rather than rendering another person's data;
 *   * `X-Carpool-Mode` is checked too, so a mode switched elsewhere cannot be used
 *     to submit a mode-gated action;
 *   * mutations carry a stable `Idempotency-Key` kept in sessionStorage, so an
 *     ambiguous network failure retries the *same* operation rather than performing
 *     a second one.
 *
 * A page that re-implemented any of these would look correct and be unsafe, which
 * is exactly why this lives in one module.
 */

import type { ParticipantRole } from "./types";

const pendingIdempotencyStorageKey = "carpool.pending-idempotency.v1";
const pendingIdempotencyLifetimeMs = 23 * 60 * 60 * 1000;

type PendingIdempotencyKey = { key: string; createdAt: number };

const currentTimestamp = (): number => Date.now();

async function requestFingerprint(value: string): Promise<string> {
  // Keep request bodies (which may contain safety-report details) out of the
  // pending-key map and make accidental key-map collisions negligible.
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

function loadPendingIdempotencyKeys(): Map<string, PendingIdempotencyKey> {
  if (typeof window === "undefined") return new Map();
  try {
    const stored = window.sessionStorage.getItem(pendingIdempotencyStorageKey);
    if (!stored) return new Map();
    const entries: unknown = JSON.parse(stored);
    if (!Array.isArray(entries)) return new Map();
    const now = currentTimestamp();
    const pending = new Map<string, PendingIdempotencyKey>();
    for (const entry of entries) {
      if (!Array.isArray(entry) || entry.length !== 2 ||
          typeof entry[0] !== "string" || !/^[0-9a-f]{64}$/.test(entry[0]) ||
          !entry[1] || typeof entry[1] !== "object") continue;
      const value = entry[1] as Partial<PendingIdempotencyKey>;
      if (typeof value.key !== "string" ||
          !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value.key) ||
          typeof value.createdAt !== "number" || !Number.isFinite(value.createdAt) ||
          value.createdAt > now + 5 * 60 * 1000 || now - value.createdAt >= pendingIdempotencyLifetimeMs) continue;
      pending.set(entry[0], { key: value.key, createdAt: value.createdAt });
    }
    return pending;
  } catch {
    return new Map();
  }
}

function savePendingIdempotencyKeys(keys: Map<string, PendingIdempotencyKey>): void {
  if (typeof window === "undefined") return;
  try {
    if (keys.size === 0) window.sessionStorage.removeItem(pendingIdempotencyStorageKey);
    else window.sessionStorage.setItem(pendingIdempotencyStorageKey, JSON.stringify([...keys]));
  } catch {
    // In-memory keys still protect same-page retries if storage is unavailable.
  }
}

async function rawRequest<T>(
  url: string,
  init?: RequestInit,
  expectedAccountId?: string,
  expectedMode?: ParticipantRole,
  onContextChanged?: (destination: string) => void,
): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  const response = await fetch(url, { ...init, cache: "no-store", headers });
  if (response.status === 401) {
    if (onContextChanged) onContextChanged("/login");
    else window.location.replace("/login");
    throw new Error("Your sign-in expired. Redirecting to sign-in.");
  }
  const responseAccountId = response.headers.get("X-Carpool-Actor");
  if (expectedAccountId && response.status === 403 && !responseAccountId) {
    if (onContextChanged) onContextChanged("/auth/complete");
    else window.location.replace("/auth/complete");
    throw new Error("This account is unavailable. Redirecting.");
  }
  if (expectedAccountId && (
    (responseAccountId !== null && responseAccountId !== expectedAccountId) ||
    (response.ok && responseAccountId === null)
  )) {
    // A different tab may have signed into another account. Discard this
    // account's in-memory state before displaying the new account's data.
    if (onContextChanged) onContextChanged("/dashboard");
    else window.location.replace("/dashboard");
    throw new Error("Your signed-in account changed. Reloading your dashboard.");
  }
  const responseMode = response.headers.get("X-Carpool-Mode");
  if (expectedMode && responseMode && responseMode !== expectedMode) {
    // The account's mode changed in another tab or device. Reload server state
    // before rendering more forms or applying another mode-gated action.
    if (onContextChanged) onContextChanged("/dashboard");
    else window.location.replace("/dashboard");
    throw new Error("Your Rider/Driver mode changed. Reloading your dashboard.");
  }
  let payload: T & { error?: { message?: string } };
  try {
    payload = await response.json() as T & { error?: { message?: string } };
  } catch {
    if (response.ok) {
      throw new Error("The server response could not be read. Retry the same action safely.");
    }
    payload = {} as T & { error?: { message?: string } };
  }
  if (!response.ok) throw new Error(payload.error?.message ?? "Could not complete the request.");
  return payload;
}

export type ApiClient = {
  /** Authenticated GET/POST/PATCH/DELETE with account and mode guards. */
  accountApi: <T>(url: string, init?: RequestInit) => Promise<T>;
  /**
   * Same, plus a stable `Idempotency-Key` so an uncertain retry repeats the same
   * operation instead of performing a second one. Every mutation uses this.
   */
  apiIdempotent: <T>(url: string, init: RequestInit) => Promise<T>;
};

export function createApiClient(options: {
  accountId: string;
  /**
   * Reads the current mode from a plain value captured by the caller.
   *
   * A value rather than a ref: reading a ref during render is precisely what the
   * React linting rules forbid, and a ref is what made the first version of this
   * module fail those rules. The caller re-creates the client when the mode
   * changes, which is correct because a mode change reloads the page anyway.
   */
  getMode: () => ParticipantRole;
  onContextChanged: (destination: string) => void;
}): ApiClient {
  const { accountId, getMode, onContextChanged } = options;
  let pendingKeys: Map<string, PendingIdempotencyKey> | null = null;

  function keys(): Map<string, PendingIdempotencyKey> {
    if (pendingKeys === null) pendingKeys = loadPendingIdempotencyKeys();
    return pendingKeys;
  }

  async function accountApi<T>(url: string, init?: RequestInit): Promise<T> {
    const headers = new Headers(init?.headers);
    headers.set("X-Expected-Carpool-Actor", accountId);
    return rawRequest<T>(url, { ...init, headers }, accountId, getMode(), onContextChanged);
  }

  async function apiIdempotent<T>(url: string, init: RequestInit): Promise<T> {
    const fingerprint = await requestFingerprint(JSON.stringify([accountId, url, init.method ?? "GET", init.body ?? null]));
    const pending = keys();
    const now = currentTimestamp();
    for (const [storedFingerprint, storedKey] of pending) {
      if (now - storedKey.createdAt >= pendingIdempotencyLifetimeMs || storedKey.createdAt > now + 5 * 60 * 1000) {
        pending.delete(storedFingerprint);
      }
    }
    let entry = pending.get(fingerprint);
    if (!entry) {
      entry = { key: crypto.randomUUID(), createdAt: now };
      pending.set(fingerprint, entry);
    }
    savePendingIdempotencyKeys(pending);

    const headers = new Headers(init.headers);
    headers.set("Idempotency-Key", entry.key);
    const result = await accountApi<T>(url, { ...init, headers });
    pending.delete(fingerprint);
    savePendingIdempotencyKeys(pending);
    return result;
  }

  return { accountApi, apiIdempotent };
}
