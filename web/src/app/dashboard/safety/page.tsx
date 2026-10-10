"use client";

/**
 * Safety: my reports, blocked users, and who to contact.
 *
 * Grouped together because these are the things someone looks for when something
 * has gone wrong, and they should not require hunting through ride lists.
 */

import { useCallback, useEffect, useState } from "react";
import { useDashboard } from "@/components/dashboard/dashboard-context";
import { Button, EmptyState, Item, PageHeader, Panel } from "@/components/dashboard/ui";
import type { SafetyReport } from "@/components/dashboard/types";

export default function SafetyPage() {
  const { api, perform } = useDashboard();
  const [reports, setReports] = useState<SafetyReport[]>([]);
  const [blocked, setBlocked] = useState<{ userId: string; displayName: string }[]>([]);
  const [support, setSupport] = useState<{ contact: string | null; hours: string | null }>({ contact: null, hours: null });
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const [reportResult, blockResult, supportResult] = await Promise.all([
        api.accountApi<{ reports: SafetyReport[] }>("/api/reports"),
        api.accountApi<{ blocks: { userId: string; displayName: string }[] }>("/api/blocks"),
        api.accountApi<{ support: { contact: string | null; hours: string | null } }>("/api/support"),
      ]);
      setReports(reportResult.reports);
      setBlocked(blockResult.blocks);
      setSupport(supportResult.support);
    } finally {
      setLoaded(true);
    }
  }, [api]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function unblock(userId: string, displayName: string) {
    await perform(async () => {
      await api.accountApi("/api/blocks", { method: "POST", body: JSON.stringify({ userId, blocked: false }) });
      await load();
    }, `${displayName} was unblocked.`);
  }

  return (
    <>
      <PageHeader
        title="Safety"
        description="Report an issue, manage who you have blocked, and find support. The app does not provide emergency response and this queue is not monitored continuously."
      />

      <Panel title="Your reports" description="Reports are reviewed by a person. You will see the status change here and in your notifications.">
        {reports.length === 0
          ? <EmptyState loaded={loaded} message="You have not submitted a report." />
          : reports.map((report) => (
            <Item key={report.reportId}>
              <strong>{report.reportedName} · {report.reason.replaceAll("_", " ").toLowerCase()}</strong>
              <p className="muted">{new Date(report.createdAt).toLocaleString()} · {report.status.replaceAll("_", " ").toLowerCase()}</p>
            </Item>
          ))}
      </Panel>

      <Panel title="Blocked users" description="Blocking removes someone from future matching in both directions. Existing trips and requests remain.">
        {blocked.length === 0
          ? <EmptyState loaded={loaded} message="You have not blocked anyone." />
          : blocked.map((user) => (
            <Item key={user.userId} actions={<Button variant="secondary" onClick={() => void unblock(user.userId, user.displayName)}>Unblock</Button>}>
              <strong>{user.displayName}</strong>
            </Item>
          ))}
      </Panel>

      <Panel title="Need help from a person?">
        {support.contact
          ? <p className="muted">{support.contact}{support.hours ? ` · ${support.hours}` : ""}</p>
          : <p className="muted">No support contact has been published yet. Reports and blocking still work; this app does not provide emergency response.</p>}
      </Panel>
    </>
  );
}
