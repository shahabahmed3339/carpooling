-- Enforce the invariant that COMPLETED means both sides confirmed.
--
-- A request is supposed to become COMPLETED only when the rider and the driver
-- each confirmed the trip happened. The existing CHECK only required
-- `accepted_at IS NOT NULL`, so a COMPLETED row could carry just one
-- confirmation flag — and two such rows already existed. Application code cannot
-- be the only guard here: a bug or a direct write would silently produce a
-- "completed" trip that one participant never agreed happened, which is exactly
-- the fact a dispute turns on.
--
-- Order matters. The constraint cannot be added while violating rows exist, so
-- they are corrected first.

-- 1. Correct the rows that violate the invariant.
--
-- A COMPLETED request with a missing confirmation is not "completed": only one
-- side confirmed. The honest correction is the state a one-sided confirmation
-- should have reached (EXPIRED, with the confirmations that were actually
-- recorded left intact), not to invent a confirmation nobody gave. Only rows
-- whose flags genuinely lack a confirmation are touched, and `completed_at` is
-- cleared so the row does not claim a completion that did not occur.
UPDATE ride_requests
   SET status = 'EXPIRED',
       completed_at = NULL,
       updated_at = now()
 WHERE status = 'COMPLETED'
   AND (rider_confirmed_completion = false OR driver_confirmed_completion = false);

-- 2. Now the invariant holds, so it can be enforced by the database.
--
-- Deliberately worded to constrain only COMPLETED: other statuses may legitimately
-- carry any combination of flags (a request can be disputed after one side
-- confirmed, for example).
ALTER TABLE ride_requests
  ADD CONSTRAINT ride_requests_completed_requires_both_confirmations
  CHECK (
    status <> 'COMPLETED'
    OR (rider_confirmed_completion = true AND driver_confirmed_completion = true AND completed_at IS NOT NULL)
  );
