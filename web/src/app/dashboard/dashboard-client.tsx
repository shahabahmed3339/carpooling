"use client";

import { FormEvent, useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import SignOutButton from "@/app/auth/complete/sign-out";
import {
  announceAuthSessionChange,
  announceParticipantModeChange,
  listenForAuthSessionChange,
  listenForParticipantModeChange,
} from "@/lib/session-change";
import styles from "./dashboard.module.css";

type ParticipantRole = "RIDER" | "DRIVER";
type Commute = {
  id: string;
  originArea: string;
  destinationArea: string;
  departureWindowStart: string;
  departureWindowEnd: string;
  weekdays: number[];
  seatsOffered: number;
  isActive: boolean;
  version: number;
};
type Candidate = {
  tripOccurrenceId: string;
  memberId: string;
  displayName: string;
  originArea: string;
  destinationArea: string;
  departureTime: string;
  availableSeats: number;
  departureDifferenceMinutes: number;
};
type RideRequest = {
  requestId: string;
  tripOccurrenceId: string;
  status: string;
  otherParticipantId: string;
  otherParticipantName: string;
  originArea: string;
  destinationArea: string;
  tripDate: string;
  departureTime: string;
  awaitingCompletion: boolean;
  departurePassed: boolean;
  riderConfirmedCompletion: boolean;
  driverConfirmedCompletion: boolean;
};
type DriverTrip = {
  tripOccurrenceId: string;
  originArea: string;
  destinationArea: string;
  tripDate: string;
  departureTime: string;
  seatCapacity: number;
  seatsReserved: number;
  status: "OPEN" | "CANCELLED" | "COMPLETED";
  canCancel: boolean;
};
type ActivityItem = {
  kind: "TRIP" | "REQUEST";
  recordId: string;
  tripOccurrenceId: string;
  role: ParticipantRole;
  status: string;
  otherParticipantId: string | null;
  otherParticipantName: string | null;
  originArea: string;
  destinationArea: string;
  tripDate: string;
  departureTime: string;
  seatCapacity: number | null;
  seatsReserved: number | null;
};
type SafetyReport = {
  reportId: string;
  reportedUserId: string;
  reportedName: string;
  reason: "SAFETY_CONCERN" | "HARASSMENT" | "MISREPRESENTATION" | "OTHER";
  status: "RECEIVED" | "IN_REVIEW" | "RESOLVED" | "DISMISSED";
  createdAt: string;
};
type ReportDraft = { userId: string; displayName: string; tripOccurrenceId: string };
type InboxNotification = {
  id: string;
  kind: string;
  title: string;
  body: string;
  resourceType: "RIDE_REQUEST" | "TRIP_OCCURRENCE" | "SAFETY_REPORT";
  resourceId: string;
  createdAt: string;
  cursorCreatedAt: string;
  readAt: string | null;
};

const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function weekdayForDate(date: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const [year, month, day] = date.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  if (parsed.getUTCFullYear() !== year || parsed.getUTCMonth() !== month - 1 || parsed.getUTCDate() !== day) return null;
  return parsed.getUTCDay();
}

function currentTimestamp(): number {
  return Date.now();
}

async function api<T>(
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
    // account's in-memory dashboard before displaying the new account's data.
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

async function requestFingerprint(value: string): Promise<string> {
  // Keep request bodies (which may contain safety-report details) out of the
  // pending-key map and make accidental key-map collisions negligible.
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(value));
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, "0")).join("");
}

const pendingIdempotencyStorageKey = "carpool.pending-idempotency.v1";
const pendingIdempotencyLifetimeMs = 23 * 60 * 60 * 1000;
type PendingIdempotencyKey = { key: string; createdAt: number };

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

export default function DashboardClient({ initialMode, accountEmail, accountId }: { initialMode: ParticipantRole; accountEmail: string; accountId: string }) {
  const [role, setRole] = useState<ParticipantRole>(initialMode);
  const [commutes, setCommutes] = useState<Commute[]>([]);
  const [requests, setRequests] = useState<RideRequest[]>([]);
  const [publishedTrips, setPublishedTrips] = useState<DriverTrip[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [blockedUsers, setBlockedUsers] = useState<{ userId: string; displayName: string }[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [myReports, setMyReports] = useState<SafetyReport[]>([]);
  const [notifications, setNotifications] = useState<InboxNotification[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notificationHasMore, setNotificationHasMore] = useState(false);
  const [loadingOlderNotifications, setLoadingOlderNotifications] = useState(false);
  const [reportDraft, setReportDraft] = useState<ReportDraft | null>(null);
  const [reportReason, setReportReason] = useState<SafetyReport["reason"]>("SAFETY_CONCERN");
  const [reportDetails, setReportDetails] = useState("");
  const [originArea, setOriginArea] = useState("");
  const [destinationArea, setDestinationArea] = useState("");
  const [departureStart, setDepartureStart] = useState("08:00");
  const [departureEnd, setDepartureEnd] = useState("08:20");
  const [departureTime, setDepartureTime] = useState("08:10");
  const [tripDate, setTripDate] = useState("");
  const [selectedDays, setSelectedDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [seats, setSeats] = useState(1);
  const [editingCommute, setEditingCommute] = useState<{ id: string; version: number } | null>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [sessionChanging, setSessionChanging] = useState(false);

  const roleRef = useRef(role);
  const loadSeqRef = useRef(0);
  const notificationSeqRef = useRef(0);
  const loadingOlderNotificationsRef = useRef(false);
  const loadedOlderNotificationsRef = useRef(false);
  const pendingIdempotencyKeysRef = useRef<Map<string, PendingIdempotencyKey> | null>(null);
  if (pendingIdempotencyKeysRef.current === null) {
    pendingIdempotencyKeysRef.current = loadPendingIdempotencyKeys();
  }

  const hideDashboardAndRedirect = useCallback((destination: string) => {
    flushSync(() => setSessionChanging(true));
    window.location.replace(destination);
  }, []);

  const accountApi = useCallback(async function accountApi<T>(
    url: string,
    init?: RequestInit,
  ): Promise<T> {
    const headers = new Headers(init?.headers);
    headers.set("X-Expected-Carpool-Actor", accountId);
    return api<T>(url, { ...init, headers }, accountId, roleRef.current, hideDashboardAndRedirect);
  }, [accountId, hideDashboardAndRedirect]);

  async function apiIdempotent<T>(url: string, init: RequestInit): Promise<T> {
    const fingerprint = await requestFingerprint(JSON.stringify([accountId, url, init.method ?? "GET", init.body ?? null]));
    const pendingKeys = pendingIdempotencyKeysRef.current!;
    const now = currentTimestamp();
    for (const [storedFingerprint, storedKey] of pendingKeys) {
      if (now - storedKey.createdAt >= pendingIdempotencyLifetimeMs || storedKey.createdAt > now + 5 * 60 * 1000) {
        pendingKeys.delete(storedFingerprint);
      }
    }
    let pending = pendingKeys.get(fingerprint);
    if (!pending) {
      pending = { key: crypto.randomUUID(), createdAt: now };
      pendingKeys.set(fingerprint, pending);
    }
    savePendingIdempotencyKeys(pendingKeys);

    const headers = new Headers(init.headers);
    headers.set("Idempotency-Key", pending.key);
    const result = await accountApi<T>(url, { ...init, headers });
    pendingKeys.delete(fingerprint);
    savePendingIdempotencyKeys(pendingKeys);
    return result;
  }

  const refreshNotifications = useCallback(async () => {
    const seq = ++notificationSeqRef.current;
    try {
      const result = await accountApi<{ notifications: InboxNotification[]; unreadCount: number; hasMore: boolean }>("/api/notifications");
      if (seq !== notificationSeqRef.current) return;
      setNotifications((current) => {
        const byId = new Map(current.map((item) => [item.id, item]));
        for (const item of result.notifications) byId.set(item.id, item);
        return [...byId.values()].sort((a, b) => b.cursorCreatedAt.localeCompare(a.cursorCreatedAt) || b.id.localeCompare(a.id));
      });
      setUnreadCount(result.unreadCount);
      if (!loadedOlderNotificationsRef.current) setNotificationHasMore(result.hasMore);
    } catch {
      // Inbox polling is best-effort; leave the last successful inbox visible.
    }
  }, [accountApi]);

  async function loadOlderNotifications() {
    const oldest = notifications.at(-1);
    if (!oldest || !notificationHasMore || loadingOlderNotificationsRef.current) return;
    loadingOlderNotificationsRef.current = true;
    setLoadingOlderNotifications(true);
    const seq = ++notificationSeqRef.current;
    try {
      const query = new URLSearchParams({ beforeCreatedAt: oldest.cursorCreatedAt, beforeId: oldest.id });
      const result = await accountApi<{ notifications: InboxNotification[]; unreadCount: number; hasMore: boolean }>(`/api/notifications?${query}`);
      if (seq !== notificationSeqRef.current) return;
      setNotifications((current) => {
        const byId = new Map(current.map((item) => [item.id, item]));
        for (const item of result.notifications) byId.set(item.id, item);
        return [...byId.values()].sort((a, b) => b.cursorCreatedAt.localeCompare(a.cursorCreatedAt) || b.id.localeCompare(a.id));
      });
      setUnreadCount(result.unreadCount);
      setNotificationHasMore(result.hasMore);
      loadedOlderNotificationsRef.current = true;
    } catch (cause) {
      if (seq !== notificationSeqRef.current) return;
      setError(cause instanceof Error ? cause.message : "Could not load older notifications.");
    } finally {
      loadingOlderNotificationsRef.current = false;
      setLoadingOlderNotifications(false);
    }
  }

  // Single guarded loader. A monotonic sequence number ensures a slow, earlier
  // response can never overwrite data from a newer one (for example a reload
  // triggered by "publish" racing the reload for a mode switch).
  const loadDashboard = useCallback(async () => {
    const seq = ++loadSeqRef.current;
    const activeRole = roleRef.current;
    try {
      const [commuteResult, requestResult, tripResult, activityResult, blockResult, reportResult] = await Promise.all([
        activeRole === "DRIVER" ? accountApi<{ commutes: Commute[] }>("/api/commutes") : Promise.resolve({ commutes: [] }),
        accountApi<{ requests: RideRequest[] }>("/api/rides"),
        activeRole === "DRIVER" ? accountApi<{ trips: DriverTrip[] }>("/api/trips") : Promise.resolve({ trips: [] }),
        accountApi<{ activity: ActivityItem[] }>("/api/activity"),
        accountApi<{ blocks: { userId: string; displayName: string }[] }>("/api/blocks"),
        accountApi<{ reports: SafetyReport[] }>("/api/reports"),
      ]);
      if (seq !== loadSeqRef.current) return;
      setCommutes(commuteResult.commutes);
      setRequests(requestResult.requests);
      setPublishedTrips(tripResult.trips);
      setActivity(activityResult.activity);
      setBlockedUsers(blockResult.blocks);
      setMyReports(reportResult.reports);
      setError("");
    } catch (cause) {
      if (seq !== loadSeqRef.current) return;
      setError(cause instanceof Error ? cause.message : "Could not load your dashboard.");
    }
  }, [accountApi]);

  useEffect(() => {
    roleRef.current = role;
    // Defer past the effect body so the initial load happens as a subscription-like
    // async continuation rather than a synchronous cascade during render commit.
    const timer = setTimeout(() => { void loadDashboard(); }, 0);
    return () => clearTimeout(timer);
  }, [role, loadDashboard]);

  useEffect(() => {
    return listenForParticipantModeChange(accountId, () => {
      // Hide mode-specific state while loading the server-rendered mode.
      hideDashboardAndRedirect("/dashboard");
    });
  }, [accountId, hideDashboardAndRedirect]);

  useEffect(() => {
    return listenForAuthSessionChange((change) => {
      if (change.accountId === accountId) return;
      hideDashboardAndRedirect(change.accountId === null ? "/login" : "/dashboard");
    });
  }, [accountId, hideDashboardAndRedirect]);

  useEffect(() => {
    const initialTimer = window.setTimeout(() => { void refreshNotifications(); }, 0);
    const poll = () => {
      if (document.visibilityState === "visible") void refreshNotifications();
    };
    const interval = window.setInterval(poll, 30_000);
    document.addEventListener("visibilitychange", poll);
    return () => {
      window.clearTimeout(initialTimer);
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", poll);
    };
  }, [refreshNotifications]);

  async function perform(action: () => Promise<void>, success: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      setNotice(success);
      await loadDashboard();
      await refreshNotifications();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not complete the request.");
    } finally {
      setBusy(false);
    }
  }

  async function saveCommute(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await perform(async () => {
      await apiIdempotent(editingCommute ? `/api/commutes/${editingCommute.id}` : "/api/commutes", {
        method: editingCommute ? "PATCH" : "POST",
        body: JSON.stringify({
          originArea,
          destinationArea,
          departureWindowStart: departureStart,
          departureWindowEnd: departureEnd,
          weekdays: selectedDays,
          role: "OFFERING",
          seatsOffered: seats,
          ...(editingCommute ? { expectedVersion: editingCommute.version } : {}),
        }),
      });
      stopEditingCommute();
    }, editingCommute ? "Commute updated. Existing published trips are unchanged." : "Commute saved.");
  }

  function beginEditCommute(commute: Commute) {
    setEditingCommute({ id: commute.id, version: commute.version });
    setOriginArea(commute.originArea);
    setDestinationArea(commute.destinationArea);
    setDepartureStart(commute.departureWindowStart);
    setDepartureEnd(commute.departureWindowEnd);
    setSelectedDays(commute.weekdays);
    setSeats(commute.seatsOffered);
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  function stopEditingCommute() {
    setEditingCommute(null);
    setOriginArea("");
    setDestinationArea("");
    setDepartureStart("08:00");
    setDepartureEnd("08:20");
    setSelectedDays([1, 2, 3, 4, 5]);
    setSeats(1);
  }

  async function publishTrip(commuteId: string, date: string) {
    await perform(async () => {
      await apiIdempotent("/api/trips", {
        method: "POST",
        body: JSON.stringify({ commuteTemplateId: commuteId, tripDate: date }),
      });
    }, "Dated trip published.");
  }

  async function cancelTrip(trip: DriverTrip) {
    const confirmed = window.confirm("Cancel this trip? Pending and accepted seat requests will also be withdrawn.");
    if (!confirmed) return;
    await perform(async () => {
      await apiIdempotent(`/api/trips/${trip.tripOccurrenceId}`, {
        method: "DELETE",
      });
    }, "Trip cancelled. Active seat requests were withdrawn.");
  }

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await accountApi<{ candidates: Candidate[] }>("/api/commutes/search", {
        method: "POST",
        body: JSON.stringify({ originArea, destinationArea, tripDate, desiredDeparture: departureTime }),
      });
      setCandidates(result.candidates);
      if (result.candidates.length === 0) setNotice("No matching trips found. Try another date or commute area.");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Search failed.");
    } finally {
      setBusy(false);
    }
  }

  async function requestSeat(candidate: Candidate) {
    await perform(async () => {
      await apiIdempotent("/api/rides", {
        method: "POST",
        body: JSON.stringify({ tripOccurrenceId: candidate.tripOccurrenceId }),
      });
    }, "Seat request sent to the driver.");
  }

  async function requestAction(requestId: string, action: "accept" | "reject" | "cancel") {
    await perform(async () => {
      await apiIdempotent(`/api/rides/${requestId}/${action}`, {
        method: "POST",
      });
    }, action === "accept" ? "Seat request accepted." : action === "reject" ? "Seat request declined." : "Your request was cancelled.");
  }

  async function confirmCompletion(requestId: string) {
    await perform(async () => {
      await apiIdempotent(`/api/rides/${requestId}/complete`, {
        method: "POST",
      });
    }, "Thanks — your confirmation was recorded.");
  }

  async function disputeCompletion(requestId: string) {
    const reason = window.prompt("Describe what happened with this trip.");
    if (!reason || !reason.trim()) return;
    await perform(async () => {
      await apiIdempotent(`/api/rides/${requestId}/dispute`, {
        method: "POST",
        body: JSON.stringify({ reason: reason.trim() }),
      });
    }, "Your trip concern was recorded. It is not an emergency service and no emergency alert is sent.");
  }

  async function setUserBlocked(userId: string, displayName: string, blocked: boolean) {
    if (blocked && !window.confirm(`Block ${displayName}? They will no longer appear in future matches, but existing trips and requests will remain.`)) return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await accountApi(`/api/users/${userId}/block`, { method: blocked ? "POST" : "DELETE" });
      setBlockedUsers((current) => blocked
        ? current.some((user) => user.userId === userId) ? current : [...current, { userId, displayName }]
        : current.filter((user) => user.userId !== userId));
      if (blocked) setCandidates((current) => current.filter((candidate) => candidate.memberId !== userId));
      setNotice(blocked ? `${displayName} was blocked.` : `${displayName} was unblocked.`);
      await loadDashboard();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update blocked users.");
    } finally {
      setBusy(false);
    }
  }

  async function submitReport(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!reportDraft) return;
    await perform(async () => {
      await apiIdempotent("/api/reports", {
        method: "POST",
        body: JSON.stringify({
          reportedUserId: reportDraft.userId,
          tripOccurrenceId: reportDraft.tripOccurrenceId,
          reason: reportReason,
          details: reportDetails,
        }),
      });
      setReportDraft(null);
      setReportDetails("");
    }, "Report submitted. Active reviewers receive an in-app notice, but reports are not monitored continuously or used for emergency response.");
  }

  async function markNotificationRead(id?: string) {
    setError("");
    try {
      await accountApi("/api/notifications", {
        method: "PATCH",
        body: JSON.stringify(id ? { id } : { markAll: true }),
      });
      await refreshNotifications();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update notifications.");
    }
  }

  async function viewReportStatus(reportId: string, notificationId: string) {
    setError("");
    try {
      const result = await accountApi<{ reports: SafetyReport[] }>("/api/reports");
      setMyReports(result.reports);
      await accountApi("/api/notifications", {
        method: "PATCH",
        body: JSON.stringify({ id: notificationId }),
      });
      await refreshNotifications();
      window.setTimeout(() => document.getElementById("my-reports")?.scrollIntoView({ behavior: "smooth" }), 0);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `Could not load report ${reportId}.`);
    }
  }

  async function deleteAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (deleteConfirm !== "DELETE") return;
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await accountApi("/api/account", {
        method: "DELETE",
        body: JSON.stringify({ confirm: "DELETE" }),
      });
      // Closure removes the session, so navigate directly without trying to
      // reload authenticated dashboard data after the successful response.
      announceAuthSessionChange(null);
      hideDashboardAndRedirect("/login");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not close your account.");
    } finally {
      setBusy(false);
    }
  }

  async function switchMode(nextMode: ParticipantRole) {
    if (nextMode === role) return;
    setBusy(true);
    setError("");
    try {
      await accountApi("/api/profile/mode", {
        method: "PATCH",
        body: JSON.stringify({ mode: nextMode }),
      });
      roleRef.current = nextMode;
      setRole(nextMode);
      setCandidates([]);
      announceParticipantModeChange(accountId, nextMode);
      setNotice(`Switched to ${nextMode.toLowerCase()} mode.`);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not switch mode.");
    } finally {
      setBusy(false);
    }
  }

  function toggleDay(day: number) {
    setSelectedDays((current) => current.includes(day) ? current.filter((value) => value !== day) : [...current, day].sort());
  }

  if (sessionChanging) {
    return <main className={styles.page} aria-live="polite"><p>Updating your session…</p></main>;
  }

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div><p className={styles.kicker}>CARPOOL PAKISTAN</p><h1>{role === "RIDER" ? "Find a ride" : "Offer a ride"}</h1><p className={styles.accountIdentity}>Signed in as {accountEmail}</p></div>
        <div className={styles.headerActions}>
          <div className={styles.modeSwitch} aria-label="Dashboard mode">
            <button aria-pressed={role === "RIDER"} disabled={busy} onClick={() => void switchMode("RIDER")}>Rider</button>
            <button aria-pressed={role === "DRIVER"} disabled={busy} onClick={() => void switchMode("DRIVER")}>Driver</button>
          </div>
          <SignOutButton />
        </div>
      </header>
      <p className={styles.lead}>{role === "RIDER" ? "Search for a specific dated trip and request a seat." : "Add your regular commute, then publish the specific dates you can offer a seat."}</p>
      {error && <p className={styles.error} role="alert">{error}</p>}
      {notice && <p className={styles.notice} role="status">{notice}</p>}

      <section className={styles.panel} aria-label="Notification inbox">
        <div className={styles.item}><h2>Notifications{unreadCount > 0 ? ` · ${unreadCount} unread` : ""}</h2>{unreadCount > 0 && <button className={styles.secondary} onClick={() => void markNotificationRead()} disabled={busy}>Mark all read</button>}</div>
        <p className={styles.muted}>Updates refresh automatically while this page is open.</p>
        {notifications.length === 0 ? <p className={styles.muted}>No notifications yet.</p> : notifications.map((notification) => <div className={styles.item} key={notification.id}>
          <div><strong>{notification.title}{notification.readAt ? "" : " · New"}</strong><p>{notification.body} · {new Date(notification.createdAt).toLocaleString()}</p>{notification.kind === "SAFETY_REPORT_RECEIVED" && <a href="/moderation/reports">Open safety review queue</a>}{notification.kind === "SAFETY_REPORT_STATUS_UPDATED" && <button className={styles.secondary} onClick={() => void viewReportStatus(notification.resourceId, notification.id)}>View my report status</button>}</div>
          {!notification.readAt && <button className={styles.secondary} onClick={() => void markNotificationRead(notification.id)}>Mark read</button>}
        </div>)}
        {notificationHasMore && <button className={styles.secondary} onClick={() => void loadOlderNotifications()} disabled={loadingOlderNotifications}>{loadingOlderNotifications ? "Loading…" : "Load older notifications"}</button>}
      </section>

      <section className={styles.panel}>
        <h2>Your activity</h2>
        <p className={styles.muted}>Trips and requests from both Rider and Driver modes.</p>
        {activity.length === 0 ? <p className={styles.muted}>No trips or requests yet.</p> : activity.map((item) => (
          <div className={styles.item} key={`${item.kind}-${item.recordId}`}>
            <div>
              <strong>{item.kind === "TRIP" ? "You offered a ride" : item.role === "DRIVER" ? "A rider requested a seat" : "You requested a ride"}: {item.originArea} → {item.destinationArea}</strong>
              <p>{item.tripDate} at {item.departureTime} · {item.status.toLowerCase()}{item.otherParticipantName ? ` · ${item.role === "DRIVER" ? "Rider" : "Driver"}: ${item.otherParticipantName}` : ""}{item.kind === "TRIP" && item.seatCapacity !== null ? ` · ${item.seatsReserved}/${item.seatCapacity} seats reserved` : ""}</p>
            </div>
            {item.otherParticipantId && <div className={styles.inline}>
              <button className={styles.secondary} disabled={busy} onClick={() => { setReportDraft({ userId: item.otherParticipantId!, displayName: item.otherParticipantName ?? "participant", tripOccurrenceId: item.tripOccurrenceId }); setReportDetails(""); }}>Report</button>
              {!blockedUsers.some((user) => user.userId === item.otherParticipantId) && <button className={styles.secondary} disabled={busy} onClick={() => void setUserBlocked(item.otherParticipantId!, item.otherParticipantName ?? "this user", true)}>Block</button>}
            </div>}
          </div>
        ))}
        {reportDraft && <form className={styles.form} onSubmit={submitReport}>
          <h3>Report {reportDraft.displayName}</h3>
          <p className={styles.muted}>Active reviewers receive an in-app notice. The queue is not monitored continuously, and this is not an emergency service.</p>
          <label>Reason<select required value={reportReason} onChange={(event) => setReportReason(event.target.value as SafetyReport["reason"])}><option value="SAFETY_CONCERN">Safety concern</option><option value="HARASSMENT">Harassment</option><option value="MISREPRESENTATION">Misrepresentation</option><option value="OTHER">Other</option></select></label>
          <label>What happened?<textarea required minLength={1} maxLength={2000} rows={4} value={reportDetails} onChange={(event) => setReportDetails(event.target.value)} /></label>
          <div className={styles.inline}><button disabled={busy || reportDetails.trim().length === 0}>Submit report</button><button type="button" className={styles.secondary} disabled={busy} onClick={() => setReportDraft(null)}>Cancel</button></div>
        </form>}
      </section>

      <section className={styles.panel} id="my-reports">
        <h2>Your reports</h2>
        {myReports.length === 0 ? <p className={styles.muted}>No reports submitted.</p> : myReports.map((report) => <div className={styles.item} key={report.reportId}><div><strong>{report.reportedName} · {report.reason.replaceAll("_", " ").toLowerCase()}</strong><p>{new Date(report.createdAt).toLocaleString()} · {report.status.replaceAll("_", " ").toLowerCase()}</p></div></div>)}
      </section>

      <section className={styles.panel}>
        <h2>Blocked users</h2>
        {blockedUsers.length === 0 ? <p className={styles.muted}>You haven’t blocked anyone.</p> : blockedUsers.map((user) => (
          <div className={styles.item} key={user.userId}>
            <strong>{user.displayName}</strong>
            <button className={styles.secondary} disabled={busy} onClick={() => void setUserBlocked(user.userId, user.displayName, false)}>Unblock</button>
          </div>
        ))}
      </section>

      <section className={styles.panel}>
        <h2>Your account</h2>
        <p className={styles.muted}>Closing your account withdraws your open ride requests and cancels your future trips. Completed trips stay on the other participants’ records without your name. You will not be able to sign in again.</p>
        {!deleteOpen ? (
          <button className={styles.danger} disabled={busy} onClick={() => { setDeleteOpen(true); setDeleteConfirm(""); }}>Close my account</button>
        ) : (
          <form className={styles.form} onSubmit={deleteAccount}>
            <label>Type DELETE to confirm<input autoComplete="off" value={deleteConfirm} onChange={(event) => setDeleteConfirm(event.target.value)} placeholder="DELETE" /></label>
            <div className={styles.inline}>
              <button className={styles.danger} disabled={busy || deleteConfirm !== "DELETE"}>Permanently close account</button>
              <button className={styles.secondary} disabled={busy} type="button" onClick={() => setDeleteOpen(false)}>Keep my account</button>
            </div>
          </form>
        )}
      </section>

      {role === "DRIVER" ? (
        <>
          <section className={styles.panel}>
            <h2>{editingCommute ? "Edit your regular commute" : "Add a regular commute"}</h2>
            <p className={styles.muted}>Changes apply to dates you publish in the future. Already published trips keep their current details.</p>
            <p className={styles.muted}>Riders search these pickup and destination areas. Capitalization and extra spaces are ignored; neighborhood names must still match.</p>
            <form className={styles.form} onSubmit={saveCommute}>
              <label>Pickup area<input required maxLength={120} value={originArea} onChange={(event) => setOriginArea(event.target.value)} placeholder="e.g. Gulberg" /></label>
              <label>Destination area<input required maxLength={120} value={destinationArea} onChange={(event) => setDestinationArea(event.target.value)} placeholder="e.g. DHA Phase 5" /></label>
              <label>Departure from<input required type="time" value={departureStart} onChange={(event) => setDepartureStart(event.target.value)} /></label>
              <label>Departure until<input required type="time" value={departureEnd} onChange={(event) => setDepartureEnd(event.target.value)} /></label>
              <fieldset><legend>Days you usually travel</legend><div className={styles.days}>{weekdays.map((day, index) => <label key={day}><input type="checkbox" checked={selectedDays.includes(index)} onChange={() => toggleDay(index)} />{day}</label>)}</div></fieldset>
              <label>Seats to offer<input required min={1} max={8} type="number" value={seats} onChange={(event) => setSeats(Number(event.target.value))} /></label>
              <div className={styles.inline}>
                <button disabled={busy || selectedDays.length === 0}>{editingCommute ? "Save changes" : "Save commute"}</button>
                {editingCommute && <button className={styles.secondary} disabled={busy} type="button" onClick={stopEditingCommute}>Stop editing</button>}
              </div>
            </form>
          </section>
          <section className={styles.panel}>
            <h2>Publish a dated trip</h2>
            <p className={styles.muted}>Your usual travel days only limit which dates are available. They do not publish trips automatically; publish each date you are offering a seat.</p>
            {commutes.length === 0 ? <p className={styles.muted}>Save a commute first. You can then publish a particular future date.</p> : commutes.map((commute) => (
              <div className={styles.item} key={commute.id}>
                <div><strong>{commute.originArea} → {commute.destinationArea}</strong><p>{commute.departureWindowStart} · {commute.seatsOffered} seat(s) · Usually: {commute.weekdays.map((day) => weekdays[day]).join(", ")}</p></div>
                <div className={styles.inline}>
                  <button className={styles.secondary} disabled={busy} type="button" onClick={() => beginEditCommute(commute)}>Edit commute</button>
                  <input aria-label="Trip date" min={new Date().toLocaleDateString("en-CA")} type="date" value={tripDate} onChange={(event) => setTripDate(event.target.value)} />
                  <button disabled={busy || !tripDate || !commute.weekdays.includes(weekdayForDate(tripDate) ?? -1)} onClick={() => void publishTrip(commute.id, tripDate)}>Publish date</button>
                  {tripDate && !commute.weekdays.includes(weekdayForDate(tripDate) ?? -1) && <span className={styles.inlineMessage}>Choose one of this commute’s usual travel days.</span>}
                </div>
              </div>
            ))}
          </section>
          <section className={styles.panel}>
            <h2>Your published trips</h2>
            {publishedTrips.length === 0 ? <p className={styles.muted}>No upcoming trips published yet.</p> : publishedTrips.map((trip) => (
              <div className={styles.item} key={trip.tripOccurrenceId}>
                <div><strong>{trip.originArea} → {trip.destinationArea}</strong><p>{trip.tripDate} at {trip.departureTime} · {trip.status.toLowerCase()} · {trip.seatsReserved}/{trip.seatCapacity} seats requested</p></div>
                {trip.canCancel && <button className={styles.danger} disabled={busy} onClick={() => void cancelTrip(trip)}>Cancel trip</button>}
              </div>
            ))}
          </section>
          <section className={styles.panel}>
            <h2>Seat requests</h2>
            <RequestList requests={requests} role={role} busy={busy} onAction={requestAction} onConfirm={confirmCompletion} onDispute={disputeCompletion} />
          </section>
        </>
      ) : (
        <>
          <section className={styles.panel}>
            <h2>Search a dated trip</h2>
            <p className={styles.muted}>Enter the same pickup and destination area names as the driver. Capitalization and extra spaces are ignored; nearby neighborhood names are not.</p>
            <form className={styles.form} onSubmit={search}>
              <label>Pickup area<input required maxLength={120} value={originArea} onChange={(event) => setOriginArea(event.target.value)} placeholder="e.g. Gulberg" /></label>
              <label>Destination area<input required maxLength={120} value={destinationArea} onChange={(event) => setDestinationArea(event.target.value)} placeholder="e.g. DHA Phase 5" /></label>
              <label>Trip date<input required type="date" value={tripDate} onChange={(event) => setTripDate(event.target.value)} /></label>
              <label>Preferred departure<input required type="time" value={departureTime} onChange={(event) => setDepartureTime(event.target.value)} /></label>
              <button disabled={busy}>Search</button>
            </form>
          </section>
          <section className={styles.panel}>
            <h2>Matching trips</h2>
            {candidates.length === 0 ? <p className={styles.muted}>Search to see available trips.</p> : candidates.map((candidate) => (
              <div className={styles.item} key={candidate.tripOccurrenceId}>
                <div><strong>{candidate.originArea} → {candidate.destinationArea}</strong><p>{candidate.displayName} · {candidate.departureTime} · {candidate.availableSeats} seat(s)</p></div>
                <div className={styles.inline}>
                  <button disabled={busy || requests.some((request) => request.tripOccurrenceId === candidate.tripOccurrenceId && ["REQUESTED", "ACCEPTED"].includes(request.status))} onClick={() => void requestSeat(candidate)}>{requests.some((request) => request.tripOccurrenceId === candidate.tripOccurrenceId && ["REQUESTED", "ACCEPTED"].includes(request.status)) ? "Already requested" : "Request seat"}</button>
                  <button className={styles.secondary} disabled={busy} onClick={() => void setUserBlocked(candidate.memberId, candidate.displayName, true)}>Block</button>
                </div>
              </div>
            ))}
          </section>
          <section className={styles.panel}>
            <h2>Your requests</h2>
            <RequestList requests={requests} role={role} busy={busy} onAction={requestAction} onConfirm={confirmCompletion} onDispute={disputeCompletion} />
          </section>
        </>
      )}
      <p className={styles.footnote}>Use approximate areas only. A request is not confirmed until the driver accepts it.</p>
    </main>
  );
}

function RequestList({ requests, role, busy, onAction, onConfirm, onDispute }: {
  requests: RideRequest[];
  role: ParticipantRole;
  busy: boolean;
  onAction: (requestId: string, action: "accept" | "reject" | "cancel") => Promise<void>;
  onConfirm: (requestId: string) => Promise<void>;
  onDispute: (requestId: string) => Promise<void>;
}) {
  if (requests.length === 0) return <p className={styles.muted}>No requests yet.</p>;
  return <div className={styles.list}>{requests.map((request) => {
    const myConfirmation = role === "DRIVER"
      ? request.driverConfirmedCompletion
      : request.riderConfirmedCompletion;
    return (
      <div className={styles.item} key={request.requestId}>
        <div>
          <strong>{request.originArea} → {request.destinationArea}</strong>
          <p>{request.tripDate} at {request.departureTime} · {request.otherParticipantName} · {request.status.toLowerCase()}{request.status === "DISPUTED" ? " — awaiting operator review" : ""}</p>
          {/* Completion controls are only meaningful for a seat that was actually granted. */}
          {request.awaitingCompletion && request.status === "ACCEPTED" && <p className={styles.inlineMessage}>{request.riderConfirmedCompletion && request.driverConfirmedCompletion
            ? "Both sides confirmed."
            : myConfirmation
              ? "You confirmed this trip. Waiting for the other participant."
              : "This trip has departed. Confirm it happened, or report a problem."}</p>}
          {request.status === "REQUESTED" && request.departurePassed && <p className={styles.inlineMessage}>This trip departed before the seat was accepted. The request can no longer be actioned and will be closed.</p>}
        </div>
        {request.status === "REQUESTED" && role === "DRIVER" && !request.departurePassed && <div className={styles.inline}><button disabled={busy} onClick={() => void onAction(request.requestId, "accept")}>Accept</button><button className={styles.secondary} disabled={busy} onClick={() => void onAction(request.requestId, "reject")}>Decline</button></div>}
        {request.awaitingCompletion && request.status === "ACCEPTED" && <div className={styles.inline}>
          {!myConfirmation && <button disabled={busy} onClick={() => void onConfirm(request.requestId)}>Confirm trip happened</button>}
          <button className={styles.secondary} disabled={busy} onClick={() => void onDispute(request.requestId)}>Report a problem</button>
        </div>}
        {(["REQUESTED", "ACCEPTED"].includes(request.status)) && role === "RIDER" && !request.awaitingCompletion && <button className={styles.secondary} disabled={busy} onClick={() => void onAction(request.requestId, "cancel")}>Cancel request</button>}
      </div>
    );
  })}</div>;
}
