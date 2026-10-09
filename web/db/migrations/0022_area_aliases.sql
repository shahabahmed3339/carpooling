-- Explicit area aliases for matching.
--
-- Areas are free text and matched by normalized equality, so "Gulberg" and
-- "Gulberg III" never match even when a local would consider them the same
-- place. Inferring proximity would be wrong often enough to create real
-- problems — two distant areas sharing a name, or a guess that strands a rider
-- who cannot find their driver.
--
-- Instead an operator declares equivalences deliberately. Every row is an
-- explicit, auditable claim that two spellings refer to the same pickup or
-- destination area. Nothing is inferred from text similarity or geography.
--
-- `alias_area` and `canonical_area` both store the same normalized form used by
-- normalizeArea (trimmed, collapsed whitespace, lowercased).

CREATE TABLE area_aliases (
  id uuid PRIMARY KEY,
  community_id uuid NOT NULL REFERENCES communities(id) ON DELETE RESTRICT,
  alias_area text NOT NULL CHECK (length(btrim(alias_area)) BETWEEN 1 AND 120),
  canonical_area text NOT NULL CHECK (length(btrim(canonical_area)) BETWEEN 1 AND 120),
  note text CHECK (note IS NULL OR length(btrim(note)) BETWEEN 1 AND 200),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  -- One canonical target per alias, so resolution is never ambiguous.
  UNIQUE (community_id, alias_area),
  -- An alias that points at itself is a no-op and usually a mistake.
  CHECK (alias_area <> canonical_area)
);

-- The search path resolves a viewer's area to its canonical form in one lookup.
CREATE INDEX area_aliases_resolve_idx ON area_aliases (community_id, alias_area);
