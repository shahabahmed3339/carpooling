import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getPilotAccessState } from "@/server/auth/actor";
import DashboardClient from "./dashboard-client";

export default function DashboardPage() {
  return <Suspense fallback={<main><p>Loading your commute dashboard…</p></main>}><DashboardContent /></Suspense>;
}

async function DashboardContent() {
  const access = await getPilotAccessState();
  if (access.status === "AUTH_DISABLED" || access.status === "SIGNED_OUT") redirect("/login");
  if (access.status !== "ACTIVE") redirect("/auth/complete");
  return <DashboardClient initialMode={access.actor.participantRole} />;
}
