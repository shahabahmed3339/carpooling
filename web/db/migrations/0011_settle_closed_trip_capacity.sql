-- Reconcile capacity on trips that were already closed.
--
-- Earlier versions closed a trip (status COMPLETED or CANCELLED) without
-- releasing its reserved seats, so a finished trip could keep holding capacity
-- that belonged to nobody. For CANCELLED trips, cancellation already leaked
-- seats in some paths; for COMPLETED trips the seats were simply never settled.
--
-- A closed trip accepts no new requests, so seats_reserved on it is meaningless
-- and must be zero. This backfills existing rows; the application now settles
-- capacity as it closes a trip.

UPDATE trip_occurrences
   SET seats_reserved = 0,
       updated_at = now()
 WHERE status IN ('COMPLETED', 'CANCELLED')
   AND seats_reserved <> 0;
