-- Fix: the rating immutability trigger blocked account closure.
--
-- Migration 0030 blocked every direct DELETE on `trip_ratings`, intending to stop
-- a user withdrawing a rating they regretted. That is the right rule for a user,
-- and the wrong one for the system: `deleteOwnAccount` removes the `users` row,
-- and the ratings that reference that person must go with it. Blocking them would
-- leave a closed account's display name attached to ratings through the author
-- join — directly contradicting the closure promise that identifying data is
-- erased.
--
-- The rule now distinguishes three cases (see the function body): an UPDATE is
-- always refused; a nested delete (a ride being removed, e.g. by
-- `db:prune-history`) is allowed; and an explicit erasure transaction sets
-- `SET LOCAL app.allow_rating_erasure = 'on'` to allow a direct delete. The flag is
-- deliberately explicit rather than inferred, so every place permitted to erase a
-- rating is findable by searching for it.

CREATE OR REPLACE FUNCTION trip_ratings_are_immutable()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF TG_OP = 'UPDATE' THEN
    RAISE EXCEPTION 'trip ratings are immutable: they cannot be changed once submitted';
  END IF;

  -- A nested delete is a ride (or a user) being removed with its ratings.
  IF pg_trigger_depth() > 1 THEN
    RETURN OLD;
  END IF;

  -- Opt-in erasure, set by account closure in its own transaction.
  IF current_setting('app.allow_rating_erasure', true) = 'on' THEN
    RETURN OLD;
  END IF;

  RAISE EXCEPTION 'trip ratings cannot be withdrawn; raise a safety report if one is wrong';
END;
$$;
