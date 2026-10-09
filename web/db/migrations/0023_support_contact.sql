-- Support contact, shown in the app.
--
-- Reports and blocking exist, but a participant with an urgent problem had no
-- stated way to reach a person. This adds an operator-configured support contact
-- and hours to the community row. It is configuration, not a promise: the app
-- simply displays what an operator sets, and the UI must not imply that the
-- channel is monitored when hours are unset.
--
-- These are deliberately plain fields. There is no delivery, ticket, or
-- escalation mechanism behind them; the operator is responsible for whatever
-- contact they publish.

ALTER TABLE communities
  ADD COLUMN support_contact text
    CHECK (support_contact IS NULL OR length(btrim(support_contact)) BETWEEN 1 AND 200),
  ADD COLUMN support_hours text
    CHECK (support_hours IS NULL OR length(btrim(support_hours)) BETWEEN 1 AND 200);
