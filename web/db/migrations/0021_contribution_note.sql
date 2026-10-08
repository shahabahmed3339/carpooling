-- Optional cost-sharing note.
--
-- In practice a rider often contributes to fuel, and leaving that undefined
-- pushes it into an unlogged side conversation. This adds a short, free-text
-- contribution note the driver can set on a commute. It is display-only: the app
-- does not collect, hold, or transfer money, and it records no amounts as
-- structured data, so it cannot be mistaken for a payment or a price.
--
-- The note is copied onto each trip occurrence when a date is published, so
-- editing the commute later does not retroactively change what an already
-- published trip advertised.

ALTER TABLE commute_templates
  ADD COLUMN contribution_note text
    CHECK (contribution_note IS NULL OR length(trim(contribution_note)) BETWEEN 1 AND 160);

ALTER TABLE trip_occurrences
  ADD COLUMN contribution_note text
    CHECK (contribution_note IS NULL OR length(trim(contribution_note)) BETWEEN 1 AND 160);
