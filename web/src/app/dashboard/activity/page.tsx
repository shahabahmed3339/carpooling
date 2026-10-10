"use client";

/**
 * The full activity feed, across both modes.
 *
 * Read-only by design: actions belong on the Requests page, where the counterpart
 * and the request's own state are visible. Duplicating them here would invite the
 * same action from two places with different context.
 */

import { useCallback, useEffect, useState } from "react";
import { useDashboard } from "@/components/dashboard/dashboard-context";
import { EmptyState, Item, PageHeader, Panel } from "@/components/dashboard/ui";
import type { ActivityItem } from "@/components/dashboard/types";

export default function ActivityPage() {
  const { api } = useDashboard();
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await api.accountApi<{ activity: ActivityItem[] }>("/api/activity");
      setActivity(result.activity);
    } finally {
      setLoaded(true);
    }
  }, [api]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  return (
    <>
      <PageHeader title="Activity" description="Trips and requests from both Rider and Driver modes, newest first." />
      <Panel>
        {activity.length === 0
          ? <EmptyState loaded={loaded} message="No trips or requests yet." />
          : activity.map((item) => (
            <Item key={`${item.kind}-${item.recordId}`}>
              <strong>
                {item.kind === "TRIP"
                  ? "You offered a ride"
                  : item.role === "DRIVER" ? "A rider requested a seat" : "You requested a ride"}: {item.originArea} → {item.destinationArea}
              </strong>
              <p className="muted">
                {item.tripDate} at {item.departureTime} · {item.status.toLowerCase()}
                {item.otherParticipantName ? ` · ${item.role === "DRIVER" ? "Rider" : "Driver"}: ${item.otherParticipantName}` : ""}
                {item.kind === "TRIP" && item.seatCapacity !== null ? ` · ${item.seatsReserved}/${item.seatCapacity} seats reserved` : ""}
              </p>
            </Item>
          ))}
      </Panel>
    </>
  );
}
