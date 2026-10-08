"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { authClient } from "@/lib/auth-client";
import styles from "../../login/login.module.css";

export default function SignOutButton() {
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);
  const router = useRouter();

  async function signOut() {
    setBusy(true);
    setFailed(false);
    try {
      await authClient.signOut();
      router.replace("/login");
    } catch {
      setFailed(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <span>
      <button className={styles.secondaryAction} disabled={busy} onClick={signOut} type="button">
        {busy ? "Signing out…" : "Sign out"}
      </button>
      {failed && <span className={styles.message} role="alert">Sign out failed. Please reload and try again.</span>}
    </span>
  );
}
