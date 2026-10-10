"use client";

/**
 * Settings: profile, vehicle, account closure.
 *
 * The destructive action sits last and behind a typed confirmation, as before —
 * on its own page it is now also away from the working surface, which is where it
 * belongs.
 */

import { useState, type FormEvent } from "react";
import { announceAuthSessionChange } from "@/lib/session-change";
import { useDashboard } from "@/components/dashboard/dashboard-context";
import { Button, Field, Form, InlineMessage, PageHeader, Panel } from "@/components/dashboard/ui";

export default function SettingsPage() {
  const { api, role, profile, reloadProfile, perform, busy } = useDashboard();
  const [draft, setDraft] = useState<null | {
    displayName: string;
    phone: string;
    make: string;
    model: string;
    colour: string;
    plate: string;
    seatCapacity: number;
  }>(null);
  const [deleteOpen, setDeleteOpen] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState("");

  // The draft is null until the first edit, and the displayed value is derived from
  // the profile while it is null. That avoids the two alternatives React objects to:
  // mirroring the profile into state from an effect (a cascading render, and it
  // discards typing if the profile refetches), and seeding from a ref during render.
  // Derived-until-edited is also what the user expects: their typing wins.
  const value = draft ?? {
    displayName: profile?.displayName ?? "",
    phone: profile?.phone ?? "",
    make: profile?.vehicle?.make ?? "",
    model: profile?.vehicle?.model ?? "",
    colour: profile?.vehicle?.colour ?? "",
    plate: profile?.vehicle?.plate ?? "",
    seatCapacity: profile?.vehicle?.seatCapacity ?? 4,
  };
  const update = (patch: Partial<typeof value>) => setDraft({ ...value, ...patch });

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    // Send a vehicle only if the driver filled one in. Sending an all-blank block
    // from an empty form would clear a saved car by accident.
    const hasVehicle = [value.make, value.model, value.colour, value.plate].some((field) => field.trim().length > 0);
    await perform(async () => {
      await api.accountApi("/api/profile", {
        method: "PATCH",
        body: JSON.stringify({
          displayName: value.displayName.trim(),
          phone: value.phone.trim().length === 0 ? null : value.phone.trim(),
          ...(hasVehicle
            ? { vehicle: { make: value.make.trim(), model: value.model.trim(), colour: value.colour.trim(), plate: value.plate.trim(), seatCapacity: value.seatCapacity } }
            : {}),
        }),
      });
      await reloadProfile();
      // Drop the local draft so the form shows what the server actually stored,
      // which is how a normalized value (an upper-cased plate) becomes visible.
      setDraft(null);
    }, "Profile saved. Your phone and vehicle are shown only to someone whose seat you have confirmed.");
  }

  async function removeVehicle() {
    await perform(async () => {
      await api.accountApi("/api/profile", { method: "PATCH", body: JSON.stringify({ vehicle: null }) });
      await reloadProfile();
      setDraft(null);
    }, "Vehicle removed.");
  }

  async function closeAccount(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (deleteConfirm !== "DELETE") return;
    await perform(async () => {
      await api.accountApi("/api/account", { method: "DELETE", body: JSON.stringify({ confirm: "DELETE" }) });
      // Closure removes the session, so navigate directly rather than reload.
      announceAuthSessionChange(null);
      window.location.replace("/login");
    }, "Your account was closed.");
  }

  return (
    <>
      <PageHeader
        title="Settings"
        description="Your identity, and the account itself. Riders need to recognise who is coming and which car to look for."
      />

      <Panel title="Profile" description="Your phone and vehicle are shown to the other participant only once a seat is confirmed, never while a request is pending or after it is cancelled.">
        <Form onSubmit={save}>
          <Field label="Display name">
            <input maxLength={80} value={value.displayName} onChange={(event) => update({ displayName: event.target.value })} placeholder="e.g. Ali R." />
          </Field>
          <Field label={`Phone ${profile?.phoneVerified ? "(verified)" : "(not verified)"}`} hint="Stored digits only. Verification by text message is not available yet, so a number is marked unverified.">
            <input inputMode="tel" maxLength={20} value={value.phone} onChange={(event) => update({ phone: event.target.value })} placeholder="e.g. 0300 1234567" />
          </Field>
          {role === "DRIVER" && (
            <>
              <InlineMessage>Vehicle details appear only in Driver mode, and only to a rider whose seat you have accepted.</InlineMessage>
              <Field label="Make"><input maxLength={60} value={value.make} onChange={(event) => update({ make: event.target.value })} placeholder="e.g. Toyota" /></Field>
              <Field label="Model"><input maxLength={60} value={value.model} onChange={(event) => update({ model: event.target.value })} placeholder="e.g. Corolla" /></Field>
              <Field label="Colour"><input maxLength={30} value={value.colour} onChange={(event) => update({ colour: event.target.value })} placeholder="e.g. White" /></Field>
              <Field label="Plate"><input maxLength={20} value={value.plate} onChange={(event) => update({ plate: event.target.value })} placeholder="e.g. LE A-1234" /></Field>
              <Field label="Seats a rider can take">
                <input min={1} max={8} type="number" value={value.seatCapacity} onChange={(event) => update({ seatCapacity: Number(event.target.value) })} />
              </Field>
            </>
          )}
          <div style={{ display: "flex", gap: 8 }}>
            <Button disabled={busy || value.displayName.trim().length === 0}>Save profile</Button>
            {profile?.vehicle && <Button type="button" variant="secondary" disabled={busy} onClick={() => void removeVehicle()}>Remove vehicle</Button>}
          </div>
        </Form>
      </Panel>

      <Panel title="Close your account" description="Closure withdraws your open ride requests and cancels your future trips. Completed trips stay on the other participants' records without your name. You will not be able to sign in again.">
        {!deleteOpen ? (
          <Button variant="danger" onClick={() => { setDeleteOpen(true); setDeleteConfirm(""); }}>Close my account</Button>
        ) : (
          <Form onSubmit={closeAccount}>
            <Field label="Type DELETE to confirm">
              <input autoComplete="off" value={deleteConfirm} onChange={(event) => setDeleteConfirm(event.target.value)} placeholder="DELETE" />
            </Field>
            <div style={{ display: "flex", gap: 8 }}>
              <Button variant="danger" disabled={busy || deleteConfirm !== "DELETE"}>Permanently close account</Button>
              <Button type="button" variant="secondary" disabled={busy} onClick={() => setDeleteOpen(false)}>Keep my account</Button>
            </div>
          </Form>
        )}
      </Panel>
    </>
  );
}
