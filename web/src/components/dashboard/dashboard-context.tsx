"use client";

/**
 * Shared dashboard state for every page under /dashboard.
 *
 * The old dashboard was one component with all state in it. Splitting the screen
 * into pages must not split the state: the rider/driver mode, the notification
 * inbox and its 30-second refresh, the "session changed in another tab" handling,
 * and the profile are all global to the account, not to a page. A page that loaded
 * its own copy of the inbox would poll independently and show a different unread
 * count than the header bell.
 *
 * So this provider holds what is genuinely shared, and each page fetches what is
 * specific to it.
 */

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { flushSync } from "react-dom";
import {
  announceParticipantModeChange,
  listenForAuthSessionChange,
  listenForParticipantModeChange,
} from "@/lib/session-change";
import { createApiClient, type ApiClient } from "./api-client";
import type {
  InboxNotification,
  MyProfile,
  ParticipantRole,
} from "./types";

type DashboardContextValue = {
  accountId: string;
  accountEmail: string;
  role: ParticipantRole;
  switchingMode: boolean;
  switchMode: (next: ParticipantRole) => Promise<void>;
  api: ApiClient;
  /** Authenticated request with the account and mode guards. */
  accountApi: <T>(url: string, init?: RequestInit) => Promise<T>;
  /**
   * The same, plus a stable idempotency key — use for every mutation. Exposed
   * separately so a page cannot accidentally send a mutation as a plain request
   * and lose retry safety.
   */
  apiIdempotent: <T>(url: string, init: RequestInit) => Promise<T>;
  /** Shared notice/error banner, so any page can report the result of an action. */
  notice: string;
  error: string;
  busy: boolean;
  setNotice: (value: string) => void;
  setError: (value: string) => void;
  /** Run a mutation with the shared busy flag and a success message. */
  perform: (action: () => Promise<void>, success: string) => Promise<void>;
  /** Wrapped so pages can clear messages without importing the setters. */
  clearMessages: () => void;
  notifications: InboxNotification[];
  notificationsLoaded: boolean;
  unreadCount: number;
  notificationHasMore: boolean;
  loadingOlderNotifications: boolean;
  refreshNotifications: () => Promise<void>;
  loadOlderNotifications: () => Promise<void>;
  markNotificationRead: (id?: string) => Promise<void>;
  profile: MyProfile | null;
  reloadProfile: () => Promise<void>;
};

const DashboardContext = createContext<DashboardContextValue | null>(null);

export function useDashboard(): DashboardContextValue {
  const value = useContext(DashboardContext);
  if (value === null) throw new Error("useDashboard must be used inside DashboardProvider.");
  return value;
}

export function DashboardProvider({
  initialMode,
  accountEmail,
  accountId,
  children,
}: {
  initialMode: ParticipantRole;
  accountEmail: string;
  accountId: string;
  children: ReactNode;
}) {
  const [role, setRole] = useState<ParticipantRole>(initialMode);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [switchingMode, setSwitchingMode] = useState(false);

  const [notifications, setNotifications] = useState<InboxNotification[]>([]);
  const [notificationsLoaded, setNotificationsLoaded] = useState(false);
  const [unreadCount, setUnreadCount] = useState(0);
  const [notificationHasMore, setNotificationHasMore] = useState(false);
  const [loadingOlderNotifications, setLoadingOlderNotifications] = useState(false);
  const [profile, setProfile] = useState<MyProfile | null>(null);

  // Refs, not state: these gate request ordering and are read inside callbacks
  // that must not be re-created when they change.
  const notificationSeqRef = useRef(0);
  const loadingOlderRef = useRef(false);
  const loadedOlderRef = useRef(false);

  const hideDashboardAndRedirect = useCallback((destination: string) => {
    // flushSync so the "updating your session" state paints before the navigation
    // begins; otherwise the page can flash stale data from the old account.
    flushSync(() => setSwitchingMode(true));
    window.location.replace(destination);
  }, []);

  // The guard compares the response's mode against the mode this render is in.
  // `role` is captured by value and the client is rebuilt when it changes, which
  // is safe because a mode change navigates and reloads anyway.
  const api = useMemo(
    () => createApiClient({ accountId, getMode: () => role, onContextChanged: hideDashboardAndRedirect }),
    [accountId, role, hideDashboardAndRedirect],
  );

  const perform = useCallback(async (action: () => Promise<void>, success: string) => {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      setNotice(success);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Something went wrong.");
    } finally {
      setBusy(false);
    }
  }, []);

  const clearMessages = useCallback(() => {
    setError("");
    setNotice("");
  }, []);

  const refreshNotifications = useCallback(async () => {
    const seq = ++notificationSeqRef.current;
    try {
      const result = await api.accountApi<{ notifications: InboxNotification[]; unreadCount: number; hasMore: boolean }>("/api/notifications");
      if (seq !== notificationSeqRef.current) return;
      setNotifications((current) => {
        // Merge by id rather than replace: a poll must not drop a page the user
        // already loaded, and a notice marked read locally must not flicker back.
        const byId = new Map(current.map((item) => [item.id, item]));
        for (const item of result.notifications) byId.set(item.id, item);
        return [...byId.values()].sort((a, b) => b.cursorCreatedAt.localeCompare(a.cursorCreatedAt) || b.id.localeCompare(a.id));
      });
      setUnreadCount(result.unreadCount);
      if (!loadedOlderRef.current) setNotificationHasMore(result.hasMore);
      setNotificationsLoaded(true);
    } catch {
      // Inbox polling is best-effort; leave the last successful inbox visible.
    }
  }, [api]);

  const loadOlderNotifications = useCallback(async () => {
    const oldest = notifications.at(-1);
    if (!oldest || !notificationHasMore || loadingOlderRef.current) return;
    loadingOlderRef.current = true;
    setLoadingOlderNotifications(true);
    const seq = ++notificationSeqRef.current;
    try {
      const query = new URLSearchParams({ beforeCreatedAt: oldest.cursorCreatedAt, beforeId: oldest.id });
      const result = await api.accountApi<{ notifications: InboxNotification[]; unreadCount: number; hasMore: boolean }>(`/api/notifications?${query}`);
      if (seq !== notificationSeqRef.current) return;
      setNotifications((current) => {
        const byId = new Map(current.map((item) => [item.id, item]));
        for (const item of result.notifications) byId.set(item.id, item);
        return [...byId.values()].sort((a, b) => b.cursorCreatedAt.localeCompare(a.cursorCreatedAt) || b.id.localeCompare(a.id));
      });
      setUnreadCount(result.unreadCount);
      setNotificationHasMore(result.hasMore);
      loadedOlderRef.current = true;
    } catch (cause) {
      if (seq !== notificationSeqRef.current) return;
      setError(cause instanceof Error ? cause.message : "Could not load older notifications.");
    } finally {
      loadingOlderRef.current = false;
      setLoadingOlderNotifications(false);
    }
  }, [api, notifications, notificationHasMore]);

  const markNotificationRead = useCallback(async (id?: string) => {
    setError("");
    try {
      await api.accountApi("/api/notifications", {
        method: "PATCH",
        body: JSON.stringify(id ? { id } : { markAll: true }),
      });
      await refreshNotifications();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update notifications.");
    }
  }, [api, refreshNotifications]);

  const reloadProfile = useCallback(async () => {
    try {
      setProfile(await api.accountApi<MyProfile>("/api/profile"));
    } catch {
      // The dashboard stays usable without the profile panel.
    }
  }, [api]);

  const switchMode = useCallback(async (next: ParticipantRole) => {
    if (next === role) return;
    setBusy(true);
    setError("");
    try {
      await api.accountApi("/api/profile/mode", { method: "PATCH", body: JSON.stringify({ mode: next }) });
      setRole(next);
      // Tell other tabs, then reload so server-rendered, mode-gated data is correct
      // rather than rendering the new mode over the old mode's fetched rows.
      announceParticipantModeChange(accountId, next);
      hideDashboardAndRedirect("/dashboard");
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not switch mode.");
      setBusy(false);
    }
  }, [accountId, api, hideDashboardAndRedirect, role]);



  // Inbox: load once, then poll while the tab is visible.
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

  useEffect(() => {
    const timer = window.setTimeout(() => { void reloadProfile(); }, 0);
    return () => window.clearTimeout(timer);
  }, [reloadProfile]);

  // Mode changed in another tab or device: reload rather than render mixed state.
  useEffect(() => {
    return listenForParticipantModeChange(accountId, () => hideDashboardAndRedirect("/dashboard"));
  }, [accountId, hideDashboardAndRedirect]);

  // Signed in or out as someone else in another tab: drop this account's state.
  //
  // Listen only. Re-broadcasting the event here would echo it back to the tab that
  // sent it and to every other tab, turning one sign-out into a storm; announcing
  // is the job of the code that performs the action (the sign-out button and the
  // sign-in completion page).
  useEffect(() => {
    return listenForAuthSessionChange((change) => {
      if (change.accountId === accountId) return;
      hideDashboardAndRedirect(change.accountId === null ? "/login" : "/dashboard");
    });
  }, [accountId, hideDashboardAndRedirect]);

  const value = useMemo<DashboardContextValue>(() => ({
    accountId,
    accountEmail,
    role,
    switchingMode,
    switchMode,
    api,
    accountApi: api.accountApi,
    apiIdempotent: api.apiIdempotent,
    notice,
    error,
    busy,
    setNotice,
    setError,
    perform,
    clearMessages,
    notifications,
    notificationsLoaded,
    unreadCount,
    notificationHasMore,
    loadingOlderNotifications,
    refreshNotifications,
    loadOlderNotifications,
    markNotificationRead,
    profile,
    reloadProfile,
  }), [
    accountId, accountEmail, role, switchingMode, switchMode, api, notice, error, busy,
    perform, clearMessages, notifications, notificationsLoaded, unreadCount, notificationHasMore,
    loadingOlderNotifications, refreshNotifications, loadOlderNotifications, markNotificationRead,
    profile, reloadProfile,
  ]);

  if (switchingMode) {
    return <main className="page"><p aria-live="polite">Updating your session…</p></main>;
  }

  return <DashboardContext.Provider value={value}>{children}</DashboardContext.Provider>;
}
