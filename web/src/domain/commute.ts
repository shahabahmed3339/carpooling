export type CommuteCandidate = {
  id: string;
  communityId: string;
  displayName: string;
  initials: string;
  originAreaId: string;
  originLabel: string;
  destinationAreaId: string;
  destinationLabel: string;
  weekdays: number[];
  departureMinutes: number;
  availableSeats: number;
  vehicleLabel: string;
  isApproved: boolean;
  isActive: boolean;
};

export type SearchCriteria = {
  viewerId: string;
  communityId: string;
  originAreaId: string;
  destinationAreaId: string;
  tripDate: string;
  desiredDeparture: string;
};

export type MatchResult = {
  candidate: CommuteCandidate;
  departureDifferenceMinutes: number;
};

// Demo-only hypothesis. Pilot tolerances must be set in PILOT_BRIEF.md.
export const DEMO_TIME_TOLERANCE_MINUTES = 20;

function utcWeekday(date: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;

  const parsed = new Date(`${date}T00:00:00.000Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== date) {
    return null;
  }

  return parsed.getUTCDay();
}

export function findDemoMatches(
  criteria: SearchCriteria,
  candidates: CommuteCandidate[],
): MatchResult[] {
  const weekday = utcWeekday(criteria.tripDate);
  const desiredMinutes = parseClockMinutes(criteria.desiredDeparture);
  if (weekday === null || desiredMinutes === null) return [];

  return candidates
    .filter((candidate) => {
      if (candidate.id === criteria.viewerId) return false;
      if (candidate.communityId !== criteria.communityId) return false;
      if (!candidate.isApproved || !candidate.isActive) return false;
      if (candidate.availableSeats < 1) return false;
      if (!candidate.weekdays.includes(weekday)) return false;
      if (candidate.originAreaId !== criteria.originAreaId) return false;
      if (candidate.destinationAreaId !== criteria.destinationAreaId) return false;

      return (
        Math.abs(candidate.departureMinutes - desiredMinutes) <=
        DEMO_TIME_TOLERANCE_MINUTES
      );
    })
    .map((candidate) => ({
      candidate,
      departureDifferenceMinutes: Math.abs(
        candidate.departureMinutes - desiredMinutes,
      ),
    }))
    .sort(
      (a, b) =>
        a.departureDifferenceMinutes - b.departureDifferenceMinutes ||
        b.candidate.availableSeats - a.candidate.availableSeats ||
        a.candidate.id.localeCompare(b.candidate.id),
    );
}

export function formatMinutes(minutes: number): string {
  const hours = Math.floor(minutes / 60);
  const remainder = minutes % 60;
  const suffix = hours >= 12 ? "PM" : "AM";
  const displayHour = hours % 12 || 12;
  return `${displayHour}:${String(remainder).padStart(2, "0")} ${suffix}`;
}
import { parseClockMinutes } from "./clock";
