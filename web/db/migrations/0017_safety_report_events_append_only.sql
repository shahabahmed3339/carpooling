-- Preserve reviewer accountability history against accidental application
-- updates, deletes, or truncation. Retention, if ever needed, must be handled
-- by a separately reviewed archival process rather than editing individual events.
CREATE FUNCTION reject_safety_report_event_mutation()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'safety report events are append-only'
    USING ERRCODE = '55000';
  RETURN OLD;
END;
$$;

CREATE TRIGGER safety_report_events_append_only
BEFORE UPDATE OR DELETE ON safety_report_events
FOR EACH ROW
EXECUTE FUNCTION reject_safety_report_event_mutation();

CREATE TRIGGER safety_report_events_no_truncate
BEFORE TRUNCATE ON safety_report_events
FOR EACH STATEMENT
EXECUTE FUNCTION reject_safety_report_event_mutation();
