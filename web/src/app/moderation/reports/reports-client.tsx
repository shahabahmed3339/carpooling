"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { flushSync } from "react-dom";
import { listenForAuthSessionChange } from "@/lib/session-change";
import styles from "@/app/dashboard/dashboard.module.css";

type NoShowEvidence = {
  requestId: string;
  outcome: "RIDER_UNCONFIRMED" | "DRIVER_UNCONFIRMED" | "NEITHER_CONFIRMED" | "BOTH_CONFIRMED";
  riderName: string;
  driverName: string;
  originArea: string;
  destinationArea: string;
  tripDate: string;
  departedAt: string;
};

type Report = {
  reportId: string;
  reportedName: string;
  tripOccurrenceId: string | null;
  reason: "SAFETY_CONCERN" | "HARASSMENT" | "MISREPRESENTATION" | "OTHER";
  details: string;
  status: "RECEIVED" | "IN_REVIEW" | "RESOLVED" | "DISMISSED";
  createdAt: string;
};
type ReportEvent = {
  eventId: string;
  eventKind: "SUBMITTED" | "STATUS_CHANGED" | "MIGRATION_SNAPSHOT";
  fromStatus: "RECEIVED" | "IN_REVIEW" | "RESOLVED" | "DISMISSED" | null;
  toStatus: "RECEIVED" | "IN_REVIEW" | "RESOLVED" | "DISMISSED";
  actorName: string;
  notes: string | null;
  createdAt: string;
};

type ApiError = { error?: { code?: string; message?: string } };

async function api<T>(
  url: string,
  accountId: string,
  onAccessLost: (destination: string) => void,
  init?: RequestInit,
): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has("Content-Type")) headers.set("Content-Type", "application/json");
  headers.set("X-Expected-Carpool-Actor", accountId);
  const response = await fetch(url, { ...init, cache: "no-store", headers });
  if (response.status === 401) {
    onAccessLost("/login");
    throw new Error("Your sign-in expired. Redirecting to sign-in.");
  }
  const responseAccountId = response.headers.get("X-Carpool-Actor");
  if (response.status === 403) {
    onAccessLost(responseAccountId ? "/dashboard" : "/auth/complete");
    throw new Error("Your reviewer access changed. Redirecting.");
  }
  if ((responseAccountId !== null && responseAccountId !== accountId) || (response.ok && !responseAccountId)) {
    onAccessLost("/dashboard");
    throw new Error("Your signed-in account changed. Reloading your dashboard.");
  }
  let payload: T & ApiError;
  try {
    payload = await response.json() as T & ApiError;
  } catch {
    if (response.ok) throw new Error("The server response could not be read. Refresh before continuing.");
    payload = {} as T & ApiError;
  }
  if (!response.ok) throw new Error(payload.error?.message ?? "Could not complete the request.");
  return payload;
}

export default function ModerationReportsClient({ accountId }: { accountId: string }) {
  const [reports, setReports] = useState<Report[]>([]);
  const [closedReports, setClosedReports] = useState<Report[]>([]);
  const [evidence, setEvidence] = useState<NoShowEvidence[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState("");
  const [history, setHistory] = useState<Record<string, ReportEvent[]>>({});
  const [historyVisibleId, setHistoryVisibleId] = useState("");
  const [historyLoadingId, setHistoryLoadingId] = useState("");
  const queueSeqRef = useRef(0);
  const accessValidRef = useRef(true);

  const clearSensitiveStateAndRedirect = useCallback((destination: string) => {
    accessValidRef.current = false;
    queueSeqRef.current += 1;
    flushSync(() => {
      setReports([]);
      setClosedReports([]);
      setEvidence([]);
      setNotes({});
      setHistory({});
      setHistoryVisibleId("");
      setHistoryLoadingId("");
    });
    window.location.replace(destination);
  }, []);

  useEffect(() => {
    return listenForAuthSessionChange((change) => {
      if (change.accountId === accountId) return;
      clearSensitiveStateAndRedirect(change.accountId === null ? "/login" : "/dashboard");
    });
  }, [accountId, clearSensitiveStateAndRedirect]);

  const reload = useCallback(async () => {
    if (!accessValidRef.current) return;
    const seq = ++queueSeqRef.current;
    const [reportResult, evidenceResult] = await Promise.all([
      api<{ reports: Report[]; closedReports: Report[] }>("/api/moderation/reports", accountId, clearSensitiveStateAndRedirect),
      api<{ evidence: NoShowEvidence[] }>("/api/moderation/no-shows", accountId, clearSensitiveStateAndRedirect),
    ]);
    if (!accessValidRef.current || seq !== queueSeqRef.current) return;
    setReports(reportResult.reports);
    setClosedReports(reportResult.closedReports);
    setEvidence(evidenceResult.evidence);
  }, [accountId, clearSensitiveStateAndRedirect]);

  useEffect(() => {
    const poll = () => {
      if (document.visibilityState !== "visible") return;
      void reload().catch((cause: unknown) => {
        setError(cause instanceof Error ? cause.message : "Could not refresh reports.");
      });
    };
    const initialTimer = window.setTimeout(poll, 0);
    const interval = window.setInterval(poll, 30_000);
    document.addEventListener("visibilitychange", poll);
    window.addEventListener("focus", poll);
    return () => {
      queueSeqRef.current += 1;
      window.clearTimeout(initialTimer);
      window.clearInterval(interval);
      document.removeEventListener("visibilitychange", poll);
      window.removeEventListener("focus", poll);
    };
  }, [reload]);
  async function update(reportId: string, status: "IN_REVIEW" | "RESOLVED" | "DISMISSED") {
    setBusyId(reportId);
    setError("");
    setNotice("");
    try {
      await api(`/api/moderation/reports/${reportId}`, accountId, clearSensitiveStateAndRedirect, {
        method: "PATCH",
        body: JSON.stringify({ status, resolutionNotes: notes[reportId] ?? "" }),
      });
      if (!accessValidRef.current) return;
      setNotice(`Report ${status.replaceAll("_", " ").toLowerCase()}.`);
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update report.");
    } finally {
      setBusyId("");
    }
  }

  async function toggleHistory(reportId: string) {
    if (historyVisibleId === reportId) {
      setHistoryVisibleId("");
      return;
    }
    setHistoryVisibleId(reportId);
    if (history[reportId]) return;
    setHistoryLoadingId(reportId);
    try {
      const result = await api<{ events: ReportEvent[] }>(`/api/moderation/reports/${reportId}`, accountId, clearSensitiveStateAndRedirect);
      if (!accessValidRef.current) return;
      setHistory((current) => ({ ...current, [reportId]: result.events }));
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load report history.");
    } finally {
      setHistoryLoadingId("");
    }
  }

  function renderHistory(reportId: string) {
    if (historyVisibleId !== reportId) return null;
    const events = history[reportId];
    return <div aria-label="Report history">
      <h3>Report history</h3>
      {!events ? <p className={styles.muted}>Loading history…</p> : events.length === 0 ? <p className={styles.muted}>No history is available.</p> : events.map((event) => <div className={styles.item} key={event.eventId}>
        <div>
          <strong>{event.eventKind === "MIGRATION_SNAPSHOT" ? "Historical snapshot; earlier transitions are unavailable" : event.eventKind === "SUBMITTED" ? "Report submitted" : `Status changed: ${event.fromStatus?.replaceAll("_", " ").toLowerCase()} → ${event.toStatus.replaceAll("_", " ").toLowerCase()}`}</strong>
          <p>{event.actorName} · {new Date(event.createdAt).toLocaleString()}</p>
          {event.notes && <p>{event.notes}</p>}
        </div>
      </div>)}
    </div>;
  }

  return <main className={styles.page}>
    <header className={styles.header}><div><p className={styles.kicker}>CARPOOL PAKISTAN · STAFF</p><h1>Safety reports</h1></div><a href="/dashboard">Back to dashboard</a></header>
    <p className={styles.lead}>Restricted to operators and safety reviewers. This queue refreshes on focus and every 30 seconds while visible, but does not send alerts; check it during the support hours you have published.</p>
    {error && <p className={styles.error} role="alert">{error}</p>}
    {notice && <p className={styles.notice} role="status">{notice}</p>}
    {reports.length === 0 ? <section className={styles.panel}><p className={styles.muted}>No open reports.</p></section> : reports.map((report) => <section className={styles.panel} key={report.reportId}>
      <h2>{report.reason.replaceAll("_", " ").toLowerCase()} · {report.status.replaceAll("_", " ").toLowerCase()}</h2>
      <p className={styles.muted}>Reported user: {report.reportedName} · Submitted {new Date(report.createdAt).toLocaleString()}{report.tripOccurrenceId ? ` · Trip ${report.tripOccurrenceId}` : ""}</p>
      <p>{report.details}</p>
      <label className={styles.form}>Internal review notes<textarea maxLength={2000} rows={3} value={notes[report.reportId] ?? ""} onChange={(event) => setNotes((current) => ({ ...current, [report.reportId]: event.target.value }))} /></label>
      <div className={styles.inline}>
        {report.status === "RECEIVED" && <button disabled={busyId === report.reportId} onClick={() => void update(report.reportId, "IN_REVIEW")}>Start review</button>}
        <button className={styles.secondary} disabled={busyId === report.reportId} onClick={() => void update(report.reportId, "RESOLVED")}>Resolve</button>
        <button className={styles.danger} disabled={busyId === report.reportId} onClick={() => void update(report.reportId, "DISMISSED")}>Dismiss</button>
        <button className={styles.secondary} disabled={historyLoadingId === report.reportId} onClick={() => void toggleHistory(report.reportId)}>{historyLoadingId === report.reportId ? "Loading history…" : historyVisibleId === report.reportId ? "Hide history" : "View history"}</button>
      </div>
      {renderHistory(report.reportId)}
    </section>)}

    <section className={styles.panel}>
      <h2>Recently closed reports</h2>
      <p className={styles.muted}>Latest 50 resolved or dismissed reports in this review scope.</p>
      {closedReports.length === 0 ? <p className={styles.muted}>No recently closed reports.</p> : closedReports.map((report) => <article className={styles.item} key={report.reportId}>
        <div>
          <strong>{report.reason.replaceAll("_", " ").toLowerCase()} · {report.status.replaceAll("_", " ").toLowerCase()}</strong>
          <p>Reported user: {report.reportedName} · Submitted {new Date(report.createdAt).toLocaleString()}</p>
          <p>{report.details}</p>
          <button className={styles.secondary} disabled={historyLoadingId === report.reportId} onClick={() => void toggleHistory(report.reportId)}>{historyLoadingId === report.reportId ? "Loading history…" : historyVisibleId === report.reportId ? "Hide history" : "View history"}</button>
          {renderHistory(report.reportId)}
        </div>
      </article>)}
    </section>

    <section className={styles.panel}>
      <h2>Unconfirmed trips</h2>
      <p className={styles.muted}>
        Trips whose completion window closed without both sides confirming. This is evidence to look into, not a
        finding: someone may have travelled and simply not reopened the app. Do not treat a row here as proof that a
        person failed to show up.
      </p>
      {evidence.length === 0 ? <p className={styles.muted}>No unconfirmed trips.</p> : evidence.map((row) => (
        <div className={styles.item} key={row.requestId}>
          <div>
            <strong>{row.outcome.replaceAll("_", " ").toLowerCase()} · {row.originArea} → {row.destinationArea}</strong>
            <p>{row.tripDate} · rider {row.riderName} · driver {row.driverName} · departed {new Date(row.departedAt).toLocaleString()}</p>
          </div>
        </div>
      ))}
    </section>
  </main>;
}
