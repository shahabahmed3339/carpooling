"use client";

import { FormEvent, useCallback, useEffect, useState } from "react";
import SignOutButton from "@/app/auth/complete/sign-out";
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
};
type Candidate = {
  tripOccurrenceId: string;
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
  otherParticipantName: string;
  originArea: string;
  destinationArea: string;
  tripDate: string;
  departureTime: string;
};

const weekdays = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function idempotencyKey(): string {
  return crypto.randomUUID();
}

async function api<T>(url: string, init?: RequestInit): Promise<T> {
  const response = await fetch(url, { ...init, headers: { "Content-Type": "application/json", ...init?.headers } });
  const payload = await response.json().catch(() => ({})) as T & { error?: { message?: string } };
  if (!response.ok) throw new Error(payload.error?.message ?? "Could not complete the request.");
  return payload;
}

export default function DashboardClient({ initialMode }: { initialMode: ParticipantRole }) {
  const [role, setRole] = useState<ParticipantRole>(initialMode);
  const [commutes, setCommutes] = useState<Commute[]>([]);
  const [requests, setRequests] = useState<RideRequest[]>([]);
  const [candidates, setCandidates] = useState<Candidate[]>([]);
  const [originArea, setOriginArea] = useState("");
  const [destinationArea, setDestinationArea] = useState("");
  const [departureStart, setDepartureStart] = useState("08:00");
  const [departureEnd, setDepartureEnd] = useState("08:20");
  const [departureTime, setDepartureTime] = useState("08:10");
  const [tripDate, setTripDate] = useState("");
  const [selectedDays, setSelectedDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [seats, setSeats] = useState(1);
  const [notice, setNotice] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  const reload = useCallback(async () => {
    setError("");
    try {
      const [commuteResult, requestResult] = await Promise.all([
        role === "DRIVER" ? api<{ commutes: Commute[] }>("/api/commutes") : Promise.resolve({ commutes: [] }),
        api<{ requests: RideRequest[] }>("/api/rides"),
      ]);
      setCommutes(commuteResult.commutes);
      setRequests(requestResult.requests);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not load your dashboard.");
    }
  }, [role]);

  useEffect(() => {
    let mounted = true;
    Promise.all([
      role === "DRIVER" ? api<{ commutes: Commute[] }>("/api/commutes") : Promise.resolve({ commutes: [] }),
      api<{ requests: RideRequest[] }>("/api/rides"),
    ]).then(([commuteResult, requestResult]) => {
      if (!mounted) return;
      setCommutes(commuteResult.commutes);
      setRequests(requestResult.requests);
    }).catch((cause: unknown) => {
      if (mounted) setError(cause instanceof Error ? cause.message : "Could not load your dashboard.");
    });
    return () => { mounted = false; };
  }, [role]);

  async function perform(action: () => Promise<void>, success: string) {
    setBusy(true);
    setError("");
    setNotice("");
    try {
      await action();
      setNotice(success);
      await reload();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Could not complete the request.");
    } finally {
      setBusy(false);
    }
  }

  async function addCommute(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await perform(async () => {
      await api("/api/commutes", {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey() },
        body: JSON.stringify({
          originArea,
          destinationArea,
          departureWindowStart: departureStart,
          departureWindowEnd: departureEnd,
          weekdays: selectedDays,
          role: "OFFERING",
          seatsOffered: seats,
        }),
      });
    }, "Commute saved.");
  }

  async function publishTrip(commuteId: string, date: string) {
    await perform(async () => {
      await api("/api/trips", {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey() },
        body: JSON.stringify({ commuteTemplateId: commuteId, tripDate: date }),
      });
    }, "Dated trip published.");
  }

  async function search(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setBusy(true);
    setError("");
    setNotice("");
    try {
      const result = await api<{ candidates: Candidate[] }>("/api/commutes/search", {
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
      await api("/api/rides", {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey() },
        body: JSON.stringify({ tripOccurrenceId: candidate.tripOccurrenceId }),
      });
    }, "Seat request sent to the driver.");
  }

  async function requestAction(requestId: string, action: "accept" | "reject" | "cancel") {
    await perform(async () => {
      await api(`/api/rides/${requestId}/${action}`, {
        method: "POST",
        headers: { "Idempotency-Key": idempotencyKey() },
      });
    }, action === "accept" ? "Seat request accepted." : action === "reject" ? "Seat request declined." : "Your request was cancelled.");
  }

  async function switchMode(nextMode: ParticipantRole) {
    if (nextMode === role) return;
    setBusy(true);
    setError("");
    try {
      await api("/api/profile/mode", {
        method: "PATCH",
        body: JSON.stringify({ mode: nextMode }),
      });
      setRole(nextMode);
      setCandidates([]);
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

  return (
    <main className={styles.page}>
      <header className={styles.header}>
        <div><p className={styles.kicker}>CARPOOL PAKISTAN</p><h1>{role === "RIDER" ? "Find a ride" : "Offer a ride"}</h1></div>
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

      {role === "DRIVER" ? (
        <>
          <section className={styles.panel}>
            <h2>Add a regular commute</h2>
            <p className={styles.muted}>Riders search the exact pickup and destination areas you enter and the date you publish.</p>
            <form className={styles.form} onSubmit={addCommute}>
              <label>Pickup area<input required maxLength={120} value={originArea} onChange={(event) => setOriginArea(event.target.value)} placeholder="e.g. Gulberg" /></label>
              <label>Destination area<input required maxLength={120} value={destinationArea} onChange={(event) => setDestinationArea(event.target.value)} placeholder="e.g. DHA Phase 5" /></label>
              <label>Departure from<input required type="time" value={departureStart} onChange={(event) => setDepartureStart(event.target.value)} /></label>
              <label>Departure until<input required type="time" value={departureEnd} onChange={(event) => setDepartureEnd(event.target.value)} /></label>
              <fieldset><legend>Days you usually travel</legend><div className={styles.days}>{weekdays.map((day, index) => <label key={day}><input type="checkbox" checked={selectedDays.includes(index)} onChange={() => toggleDay(index)} />{day}</label>)}</div></fieldset>
              <label>Seats to offer<input required min={1} max={8} type="number" value={seats} onChange={(event) => setSeats(Number(event.target.value))} /></label>
              <button disabled={busy || selectedDays.length === 0}>Save commute</button>
            </form>
          </section>
          <section className={styles.panel}>
            <h2>Publish a dated trip</h2>
            {commutes.length === 0 ? <p className={styles.muted}>Save a commute first. You can then publish a particular future date.</p> : commutes.map((commute) => (
              <div className={styles.item} key={commute.id}>
                <div><strong>{commute.originArea} → {commute.destinationArea}</strong><p>{commute.departureWindowStart} · {commute.seatsOffered} seat(s)</p></div>
                <div className={styles.inline}><input aria-label="Trip date" min={new Date().toLocaleDateString("en-CA")} type="date" value={tripDate} onChange={(event) => setTripDate(event.target.value)} /><button disabled={busy || !tripDate} onClick={() => void publishTrip(commute.id, tripDate)}>Publish date</button></div>
              </div>
            ))}
          </section>
          <section className={styles.panel}>
            <h2>Seat requests</h2>
            <RequestList requests={requests} role={role} busy={busy} onAction={requestAction} />
          </section>
        </>
      ) : (
        <>
          <section className={styles.panel}>
            <h2>Search a dated trip</h2>
            <p className={styles.muted}>Search with the pickup and destination areas the driver listed and choose a published date.</p>
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
                <button disabled={busy || requests.some((request) => request.tripOccurrenceId === candidate.tripOccurrenceId && ["REQUESTED", "ACCEPTED"].includes(request.status))} onClick={() => void requestSeat(candidate)}>{requests.some((request) => request.tripOccurrenceId === candidate.tripOccurrenceId && ["REQUESTED", "ACCEPTED"].includes(request.status)) ? "Already requested" : "Request seat"}</button>
              </div>
            ))}
          </section>
          <section className={styles.panel}>
            <h2>Your requests</h2>
            <RequestList requests={requests} role={role} busy={busy} onAction={requestAction} />
          </section>
        </>
      )}
      <p className={styles.footnote}>Use approximate areas only. A request is not confirmed until the driver accepts it.</p>
    </main>
  );
}

function RequestList({ requests, role, busy, onAction }: {
  requests: RideRequest[];
  role: ParticipantRole;
  busy: boolean;
  onAction: (requestId: string, action: "accept" | "reject" | "cancel") => Promise<void>;
}) {
  if (requests.length === 0) return <p className={styles.muted}>No requests yet.</p>;
  return <div className={styles.list}>{requests.map((request) => (
    <div className={styles.item} key={request.requestId}>
      <div><strong>{request.originArea} → {request.destinationArea}</strong><p>{request.tripDate} at {request.departureTime} · {request.otherParticipantName} · {request.status.toLowerCase()}</p></div>
      {request.status === "REQUESTED" && role === "DRIVER" && <div className={styles.inline}><button disabled={busy} onClick={() => void onAction(request.requestId, "accept")}>Accept</button><button className={styles.secondary} disabled={busy} onClick={() => void onAction(request.requestId, "reject")}>Decline</button></div>}
      {(["REQUESTED", "ACCEPTED"].includes(request.status)) && role === "RIDER" && <button className={styles.secondary} disabled={busy} onClick={() => void onAction(request.requestId, "cancel")}>Cancel request</button>}
    </div>
  ))}</div>;
}
