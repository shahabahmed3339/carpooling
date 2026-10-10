"use client";

/**
 * Ratings this account has received, plus its own aggregate.
 *
 * Separate from Activity because it answers a different question — "how am I
 * regarded?" rather than "what happened?" — and because the aggregate needs room
 * for the caveat that a score below the threshold is not shown.
 */

import { useCallback, useEffect, useState } from "react";
import { useDashboard } from "@/components/dashboard/dashboard-context";
import { EmptyState, Item, PageHeader, Panel, Stat } from "@/components/dashboard/ui";
import styles from "@/components/dashboard/ui.module.css";
import type { ReceivedRating } from "@/components/dashboard/types";

export default function RatingsPage() {
  const { api, profile } = useDashboard();
  const [ratings, setRatings] = useState<ReceivedRating[]>([]);
  const [loaded, setLoaded] = useState(false);

  const load = useCallback(async () => {
    try {
      const result = await api.accountApi<{ ratings: ReceivedRating[] }>("/api/ratings");
      setRatings(result.ratings);
    } finally {
      setLoaded(true);
    }
  }, [api]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void load(); }, 0);
    return () => window.clearTimeout(timer);
  }, [load]);

  const average = ratings.length >= 3 ? Math.round((ratings.reduce((sum, r) => sum + r.score, 0) / ratings.length) * 10) / 10 : null;

  return (
    <>
      <PageHeader
        title="Ratings"
        description="Written by the other participant after a completed trip. Ratings cannot be changed or withdrawn once sent, and nothing here suspends an account automatically — a pattern is a matter for a human reviewer."
      />

      <Panel title="Your reputation">
        <div className={styles.statGrid}>
          <Stat
            label="Average"
            value={average !== null ? average : "—"}
            hint={average === null ? "Shown from 3 ratings onward" : `From ${ratings.length} ratings`}
          />
          <Stat label="Ratings received" value={ratings.length} />
          <Stat label="Display name" value={profile?.displayName ?? "—"} hint={profile?.phoneVerified ? "Phone verified" : "Phone unverified"} />
        </div>
        {ratings.length > 0 && ratings.length < 3 && (
          <p className="muted" style={{ marginTop: 12 }}>
            Your average is not displayed yet: one or two ratings is not enough to be a reputation, and showing a score
            from a single opinion would overstate it.
          </p>
        )}
      </Panel>

      <Panel title="What people said">
        {ratings.length === 0
          ? <EmptyState loaded={loaded} message="No ratings yet. They appear after you complete a trip." />
          : ratings.map((rating) => (
            <Item key={rating.ratingId}>
              <strong>{rating.score} / 5 · {rating.authorName}</strong>
              <p className="muted">{rating.comment ?? "No comment."}</p>
              <p className="muted">{new Date(rating.createdAt).toLocaleString()}</p>
            </Item>
          ))}
      </Panel>
    </>
  );
}
