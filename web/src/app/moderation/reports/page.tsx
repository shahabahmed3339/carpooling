import { Suspense } from "react";
import { redirect } from "next/navigation";
import { getPilotAccessState } from "@/server/auth/actor";
import ModerationReportsClient from "./reports-client";

export default function ModerationReportsPage() {
  return <Suspense fallback={<main><p>Loading safety reports…</p></main>}><ModerationReportsContent /></Suspense>;
}

async function ModerationReportsContent() {
  const access = await getPilotAccessState();
  if (access.status === "AUTH_DISABLED" || access.status === "SIGNED_OUT") redirect("/login");
  if (access.status !== "ACTIVE") redirect("/auth/complete");
  return <ModerationReportsClient accountId={access.actor.userId} />;
}
