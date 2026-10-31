export type PreparedWorkweekPublication = Readonly<{
  successorPublicationId?: string | null;
  effectiveUntil?: string | null;
  predecessorPublicationId?: string | null;
  activationMode?: "immediate" | "future_monday";
  effectiveAt?: string | null;
  attemptGeneration: number;
  writeJournalVersion: 1;
  effects: import("./team-workweek-immediate-effects").PreparedWorkweekEffect[];
  id: string;
  sourceVersionId: string;
  ownerProfileId: string;
  effectiveFrom: string;
  timezone: "Europe/Berlin";
  status: "preparing" | "published";
  syncState: "pending" | "delayed" | "confirmed";
  publicationRevision: number;
  publishedAt: string | null;
  lastSyncAt: string | null;
}>;

export type GoogleWorkweekSeriesResult =
  | Readonly<{ state: "confirmed"; etag: string; observedAt: string }>
  | Readonly<{
    state: "delayed";
    errorClass: "provider_unavailable" | "provider_identity_mismatch" | "oauth_reconnect_required";
  }>;

export type GoogleWorkweekRecovery = "retry" | "reconnect" | "identity_conflict";

export function googleWorkweekRecovery(
  errorClass: Extract<GoogleWorkweekSeriesResult, { state: "delayed" }>["errorClass"],
): GoogleWorkweekRecovery {
  if (errorClass === "oauth_reconnect_required") return "reconnect";
  if (errorClass === "provider_identity_mismatch") return "identity_conflict";
  return "retry";
}
