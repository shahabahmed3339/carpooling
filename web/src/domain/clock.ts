export function parseClockMinutes(value: string): number | null {
  const match = /^(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;

  const hours = Number(match[1]);
  const minutes = Number(match[2]);
  if (hours > 23 || minutes > 59) return null;

  return hours * 60 + minutes;
}

export const AREA_MAX_LENGTH = 120;

/**
 * Area inputs are free text. Matching trims, collapses repeated whitespace, and
 * ignores case, so the stored and compared values must be normalized the same
 * way everywhere to avoid two spellings of the same area failing to match.
 * Returns null when the input is empty or too long after normalization.
 */
export function normalizeArea(value: string): string | null {
  const normalized = value.trim().replace(/\s+/gu, " ").toLowerCase();
  if (normalized.length < 1 || normalized.length > AREA_MAX_LENGTH) return null;
  return normalized;
}

export function isValidDateOnly(value: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}
