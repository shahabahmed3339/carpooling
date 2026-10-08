"use client";

import { useEffect } from "react";
import { announceAuthSessionChange } from "@/lib/session-change";

export default function SessionChangeBroadcast({ accountId }: { accountId: string }) {
  useEffect(() => {
    announceAuthSessionChange(accountId);
  }, [accountId]);
  return null;
}
