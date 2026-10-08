"use client";

import { useCallback, useEffect, useState } from "react";
import styles from "@/app/dashboard/dashboard.module.css";

type Report = {
  reportId: string;
  reportedName: string;
  tripOccurrenceId: string | null;
  reason: "SAFETY_CONCERN" | "HARASSMENT" | "MISREPRESENTATION" | "OTHER";
  details: string;
  status: "RECEIVED" | "IN_REVIEW";
  createdAt: string;
};

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const payload = await response.json().catch(() => ({})) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message ?? "Could not complete the request.");
  return payload;
}

export default function ModerationReportsPage() {
  const [reports, setReports] = useState<Report[]>([]);
  const [notes, setNotes] = useState<Record<string, string>>({});
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [busyId, setBusyId] = useState("");

  const reload = useCallback(async () => {
    const result = await api<{ reports: Report[] }>("/api/moderation/reports");
    setReports(result.reports);
  }, []);

  useEffect(() => {
    void reload().catch((cause: unknown) => setError(cause instanceof Error ? cause.message : "Could not load reports."));
  }, [reload]);

  async function update(reportId: string, status: "IN_REVIEW" | "RESOLVED" | "DISMISSED") {
    setBusyId(reportId);
    setError("");
    setNotice("");
    try {
      await api(`/api/moderation/reports/${reportId}`, {
        method: "PATCH",
        body: JSON.stringify({ status, resolutionNotes: notes[reportId] ?? "" }),
      });
      setNotice(`Report ${status.replaceAll("_", " ").toLowerCase()}.`);
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not update report.");
    } finally {
      setBusyId("");
    }
  }

  return <main className={styles.page}>
    <header className={styles.header}><div><p className={styles.kicker}>CARPOOL PAKISTAN · STAFF</p><h1>Safety reports</h1></div><a href="/dashboard">Back to dashboard</a></header>
    <p className={styles.lead}>Restricted to members assigned the operator or safety reviewer role. This queue does not send alerts; check it during the support hours you have published.</p>
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
      </div>
    </section>)}
  </main>;
}
