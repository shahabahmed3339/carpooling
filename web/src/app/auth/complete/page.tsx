import { Suspense } from "react";
import Link from "next/link";
import { getPilotAccessState } from "@/server/auth/actor";
import SignOutButton from "./sign-out";
import SessionChangeBroadcast from "./session-change-broadcast";
import styles from "../../login/login.module.css";

type AuthCompletePageProps = {
  searchParams: Promise<{ role?: string }>;
};

export default function AuthCompletePage(props: AuthCompletePageProps) {
  return (
    <Suspense fallback={<main className={styles.page}><section className={styles.card}><p className={styles.kicker}>CARPOOL PAKISTAN</p><h1>Checking your sign-in…</h1></section></main>}>
      <AuthCompleteContent {...props} />
    </Suspense>
  );
}

async function AuthCompleteContent({
  searchParams,
}: AuthCompletePageProps) {
  const query = await searchParams;
  const signupRole = query.role === "RIDER" || query.role === "DRIVER" ? query.role : undefined;
  const access = await getPilotAccessState(signupRole);
  const content = {
    AUTH_DISABLED: {
      title: "Sign-in is not enabled",
      body: "Authentication has not been enabled for this app.",
    },
    SIGNED_OUT: {
      title: "Sign-in link expired",
      body: "Request a new link and open it on this device.",
    },
    NOT_ELIGIBLE: {
      title: "Account unavailable",
      body: "We couldn’t activate this account. Please request a new sign-in link or contact support.",
    },
    ACTIVE: {
      title: "You’re signed in",
      body: `Your account is ready in ${access.status === "ACTIVE" ? access.actor.participantRole.toLowerCase() : "rider"} mode. You can switch between Rider and Driver from your dashboard.`,
    },
  }[access.status];

  return (
    <main className={styles.page}>
      <section className={styles.card}>
        <p className={styles.kicker}>CARPOOL PAKISTAN</p>
        <h1>{content.title}</h1>
        <p className={styles.description}>{content.body}</p>
        {access.status === "ACTIVE" && <SessionChangeBroadcast accountId={access.actor.userId} />}
        {access.status === "ACTIVE" && <Link className={styles.actionLink} href="/dashboard">Go to your dashboard</Link>}
        {access.status !== "ACTIVE" && <Link className={styles.actionLink} href="/login">Back to sign in</Link>}
        {access.status !== "SIGNED_OUT" && access.status !== "AUTH_DISABLED" && <SignOutButton />}
      </section>
    </main>
  );
}
