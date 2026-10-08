-- Support case-insensitive, whitespace-normalized area matching without
-- forcing a full scan of active offering commute templates.
CREATE INDEX commute_templates_normalized_area_search_idx
  ON commute_templates (
    community_id,
    lower(regexp_replace(trim(origin_area), '[[:space:]]+', ' ', 'g')),
    lower(regexp_replace(trim(destination_area), '[[:space:]]+', ' ', 'g'))
  )
  WHERE is_active = true
    AND role IN ('OFFERING', 'EITHER')
    AND seats_offered > 0;
