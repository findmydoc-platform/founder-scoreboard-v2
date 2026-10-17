import type { NextRequest } from "next/server";
import type { AuthzResult } from "../authz";

export type CredentialAction =
  | "calendar.read"
  | "team.read"
  | "planning.contribute"
  | "governance.ceo"
  | "operations.lead"
  | "planning.correct"
  | "operations.correct"
  | "administration.technical"
  | "administration.eligibility";

export type CredentialActionInput = {
  credential: { kind: "session-request"; request: NextRequest };
  action: CredentialAction;
};

export type CredentialActionResult = AuthzResult | CalendarCredentialResult;

export type CalendarPublication = Readonly<{
  id: string; owner_profile_id: string; effective_from: string; effective_to: string | null;
  effective_at?: string | null; effective_until?: string | null; timezone: "Europe/Berlin";
  published_at: string; last_sync_at: string; publication_revision: number;
  windows: Array<{ weekday: number; startMinute: number; endMinute: number }>;
}>;

type ReadResult<T> = Promise<{ data: T | null; error: { message: string } | null }>;
export type CalendarReadCapability = Readonly<{
  readPublications(earliestDate: string): ReadResult<CalendarPublication[]>;
  readPublishedOwners(): ReadResult<Array<{ owner_profile_id: string }>>;
}>;
export type CalendarCredentialInput = { credential: { kind: "session-request"; request: NextRequest }; action: "calendar.read" };
export type CalendarCredentialResult = Extract<AuthzResult, { ok: false }>
  | { ok: true; profile: NonNullable<Extract<AuthzResult, { ok: true }>["profile"]>; calendar: CalendarReadCapability };
