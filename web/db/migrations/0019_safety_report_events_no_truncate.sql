-- Extend the append-only guard on safety-report events to cover TRUNCATE.
--
-- 0017 added the row-level UPDATE/DELETE trigger and was already applied before
-- the statement-level truncate guard was written, so the guard ships as this
-- forward migration. TRUNCATE is not covered by row-level triggers, so without
-- this a reviewer history table could still be emptied in one statement.
CREATE TRIGGER safety_report_events_no_truncate
BEFORE TRUNCATE ON safety_report_events
FOR EACH STATEMENT
EXECUTE FUNCTION reject_safety_report_event_mutation();
