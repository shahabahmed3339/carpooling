export const AUTH_SESSION_CHANGE_STORAGE_KEY = "carpool.auth-session-changed.v1";
const AUTH_SESSION_CHANGE_CHANNEL = "carpool.auth-session-changed.v1";
export const PARTICIPANT_MODE_STORAGE_KEY = "carpool.participant-mode-changed.v1";
const PARTICIPANT_MODE_CHANNEL = "carpool.participant-mode-changed.v1";
let senderChannel: BroadcastChannel | null = null;
let lastIssuedAt = 0;
let modeSenderChannel: BroadcastChannel | null = null;
let lastModeIssuedAt = 0;

export type AuthSessionChange = { accountId: string | null; changedAt: number };
export type ParticipantModeChange = { accountId: string; mode: "RIDER" | "DRIVER"; changedAt: number };
type ParsedSessionChange = AuthSessionChange & { mode?: unknown };

function parseChange(value: unknown): ParsedSessionChange | null {
  if (typeof value !== "string" || value.length > 1024) return null;
  try {
    const change: unknown = JSON.parse(value);
    if (!change || typeof change !== "object") return null;
    const candidate = change as Partial<ParsedSessionChange>;
    if ((candidate.accountId !== null && (typeof candidate.accountId !== "string" ||
         candidate.accountId.length < 1 || candidate.accountId.length > 255)) ||
        typeof candidate.changedAt !== "number" || !Number.isSafeInteger(candidate.changedAt) ||
        candidate.changedAt <= 0 || candidate.changedAt > Date.now() + 60_000) return null;
    return { accountId: candidate.accountId, changedAt: candidate.changedAt, mode: candidate.mode };
  } catch {
    return null;
  }
}

/** Notify other same-origin tabs after authentication identity changes. */
export function announceAuthSessionChange(accountId: string | null): void {
  lastIssuedAt = Math.max(Date.now(), lastIssuedAt + 1);
  const payload = JSON.stringify({ accountId, changedAt: lastIssuedAt } satisfies AuthSessionChange);
  try {
    if (typeof BroadcastChannel !== "undefined") {
      senderChannel ??= new BroadcastChannel(AUTH_SESSION_CHANGE_CHANNEL);
      senderChannel.postMessage(payload);
    }
  } catch {
    senderChannel?.close();
    senderChannel = null;
    // The storage event and protected API responses are fallback paths.
  }
  try {
    window.localStorage.setItem(AUTH_SESSION_CHANGE_STORAGE_KEY, payload);
  } catch {
    // Protected API responses still detect the change if storage is unavailable.
  }
}

/** Subscribe to same-origin identity changes using both available browser transports. */
export function listenForAuthSessionChange(onChange: (change: AuthSessionChange) => void): () => void {
  let channel: BroadcastChannel | null = null;
  let lastChangedAt = 0;
  const seenPayloads = new Set<string>();
  const receive = (raw: unknown) => {
    const change = parseChange(raw);
    if (!change || typeof raw !== "string" || change.changedAt < lastChangedAt || seenPayloads.has(raw)) return;
    lastChangedAt = Math.max(change.changedAt, lastChangedAt);
    seenPayloads.add(raw);
    if (seenPayloads.size > 16) {
      const oldest = seenPayloads.values().next().value;
      if (oldest) seenPayloads.delete(oldest);
    }
    onChange(change);
  };
  const handleStorage = (event: StorageEvent) => {
    if (event.key === AUTH_SESSION_CHANGE_STORAGE_KEY) receive(event.newValue);
  };
  window.addEventListener("storage", handleStorage);
  try {
    if (typeof BroadcastChannel !== "undefined") {
      channel = new BroadcastChannel(AUTH_SESSION_CHANGE_CHANNEL);
      channel.addEventListener("message", (event: MessageEvent<unknown>) => receive(event.data));
    }
  } catch {
    channel?.close();
    channel = null;
  }
  return () => {
    window.removeEventListener("storage", handleStorage);
    channel?.close();
  };
}

/** Notify other tabs after this account changes its current Rider/Driver mode. */
export function announceParticipantModeChange(accountId: string, mode: ParticipantModeChange["mode"]): void {
  lastModeIssuedAt = Math.max(Date.now(), lastModeIssuedAt + 1);
  const payload = JSON.stringify({ accountId, mode, changedAt: lastModeIssuedAt } satisfies ParticipantModeChange);
  try {
    if (typeof BroadcastChannel !== "undefined") {
      modeSenderChannel ??= new BroadcastChannel(PARTICIPANT_MODE_CHANNEL);
      modeSenderChannel.postMessage(payload);
    }
  } catch {
    modeSenderChannel?.close();
    modeSenderChannel = null;
    // The storage event and protected API responses are fallback paths.
  }
  try {
    window.localStorage.setItem(PARTICIPANT_MODE_STORAGE_KEY, payload);
  } catch {
    // Protected API responses still detect a stale mode if browser messaging is unavailable.
  }
}

export function listenForParticipantModeChange(
  accountId: string,
  onChange: (change: ParticipantModeChange) => void,
): () => void {
  let channel: BroadcastChannel | null = null;
  let lastChangedAt = 0;
  const seenPayloads = new Set<string>();
  const receive = (raw: unknown) => {
    const change = parseChange(raw);
    if (!change || typeof change.accountId !== "string" || change.accountId !== accountId ||
        (change.mode !== "RIDER" && change.mode !== "DRIVER") || typeof raw !== "string" ||
        change.changedAt < lastChangedAt || seenPayloads.has(raw)) return;
    lastChangedAt = Math.max(change.changedAt, lastChangedAt);
    seenPayloads.add(raw);
    if (seenPayloads.size > 16) {
      const oldest = seenPayloads.values().next().value;
      if (oldest) seenPayloads.delete(oldest);
    }
    onChange({ accountId: change.accountId, mode: change.mode as ParticipantModeChange["mode"], changedAt: change.changedAt });
  };
  const handleStorage = (event: StorageEvent) => {
    if (event.key === PARTICIPANT_MODE_STORAGE_KEY) receive(event.newValue);
  };
  window.addEventListener("storage", handleStorage);
  try {
    if (typeof BroadcastChannel !== "undefined") {
      channel = new BroadcastChannel(PARTICIPANT_MODE_CHANNEL);
      channel.addEventListener("message", (event: MessageEvent<unknown>) => receive(event.data));
    }
  } catch {
    channel?.close();
    channel = null;
  }
  return () => {
    window.removeEventListener("storage", handleStorage);
    channel?.close();
  };
}
