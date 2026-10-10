"use client";

/**
 * Overview: what needs attention now, with links to the pages that do the work.
 *
 * Deliberately a summary rather than a second copy of every list. The old page
 * repeated every section; this shows counts and the few items that are actionable,
 * so a person can see their situation without scrolling past forms they did not
 * come for.
 */

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { useDashboard } from "@/components/dashboard/dashboard-context";
import { EmptyState, Item, PageHeader, Panel, Stat } from "@/components/dashboard/ui";
import styles from "@/components/dashboard/ui.module.css";
import type { ActivityItem, RideRequest } from "@/components/dashboard/types";

export default function OverviewClient() {
  const { api, role, accountEmail, profile } = useDashboard();
  const [requests, setRequests] = useState<RideRequest[]>([]);
  const [activity, setActivity] = useState<ActivityItem[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const [requestResult, activityResult] = await Promise.all([
        api.accountApi<{ requests: RideRequest[] }>("/api/rides"),
        api.accountApi<{ activity: ActivityItem[] }>("/api/activity"),
      ]);
      setRequests(requestResult.requests);
      setActivity(activityResult.activity);
    } catch {
      // The overview is a summary; a failure here must not blank the shell.
    } finally {
      setLoaded(true);
    }
  }, [api]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  // What actually needs the user's attention in their current mode.
  const awaitingMyAccept = role === "DRIVER" ? requests.filter((r) => r.status === "REQUESTED" && !r.departurePassed) : [];
  const awaitingMyRating = requests.filter((r) => r.status === "COMPLETED");
  const awaitingMyConfirmation = requests.filter((r) => r.status === "ACCEPTED" && r.awaitingCompletion);
  const activeRequests = requests.filter((r) => ["REQUESTED", "ACCEPTED"].includes(r.status));

  return (
    <>
      <PageHeader
        title={role === "DRIVER" ? "Driving" : "Riding"}
        description={`Signed in as ${accountEmail}. ${role === "DRIVER" ? "Publish the dates you can offer, and answer seat requests." : "Search published trips and request a seat."}`}
      />

      {profile && (!profile.phone || (role === "DRIVER" && !profile.vehicle)) && (
        <Panel>
          <p className="muted">
            <strong>Your profile is incomplete.</strong>{" "}
            {!profile.phone && "Other participants cannot contact you. "}
            {role === "DRIVER" && !profile.vehicle && "Riders cannot identify your car. "}
            <Link href="/dashboard/settings">Complete your profile</Link>.
          </p>
        </Panel>
      )}

      <Panel title="Summary">
        <div className={styles.statGrid}>
          <Stat label="Active requests" value={activeRequests.length} hint="Requested or accepted" />
          <Stat
            label="Needing your answer"
            value={role === "DRIVER" ? awaitingMyAccept.length : awaitingMyConfirmation.length}
            hint={role === "DRIVER" ? "Seat requests to accept or decline" : "Trips to confirm or dispute"}
          />
          <Stat label="Completed trips" value={activity.filter((item) => item.status === "COMPLETED").length} />
          <Stat label="Pending ratings" value={awaitingMyRating.length} hint="Completed trips you can rate" />
        </div>
      </Panel>

      {role === "DRIVER" && (
        <Panel title="Seat requests waiting for you" description="A rider is not confirmed until you accept.">
          {awaitingMyAccept.length === 0
            ? <EmptyState loaded={loaded} message="No seat requests waiting." />
            : awaitingMyAccept.map((request) => (
              <Item key={request.requestId}>
                <strong>{request.originArea} → {request.destinationArea}</strong>
                <p className="muted">{request.tripDate} at {request.departureTime} · {request.otherParticipantName}</p>
              </Item>
            ))}
          {awaitingMyAccept.length > 0 && <p><Link href="/dashboard/requests">Answer requests</Link></p>}
        </Panel>
      )}

      {role === "RIDER" && (
        <Panel title="Trips needing your confirmation" description="Confirm a trip happened, or report a problem.">
          {awaitingMyConfirmation.length === 0
            ? <EmptyState loaded={loaded} message="Nothing waiting for confirmation." />
            : awaitingMyConfirmation.map((request) => (
              <Item key={request.requestId}>
                <strong>{request.originArea} → {request.destinationArea}</strong>
                <p className="muted">{request.tripDate} at {request.departureTime} · {request.otherParticipantName}</p>
              </Item>
            ))}
          {awaitingMyConfirmation.length > 0 && <p><Link href="/dashboard/requests">Confirm or report</Link></p>}
        </Panel>
      )}

      <Panel title="Recent activity" description="The last few items from both modes.">
        {activity.length === 0
          ? <EmptyState loaded={loaded} message="No trips or requests yet." />
          : activity.slice(0, 5).map((item) => (
            <Item key={`${item.kind}-${item.recordId}`}>
              <strong>
                {item.kind === "TRIP" ? "You offered a ride" : item.role === "DRIVER" ? "A rider requested a seat" : "You requested a ride"}: {item.originArea} → {item.destinationArea}
              </strong>
              <p className="muted">{item.tripDate} at {item.departureTime} · {item.status.toLowerCase()}</p>
            </Item>
          ))}
        {activity.length > 5 && <p><Link href="/dashboard/activity">See all activity</Link></p>}
        {awaitingMyRating.length > 0 && <p><Link href="/dashboard/ratings">Rate completed trips</Link></p>}
      </Panel>
    </>
  );
}
