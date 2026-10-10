-- Ratings after a completed trip. `RIDE_HAILING_ROADMAP.md` Phase 1b.
--
-- A carpool between people who know each other needs no reputation. A hailing
-- product does: a rider is deciding whether to get into a stranger's car, and a
-- driver is deciding whether to accept a stranger. Ratings are the cheapest honest
-- signal for that.
--
-- Design rules, chosen to keep the signal trustworthy rather than to maximise
-- engagement:
--
--   1. **Only a COMPLETED request can be rated.** Rating a ride that was cancelled
--      or never happened would let either side score the other over a
--      non-event. Enforced by the service; the column is only reachable through it.
--   2. **One rating per side per request**, enforced by a unique constraint, so
--      neither party can inflate or bury a counterpart by rating repeatedly.
--   3. **Immutable.** There is no UPDATE path: a rating that can be edited after
--      the other side rates is a negotiation, not a record. A wrong rating is
--      handled by the safety-report path, which a human reviews.
--   4. **No automatic consequence.** Nothing in the app suspends, warns or
--      down-ranks on the basis of this table. Deciding what a pattern should
--      trigger is a fairness decision and is explicitly left to the owner
--      (roadmap §4). Storing the data is not the same as acting on it.
--
-- A rating is about a *ride*, not a person, so it hangs off the request rather
-- than the user. Two people who had one bad trip and nine good ones should read
-- as nine good ones; that only works if every rating knows which ride it judges.

CREATE TABLE trip_ratings (
  id uuid PRIMARY KEY,
  community_id uuid NOT NULL REFERENCES communities (id),
  ride_request_id uuid NOT NULL REFERENCES ride_requests (id) ON DELETE CASCADE,
  -- Who wrote it and who it is about. Both are needed: the aggregate is by
  -- subject, and the "already rated" check is by (request, author).
  author_user_id uuid NOT NULL REFERENCES users (id),
  subject_user_id uuid NOT NULL REFERENCES users (id),
  score integer NOT NULL,
  comment text,
  created_at timestamptz NOT NULL DEFAULT now(),

  -- A five-point scale. Zero and negative scores are excluded so an average is
  -- always meaningful and cannot be skewed by an out-of-range value.
  CONSTRAINT trip_ratings_score_range CHECK (score BETWEEN 1 AND 5),
  -- A comment is optional free text; bounded like every other free-text field.
  CONSTRAINT trip_ratings_comment_length CHECK (comment IS NULL OR length(btrim(comment)) BETWEEN 1 AND 500),
  -- Nobody rates themselves. A self-rating would corrupt an average silently.
  CONSTRAINT trip_ratings_no_self_rating CHECK (author_user_id <> subject_user_id)
);

-- One rating per author per ride. This is the constraint that makes the signal
-- countable: without it, a single participant could submit many rows for one trip.
CREATE UNIQUE INDEX trip_ratings_one_per_author_per_request
  ON trip_ratings (ride_request_id, author_user_id);

-- The read path is "this person's ratings", newest first, bounded.
CREATE INDEX trip_ratings_subject_idx ON trip_ratings (subject_user_id, created_at DESC);

-- Immutability, enforced in the database rather than by convention: a stray
-- UPDATE anywhere in the codebase (or a future endpoint) cannot rewrite history.
--
-- Deletion needs care. A rating must not be *edited or withdrawn*, but it also
-- must not block the legitimate removal of the ride it describes: account closure
-- and `db:prune-history` delete `ride_requests`, and the FK cascade would fire a
-- plain BEFORE DELETE trigger and fail. The function therefore blocks a direct
-- delete while permitting a cascade, which PostgreSQL signals by setting
-- `pg_trigger_depth() > 1` (the cascade runs inside the parent delete's trigger
-- context).
--
-- This first version was incomplete: it also blocked account closure, which
-- deletes `users` directly rather than through a ride cascade. Migration `0031`
-- replaces it with the erasure flag. This file is left as applied rather than
-- edited in place, so the migration ledger stays honest.
CREATE FUNCTION trip_ratings_are_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'DELETE' AND pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;
  RAISE EXCEPTION 'trip ratings are immutable: they cannot be updated or withdrawn';
END;
$$;

CREATE TRIGGER trip_ratings_no_update
  BEFORE UPDATE ON trip_ratings
  FOR EACH ROW
  EXECUTE FUNCTION trip_ratings_are_immutable();

CREATE TRIGGER trip_ratings_no_delete
  BEFORE DELETE ON trip_ratings
  FOR EACH ROW
  EXECUTE FUNCTION trip_ratings_are_immutable();
