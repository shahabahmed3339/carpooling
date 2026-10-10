/**
 * Shared types for the dashboard UI.
 *
 * These mirror the server's response shapes. They live in one place because the
 * pages that consume them are now separate routes: duplicating a shape means a
 * server change silently disagrees with one page and not another.
 */

export type ParticipantRole = "RIDER" | "DRIVER";

export type Commute = {
  id: string;
  originArea: string;
  destinationArea: string;
  departureWindowStart: string;
  departureWindowEnd: string;
  weekdays: number[];
  seatsOffered: number;
  contributionNote: string | null;
  isActive: boolean;
  version: number;
};

export type Candidate = {
  tripOccurrenceId: string;
  memberId: string;
  displayName: string;
  originArea: string;
  destinationArea: string;
  departureTime: string;
  availableSeats: number;
  departureDifferenceMinutes: number;
  contributionNote: string | null;
  originMatch: "EXACT" | "PROXIMITY";
  destinationMatch: "EXACT" | "PROXIMITY";
};

export type RideRequest = {
  requestId: string;
  tripOccurrenceId: string;
  status: string;
  otherParticipantId: string;
  otherParticipantName: string;
  originArea: string;
  destinationArea: string;
  tripDate: string;
  departureTime: string;
  awaitingCompletion: boolean;
  departurePassed: boolean;
  disputeResolved: boolean;
  tripStatus: "OPEN" | "CANCELLED" | "COMPLETED";
  riderConfirmedCompletion: boolean;
  driverConfirmedCompletion: boolean;
  driverMeetingDetail: string | null;
  riderMeetingDetail: string | null;
};

export type DriverTrip = {
  tripOccurrenceId: string;
  originArea: string;
  destinationArea: string;
  tripDate: string;
  departureTime: string;
  seatCapacity: number;
  seatsReserved: number;
  status: "OPEN" | "CANCELLED" | "COMPLETED";
  canCancel: boolean;
  contributionNote: string | null;
};

export type ActivityItem = {
  kind: "TRIP" | "REQUEST";
  recordId: string;
  tripOccurrenceId: string;
  role: "DRIVER" | "RIDER";
  status: string;
  otherParticipantId: string | null;
  otherParticipantName: string | null;
  originArea: string;
  destinationArea: string;
  tripDate: string;
  departureTime: string;
  seatCapacity: number | null;
  seatsReserved: number | null;
  awaitingCompletion: boolean;
  riderConfirmedCompletion: boolean;
  driverConfirmedCompletion: boolean;
};

export type SafetyReport = {
  reportId: string;
  reportedName: string;
  reason: "SAFETY_CONCERN" | "HARASSMENT" | "MISREPRESENTATION" | "OTHER";
  status: "RECEIVED" | "IN_REVIEW" | "RESOLVED" | "DISMISSED";
  createdAt: string;
};

export type ReportDraft = {
  userId: string;
  displayName: string;
  tripOccurrenceId: string | null;
};

export type InboxNotification = {
  id: string;
  kind: string;
  title: string;
  body: string;
  resourceType: string;
  resourceId: string;
  readAt: string | null;
  createdAt: string;
  cursorCreatedAt: string;
};

export type MyProfile = {
  displayName: string;
  phone: string | null;
  phoneVerified: boolean;
  vehicle: {
    id: string;
    make: string;
    model: string;
    colour: string;
    plate: string;
    seatCapacity: number;
  } | null;
};

export type CounterpartIdentity = {
  displayName: string;
  phone: string | null;
  phoneVerified: boolean;
  vehicle: { id: string; make: string; model: string; colour: string; plate: string; seatCapacity: number } | null;
  rating: { average: number | null; count: number; hasEnoughForAverage: boolean };
};

export type ReceivedRating = {
  ratingId: string;
  score: number;
  comment: string | null;
  createdAt: string;
  authorName: string;
  requestId: string;
};

export const WEEKDAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"] as const;

/** Weekday index for a `YYYY-MM-DD` string, in UTC so it cannot shift by timezone. */
export function weekdayForDate(date: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = new Date(`${date}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime())) return null;
  return parsed.getUTCDay();
}
