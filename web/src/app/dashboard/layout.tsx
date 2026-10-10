import { Suspense, type ReactNode } from "react";
import { redirect } from "next/navigation";
import { getPilotAccessState } from "@/server/auth/actor";
import { AppShell } from "@/components/dashboard/app-shell";
import { DashboardProvider } from "@/components/dashboard/dashboard-context";

/**
 * The authenticated dashboard shell.
 *
 * The access check runs here, once, for every page under /dashboard — so a new
 * page cannot be added without it, which is the failure a per-page check invites.
 * Server-side, so an unauthenticated request never receives dashboard markup.
 */
export default function DashboardLayout({ children }: { children: ReactNode }) {
  return (
    <Suspense fallback={<main><p>Loading your dashboard…</p></main>}>
      <Authenticated>{children}</Authenticated>
    </Suspense>
  );
}

async function Authenticated({ children }: { children: ReactNode }) {
  const access = await getPilotAccessState();
  if (access.status === "AUTH_DISABLED" || access.status === "SIGNED_OUT") redirect("/login");
  if (access.status !== "ACTIVE") redirect("/auth/complete");

  return (
    <DashboardProvider
      initialMode={access.actor.participantRole}
      accountEmail={access.actor.email}
      accountId={access.actor.userId}
    >
      <AppShell>{children}</AppShell>
    </DashboardProvider>
  );
}
