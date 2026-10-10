"use client";

/**
 * Driver: the weekly commute and the dates published from it.
 *
 * Its own page because this is a driver's main working surface, and because it
 * was previously buried under forms a rider never uses.
 */

import { useCallback, useEffect, useState, type FormEvent } from "react";
import { useDashboard } from "@/components/dashboard/dashboard-context";
import { Button, EmptyState, Field, Form, InlineMessage, Item, PageHeader, Panel } from "@/components/dashboard/ui";
import { WEEKDAYS, weekdayForDate, type Commute, type DriverTrip } from "@/components/dashboard/types";

export default function TripsPage() {
  const { api, apiIdempotent, role, perform } = useDashboard();
  const [commutes, setCommutes] = useState<Commute[]>([]);
  const [trips, setTrips] = useState<DriverTrip[]>([]);
  const [loaded, setLoaded] = useState(false);

  const [originArea, setOriginArea] = useState("");
  const [destinationArea, setDestinationArea] = useState("");
  const [departureStart, setDepartureStart] = useState("08:00");
  const [departureEnd, setDepartureEnd] = useState("08:20");
  const [selectedDays, setSelectedDays] = useState<number[]>([1, 2, 3, 4, 5]);
  const [seats, setSeats] = useState(1);
  const [contributionNote, setContributionNote] = useState("");
  const [editing, setEditing] = useState<{ id: string; version: number } | null>(null);
  const [tripDate, setTripDate] = useState("");

  const load = useCallback(async () => {
    try {
      const [commuteResult, tripResult] = await Promise.all([
        api.accountApi<{ commutes: Commute[] }>("/api/commutes"),
        api.accountApi<{ trips: DriverTrip[] }>("/api/trips"),
      ]);
      setCommutes(commuteResult.commutes);
      setTrips(tripResult.trips);
    } finally {
      setLoaded(true);
    }
  }, [api]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  function resetForm() {
    setOriginArea("");
    setDestinationArea("");
    setDepartureStart("08:00");
    setDepartureEnd("08:20");
    setSelectedDays([1, 2, 3, 4, 5]);
    setSeats(1);
    setContributionNote("");
    setEditing(null);
  }

  async function saveCommute(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await perform(async () => {
      await apiIdempotent("/api/commutes", {
        method: "POST",
        body: JSON.stringify({
          originArea,
          destinationArea,
          departureWindowStart: departureStart,
          departureWindowEnd: departureEnd,
          weekdays: selectedDays,
          role: "OFFERING",
          seatsOffered: seats,
          contributionNote: contributionNote.trim().length === 0 ? null : contributionNote.trim(),
          ...(editing ? { expectedVersion: editing.version } : {}),
        }),
      });
      resetForm();
      await load();
    }, editing ? "Commute updated. Existing published trips are unchanged." : "Commute saved.");
  }

  async function publishTrip(commuteId: string, date: string) {
    await perform(async () => {
      await apiIdempotent("/api/trips", { method: "POST", body: JSON.stringify({ commuteTemplateId: commuteId, tripDate: date }) });
      await load();
    }, "Dated trip published.");
  }

  async function cancelTrip(trip: DriverTrip) {
    if (!window.confirm("Cancel this trip? Pending and accepted seat requests will also be withdrawn.")) return;
    await perform(async () => {
      await apiIdempotent(`/api/trips/${trip.tripOccurrenceId}`, { method: "DELETE" });
      await load();
    }, "Trip cancelled. Active seat requests were withdrawn.");
  }

  function beginEdit(commute: Commute) {
    setEditing({ id: commute.id, version: commute.version });
    setOriginArea(commute.originArea);
    setDestinationArea(commute.destinationArea);
    setDepartureStart(commute.departureWindowStart);
    setDepartureEnd(commute.departureWindowEnd);
    setSelectedDays(commute.weekdays);
    setSeats(commute.seatsOffered);
    setContributionNote(commute.contributionNote ?? "");
    window.scrollTo({ top: 0, behavior: "smooth" });
  }

  if (role !== "DRIVER") {
    return (
      <>
        <PageHeader title="My commute & trips" description="This page manages the dates you drive." />
        <Panel>
          <p className="muted">You are in Rider mode. Switch to Driver in the header to publish trips.</p>
        </Panel>
      </>
    );
  }

  return (
    <>
      <PageHeader
        title="My commute & trips"
        description="Add your regular commute once, then publish each specific date you can offer a seat. Publishing is per-date; your usual days only limit which dates are selectable."
      />

      <Panel title={editing ? "Edit your regular commute" : "Add a regular commute"} description="Changes apply to dates you publish in the future. Already published trips keep their details.">
        <Form onSubmit={saveCommute}>
          <Field label="Pickup area">
            <input required maxLength={120} value={originArea} onChange={(event) => setOriginArea(event.target.value)} placeholder="e.g. Muridke" />
          </Field>
          <Field label="Destination area">
            <input required maxLength={120} value={destinationArea} onChange={(event) => setDestinationArea(event.target.value)} placeholder="e.g. Model Town Lahore" />
          </Field>
          <Field label="Departure from">
            <input required type="time" value={departureStart} onChange={(event) => setDepartureStart(event.target.value)} />
          </Field>
          <Field label="Departure until">
            <input required type="time" value={departureEnd} onChange={(event) => setDepartureEnd(event.target.value)} />
          </Field>
          <fieldset style={{ border: 0, padding: 0, margin: 0 }}>
            <legend className="muted">Days you usually travel</legend>
            <div style={{ display: "flex", gap: 12, flexWrap: "wrap" }}>
              {WEEKDAYS.map((day, index) => (
                <label key={day} style={{ fontSize: "0.85rem", display: "flex", gap: 5, alignItems: "center" }}>
                  <input
                    type="checkbox"
                    checked={selectedDays.includes(index)}
                    onChange={() => setSelectedDays((current) => current.includes(index) ? current.filter((value) => value !== index) : [...current, index].sort())}
                  />
                  {day}
                </label>
              ))}
            </div>
          </fieldset>
          <Field label="Seats to offer">
            <input required min={1} max={8} type="number" value={seats} onChange={(event) => setSeats(Number(event.target.value))} />
          </Field>
          <Field label="Cost sharing note (optional)" hint="Display only. The app does not collect or transfer any payment.">
            <input maxLength={160} value={contributionNote} onChange={(event) => setContributionNote(event.target.value)} placeholder="e.g. Share fuel cost" />
          </Field>
          <div style={{ display: "flex", gap: 8 }}>
            <Button disabled={selectedDays.length === 0}>{editing ? "Save changes" : "Save commute"}</Button>
            {editing && <Button type="button" variant="secondary" onClick={resetForm}>Stop editing</Button>}
          </div>
        </Form>
      </Panel>

      <Panel title="Publish a dated trip" description="Your usual travel days only limit which dates are available; they do not publish trips automatically.">
        {commutes.length === 0
          ? <EmptyState loaded={loaded} message="Save a commute first, then publish a particular future date." />
          : commutes.map((commute) => (
            <Item
              key={commute.id}
              actions={
                <>
                  <Button variant="secondary" onClick={() => beginEdit(commute)}>Edit commute</Button>
                  <input
                    aria-label="Trip date"
                    min={new Date().toLocaleDateString("en-CA")}
                    type="date"
                    value={tripDate}
                    style={{ width: "auto" }}
                    onChange={(event) => setTripDate(event.target.value)}
                  />
                  <Button
                    disabled={!tripDate || !commute.weekdays.includes(weekdayForDate(tripDate) ?? -1)}
                    onClick={() => void publishTrip(commute.id, tripDate)}
                  >
                    Publish date
                  </Button>
                </>
              }
            >
              <strong>{commute.originArea} → {commute.destinationArea}</strong>
              <p className="muted">
                {commute.departureWindowStart} · {commute.seatsOffered} seat(s) · Usually:{" "}
                {commute.weekdays.map((day) => WEEKDAYS[day]).join(", ")}
                {commute.contributionNote ? ` · Cost sharing: ${commute.contributionNote}` : ""}
              </p>
              {tripDate && !commute.weekdays.includes(weekdayForDate(tripDate) ?? -1) && (
                <InlineMessage tone="warn">Choose one of this commute&apos;s usual travel days.</InlineMessage>
              )}
            </Item>
          ))}
      </Panel>

      <Panel title="Your published trips">
        {trips.length === 0
          ? <EmptyState loaded={loaded} message="No upcoming trips published yet." />
          : trips.map((trip) => (
            <Item key={trip.tripOccurrenceId} actions={trip.canCancel ? <Button variant="danger" onClick={() => void cancelTrip(trip)}>Cancel trip</Button> : undefined}>
              <strong>{trip.originArea} → {trip.destinationArea}</strong>
              <p className="muted">
                {trip.tripDate} at {trip.departureTime} · {trip.status.toLowerCase()} · {trip.seatsReserved}/{trip.seatCapacity} seats requested
                {trip.contributionNote ? ` · Cost sharing: ${trip.contributionNote}` : ""}
              </p>
            </Item>
          ))}
      </Panel>
    </>
  );
}
