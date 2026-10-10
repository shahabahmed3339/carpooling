-- Per-trip meeting details, shared only between the two participants of an
-- accepted seat.
--
-- plan.md requires that a rider and driver be able to agree a precise pickup and
-- exchange contact information "only when needed for an accepted trip and with
-- the parties involved". Until now the app had no place for that: areas are
-- deliberately approximate, so two people who had agreed on a ride had no way to
-- say "the pharmacy on Main Boulevard" or exchange a phone number. Without it the
-- product stops one step short of an actual ride.
--
-- Two columns rather than one shared field, so each side can edit only their own
-- text and neither can rewrite the other's. Both are nullable: writing one is
-- optional and independent, and an absent value is simply "not provided yet".
--
-- Access is enforced in the service, not by the column: a detail is readable and
-- writable only while the request is ACCEPTED. A pending or declined request
-- exposes nothing, and the values are cleared when a request stops being accepted
-- so a former participant cannot keep reading a phone number after the ride is
-- cancelled.
--
-- Deliberately NOT encrypted at rest. The ceiling here is privacy from other
-- users and from the query layer, not from the database operator, who can read
-- every table. Encrypting with a key the application holds would suggest a
-- guarantee this design does not make.

ALTER TABLE ride_requests
  ADD COLUMN driver_meeting_detail text,
  ADD COLUMN rider_meeting_detail text;

-- Bounded like every other free-text field in the schema (the cost-sharing note
-- is 160, areas 120). Long enough for a landmark description or a phone number,
-- short enough that this cannot become a message thread the app does not
-- moderate: there is no report path on a private message, only on the trip.
ALTER TABLE ride_requests
  ADD CONSTRAINT ride_requests_driver_meeting_detail_length
    CHECK (driver_meeting_detail IS NULL OR (length(driver_meeting_detail) BETWEEN 1 AND 500)),
  ADD CONSTRAINT ride_requests_rider_meeting_detail_length
    CHECK (rider_meeting_detail IS NULL OR (length(rider_meeting_detail) BETWEEN 1 AND 500));

-- A blank detail is stored as NULL, never as an empty string, so "provided" and
-- "cleared" are distinguishable and the length CHECK above cannot be sidestepped.
ALTER TABLE ride_requests
  ADD CONSTRAINT ride_requests_meeting_detail_not_blank
    CHECK (
      (driver_meeting_detail IS NULL OR btrim(driver_meeting_detail) <> '')
      AND (rider_meeting_detail IS NULL OR btrim(rider_meeting_detail) <> '')
    );

-- Invariant: a detail exists only while a seat is actually granted.
--
-- Enforced by a trigger rather than a CHECK the callers must satisfy, because a
-- request leaves ACCEPTED from six different statements (driver cancels the trip,
-- rider cancels the request, driver declines, the expiry sweep, account closure,
-- and reviewer dispute resolution). A CHECK would reject all six until each was
-- edited, and would silently start rejecting any seventh added later. Clearing
-- here means every path — present and future — cannot leak a phone number to
-- someone who is no longer on the trip.
CREATE FUNCTION clear_meeting_details_on_unaccepted()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.status <> 'ACCEPTED' THEN
    NEW.driver_meeting_detail := NULL;
    NEW.rider_meeting_detail := NULL;
  END IF;
  RETURN NEW;
END;
$$;

CREATE TRIGGER ride_requests_clear_meeting_details
  BEFORE INSERT OR UPDATE ON ride_requests
  FOR EACH ROW
  EXECUTE FUNCTION clear_meeting_details_on_unaccepted();
