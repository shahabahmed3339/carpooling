"use client";

/**
 * Rider: find a published trip and request a seat.
 *
 * Given its own page so a rider's main task is one navigation away rather than
 * somewhere below a driver's form.
 */

import { useState, type FormEvent } from "react";
import { useDashboard } from "@/components/dashboard/dashboard-context";
import { Button, EmptyState, Field, Form, InlineMessage, Item, PageHeader, Panel } from "@/components/dashboard/ui";
import type { Candidate, RideRequest } from "@/components/dashboard/types";

export default function SearchPage() {
  const { api, apiIdempotent, role, perform } = useDashboard();
  const [originArea, setOriginArea] = useState("");
  const [destinationArea, setDestinationArea] = useState("");
  const [tripDate, setTripDate] = useState("");
  const [departureTime, setDepartureTime] = useState("08:10");
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [requests, setRequests] = useState<RideRequest[]>([]);
  const [searched, setSearched] = useState(false);

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await perform(async () => {
      const [result, requestResult] = await Promise.all([
        api.accountApi<{ candidates: Candidate[] }>("/api/commutes/search", {
          method: "POST",
          body: JSON.stringify({ originArea, destinationArea, tripDate, desiredDeparture: departureTime }),
        }),
        api.accountApi<{ requests: RideRequest[] }>("/api/rides"),
      ]);
      setCandidates(result.candidates);
      setRequests(requestResult.requests);
      setSearched(true);
    }, "Search complete.");
  }

  async function requestSeat(candidate: Candidate) {
    await perform(async () => {
      await apiIdempotent("/api/rides", {
        method: "POST",
        body: JSON.stringify({ tripOccurrenceId: candidate.tripOccurrenceId }),
      });
      const requestResult = await api.accountApi<{ requests: RideRequest[] }>("/api/rides");
      setRequests(requestResult.requests);
    }, "Seat request sent to the driver.");
  }

  async function blockUser(userId: string, displayName: string) {
    if (!window.confirm(`Block ${displayName}? They will no longer appear in future matches, but existing trips and requests will remain.`)) return;
    await perform(async () => {
      await api.accountApi("/api/blocks", { method: "POST", body: JSON.stringify({ userId, blocked: true }) });
      setCandidates((current) => current.filter((candidate) => candidate.memberId !== userId));
    }, `${displayName} was blocked.`);
  }

  if (role !== "RIDER") {
    return (
      <>
        <PageHeader title="Find a ride" description="Searching is for riders." />
        <Panel><p className="muted">You are in Driver mode. Switch to Rider in the header to search for a seat.</p></Panel>
      </>
    );
  }

  const hasRequestFor = (candidate: Candidate) =>
    requests.some((request) => request.tripOccurrenceId === candidate.tripOccurrenceId && ["REQUESTED", "ACCEPTED"].includes(request.status));

  return (
    <>
      <PageHeader title="Find a ride" description="Search published trips by area and time. A request is not a confirmed seat until the driver accepts it." />

      <Panel title="Search">
        <Form onSubmit={search}>
          <Field label="Pickup area">
            <input required maxLength={120} value={originArea} onChange={(event) => setOriginArea(event.target.value)} placeholder="e.g. Rana Town" />
          </Field>
          <Field label="Destination area">
            <input required maxLength={120} value={destinationArea} onChange={(event) => setDestinationArea(event.target.value)} placeholder="e.g. MAO College" />
          </Field>
          <Field label="Date">
            <input required min={new Date().toLocaleDateString("en-CA")} type="date" value={tripDate} onChange={(event) => setTripDate(event.target.value)} />
          </Field>
          <Field label="Departure time" hint="Results within about 20 minutes of this time.">
            <input required type="time" value={departureTime} onChange={(event) => setDepartureTime(event.target.value)} />
          </Field>
          <Button>Search</Button>
        </Form>
      </Panel>

      <Panel title="Matching trips">
        {!searched
          ? <p className="muted">Search to see available trips.</p>
          : candidates.length === 0
            ? <EmptyState loaded message="No matching trips found. Try another date or area." />
            : candidates.map((candidate) => (
              <Item
                key={candidate.tripOccurrenceId}
                actions={
                  <>
                    <Button disabled={hasRequestFor(candidate)} onClick={() => void requestSeat(candidate)}>
                      {hasRequestFor(candidate) ? "Already requested" : "Request seat"}
                    </Button>
                    <Button variant="secondary" onClick={() => void blockUser(candidate.memberId, candidate.displayName)}>Block</Button>
                  </>
                }
              >
                <strong>{candidate.originArea} → {candidate.destinationArea}</strong>
                <p className="muted">
                  {candidate.displayName} · {candidate.departureTime} · {candidate.availableSeats} seat(s)
                  {candidate.contributionNote ? ` · Cost sharing: ${candidate.contributionNote}` : ""}
                </p>
                {(candidate.originMatch === "PROXIMITY" || candidate.destinationMatch === "PROXIMITY") && (
                  <InlineMessage tone="warn">
                    Near your {candidate.originMatch === "PROXIMITY" && candidate.destinationMatch === "PROXIMITY"
                      ? "pickup and destination areas"
                      : candidate.originMatch === "PROXIMITY" ? "pickup area" : "destination area"}, but not an exact name match.
                    Confirm the meeting point with the driver before travelling.
                  </InlineMessage>
                )}
              </Item>
            ))}
      </Panel>
    </>
  );
}
