"use client";

/**
 * Seat requests the account is part of, from both sides of the seat.
 *
 * The richest page: it carries accept/decline/cancel, the counterpart's identity
 * and meeting detail, completion confirmation, disputes and rating — because all
 * of those only make sense in the context of one request.
 */

import { useCallback, useEffect, useState } from "react";
import { useDashboard } from "@/components/dashboard/dashboard-context";
import { Button, EmptyState, InlineMessage, Item, PageHeader, Panel } from "@/components/dashboard/ui";
import type { CounterpartIdentity, RideRequest } from "@/components/dashboard/types";

export default function RequestsPage() {
  const { api, apiIdempotent, role, perform } = useDashboard();
  const [requests, setRequests] = useState<RideRequest[]>([]);
  const [loaded, setLoaded] = useState(false);
  const [identities, setIdentities] = useState<Record<string, CounterpartIdentity>>({});
  const [rated, setRated] = useState<Set<string>>(new Set());

  const loadIdentities = useCallback(async (list: RideRequest[]) => {
    const accepted = list.filter((request) => request.status === "ACCEPTED");
    const entries = await Promise.all(accepted.map(async (request) => {
      try {
        const result = await api.accountApi<{ identity: CounterpartIdentity | null }>(`/api/rides/${request.requestId}/counterpart`);
        return [request.requestId, result.identity] as const;
      } catch {
        return [request.requestId, null] as const;
      }
    }));
    setIdentities(Object.fromEntries(entries.filter(([, identity]) => identity !== null)) as Record<string, CounterpartIdentity>);
  }, [api]);

  const load = useCallback(async () => {
    try {
      const [requestResult, ratingResult] = await Promise.all([
        api.accountApi<{ requests: RideRequest[] }>("/api/rides"),
        api.accountApi<{ authoredRequestIds: string[] }>("/api/ratings").catch(() => ({ authoredRequestIds: [] })),
      ]);
      setRequests(requestResult.requests);
      setRated(new Set(ratingResult.authoredRequestIds));
      void loadIdentities(requestResult.requests);
    } finally {
      setLoaded(true);
    }
  }, [api, loadIdentities]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  async function act(requestId: string, action: "accept" | "reject" | "cancel") {
    await perform(async () => {
      await apiIdempotent(`/api/rides/${requestId}/${action}`, { method: "POST" });
      await load();
    }, action === "accept" ? "Seat request accepted." : action === "reject" ? "Seat request declined." : "Your request was cancelled.");
  }

  async function confirmCompletion(requestId: string) {
    await perform(async () => {
      await apiIdempotent(`/api/rides/${requestId}/complete`, { method: "POST" });
      await load();
    }, "Thanks — your confirmation was recorded.");
  }

  async function dispute(requestId: string) {
    const reason = window.prompt("Describe what happened with this trip.");
    if (!reason || !reason.trim()) return;
    await perform(async () => {
      await apiIdempotent(`/api/rides/${requestId}/dispute`, { method: "POST", body: JSON.stringify({ reason: reason.trim() }) });
      await load();
    }, "Your trip concern was recorded. It is not an emergency service and no emergency alert is sent.");
  }

  async function meetingDetail(requestId: string, current: string | null) {
    const entered = window.prompt(
      "Share an exact pickup point or contact detail for this confirmed ride. Leaving it blank withdraws what you shared. Only the other participant sees this, and only while the seat is confirmed.",
      current ?? "",
    );
    if (entered === null) return;
    await perform(async () => {
      await apiIdempotent(`/api/rides/${requestId}/meeting-detail`, {
        method: "PUT",
        body: JSON.stringify({ detail: entered.trim().length === 0 ? null : entered.trim() }),
      });
      await load();
    }, entered.trim().length === 0 ? "Your meeting detail was withdrawn." : "Your meeting detail was shared with the other participant.");
  }

  async function rate(requestId: string, name: string) {
    const entered = window.prompt(
      `Rate ${name} from 1 to 5. Add a short comment after a space, e.g. "5 Punctual and careful". A rating cannot be changed or withdrawn once sent — use a safety report if something went wrong.`,
      "5 ",
    );
    if (entered === null) return;
    const trimmed = entered.trim();
    const first = trimmed.slice(0, 1);
    if (!/^[1-5]$/.test(first)) {
      window.alert("Enter a score from 1 to 5, optionally followed by a comment.");
      return;
    }
    const comment = trimmed.slice(1).trim();
    await perform(async () => {
      await apiIdempotent(`/api/rides/${requestId}/rating`, {
        method: "POST",
        body: JSON.stringify({ score: Number(first), comment: comment.length === 0 ? null : comment }),
      });
      setRated((current) => new Set(current).add(requestId));
      await load();
    }, `Thanks — your rating of ${name} was recorded.`);
  }

  const isDriver = role === "DRIVER";

  return (
    <>
      <PageHeader
        title={isDriver ? "Seat requests" : "Your requests"}
        description="A rider is not confirmed until the driver accepts. Meeting details are shared only while a seat is confirmed."
      />

      <Panel>
        {requests.length === 0
          ? <EmptyState loaded={loaded} message={isDriver ? "No seat requests yet." : "You have not requested a seat yet."} />
          : requests.map((request) => {
            const mine = isDriver ? request.driverConfirmedCompletion : request.riderConfirmedCompletion;
            const identity = identities[request.requestId];
            const theirDetail = isDriver ? request.riderMeetingDetail : request.driverMeetingDetail;
            const myDetail = isDriver ? request.driverMeetingDetail : request.riderMeetingDetail;
            return (
              <Item
                key={request.requestId}
                actions={
                  <>
                    {request.status === "REQUESTED" && isDriver && !request.departurePassed && (
                      <>
                        <Button onClick={() => void act(request.requestId, "accept")}>Accept</Button>
                        <Button variant="secondary" onClick={() => void act(request.requestId, "reject")}>Decline</Button>
                      </>
                    )}
                    {["REQUESTED", "ACCEPTED"].includes(request.status) && !isDriver && !request.awaitingCompletion && (
                      <Button variant="secondary" onClick={() => void act(request.requestId, "cancel")}>Cancel request</Button>
                    )}
                    {request.awaitingCompletion && request.status === "ACCEPTED" && !mine && (
                      <Button onClick={() => void confirmCompletion(request.requestId)}>Confirm trip happened</Button>
                    )}
                    {request.awaitingCompletion && request.status === "ACCEPTED" && (
                      <Button variant="secondary" onClick={() => void dispute(request.requestId)}>Report a problem</Button>
                    )}
                    {request.status === "ACCEPTED" && (
                      <Button variant="secondary" onClick={() => void meetingDetail(request.requestId, myDetail)}>
                        {myDetail ? "Change meeting detail" : "Share meeting point"}
                      </Button>
                    )}
                    {request.status === "COMPLETED" && !rated.has(request.requestId) && (
                      <Button onClick={() => void rate(request.requestId, request.otherParticipantName)}>Rate {request.otherParticipantName}</Button>
                    )}
                  </>
                }
              >
                <strong>{request.originArea} → {request.destinationArea}</strong>
                <p className="muted">
                  {request.tripDate} at {request.departureTime} · {request.otherParticipantName} · {request.status.toLowerCase()}
                  {request.status === "DISPUTED" ? " — awaiting operator review" : ""}
                </p>

                {request.disputeResolved && (
                  <InlineMessage>A staff member reviewed the reported issue and recorded this trip as {request.status === "COMPLETED" ? "completed" : "not completed"}.</InlineMessage>
                )}
                {request.status === "CANCELLED" && request.tripStatus === "CANCELLED" && !isDriver && (
                  <InlineMessage>The driver cancelled this trip, so your seat request was withdrawn.</InlineMessage>
                )}
                {request.awaitingCompletion && request.status === "ACCEPTED" && (
                  <InlineMessage>
                    {request.riderConfirmedCompletion && request.driverConfirmedCompletion
                      ? "Both sides confirmed."
                      : mine
                        ? "You confirmed this trip. Waiting for the other participant."
                        : "This trip has departed. Confirm it happened, or report a problem."}
                  </InlineMessage>
                )}
                {request.status === "REQUESTED" && request.departurePassed && (
                  <InlineMessage tone="warn">This trip departed before the seat was accepted, so the request can no longer be actioned and will be closed.</InlineMessage>
                )}
                {request.status === "COMPLETED" && rated.has(request.requestId) && <InlineMessage>You rated this trip.</InlineMessage>}

                {request.status === "ACCEPTED" && identity && (
                  <InlineMessage>
                    <strong>{request.otherParticipantName}&apos;s phone:</strong>{" "}
                    {identity.phone ? `${identity.phone}${identity.phoneVerified ? " (verified)" : " (unverified)"}` : "not provided"}
                    {identity.vehicle && <> · <strong>Vehicle:</strong> {identity.vehicle.colour} {identity.vehicle.make} {identity.vehicle.model} · {identity.vehicle.plate}</>}
                    {" · "}
                    <strong>Rating:</strong>{" "}
                    {identity.rating.average !== null
                      ? `${identity.rating.average}/5 from ${identity.rating.count}`
                      : identity.rating.count > 0 ? `${identity.rating.count} rating(s) — no score shown until there are more` : "none yet"}
                  </InlineMessage>
                )}

                {request.status === "ACCEPTED" && (
                  <InlineMessage>
                    {theirDetail
                      ? <><strong>{request.otherParticipantName}&apos;s meeting detail:</strong> {theirDetail}</>
                      : <>{request.otherParticipantName} has not shared a meeting detail yet.</>}
                    {myDetail && <> · You shared: {myDetail}</>}
                  </InlineMessage>
                )}
              </Item>
            );
          })}
      </Panel>
    </>
  );
}
