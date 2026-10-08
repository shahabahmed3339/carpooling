"use client";

import { FormEvent, useState } from "react";
import { authClient } from "@/lib/auth-client";
import styles from "./login.module.css";

export default function LoginForm({
  enabled,
  localDevelopment,
}: {
  enabled: boolean;
  localDevelopment: boolean;
}) {
  const [email, setEmail] = useState("");
  const [name, setName] = useState("");
  const [participantRole, setParticipantRole] = useState<"RIDER" | "DRIVER">("RIDER");
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setMessage("");
    if (!enabled) return;
    if (!name.trim()) {
      setMessage("Enter the name other carpool users will see.");
      return;
    }

    setBusy(true);
    try {
      const result = await authClient.signIn.magicLink({
        email: email.trim().toLowerCase(),
        name: name.trim(),
        callbackURL: `/auth/complete?role=${participantRole}`,
        newUserCallbackURL: `/auth/complete?role=${participantRole}`,
        errorCallbackURL: "/auth/complete",
      });
      if (result.error) throw new Error("Sign-in link request failed.");
      setMessage(localDevelopment
        ? "A one-time sign-in link was printed in the development server terminal."
        : "If the address is valid, a one-time sign-in link will arrive shortly. Check your inbox.");
    } catch {
      setMessage("We couldn’t send a sign-in link right now. Please try again later.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className={styles.form} onSubmit={submit}>
      <label>
        <span>Your name</span>
        <input
          autoComplete="name"
          maxLength={80}
          minLength={1}
          name="name"
          onChange={(event) => setName(event.target.value)}
          required
          value={name}
        />
      </label>
      <label>
        <span>Starting dashboard</span>
        <select
          name="participantRole"
          onChange={(event) => setParticipantRole(event.target.value as "RIDER" | "DRIVER")}
          value={participantRole}
        >
          <option value="RIDER">Rider — find a ride</option>
          <option value="DRIVER">Driver — offer seats</option>
        </select>
      </label>
      <label>
        <span>Email address</span>
        <input
          autoComplete="email"
          maxLength={254}
          name="email"
          onChange={(event) => setEmail(event.target.value)}
          required
          type="email"
          value={email}
        />
      </label>
      <button disabled={!enabled || busy} type="submit">
        {!enabled ? "Sign-in setup pending" : busy ? "Sending link…" : "Continue with email"}
      </button>
      {message && <p className={styles.message} role="status">{message}</p>}
      {!enabled && <p className={styles.message} role="status">Authentication is disabled. Configure sign-in before creating accounts.</p>}
    </form>
  );
}
