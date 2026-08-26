import "server-only";

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  ensureGoogleWorkweekSeries,
  googleWorkweekRecovery,
  type GoogleWorkweekSeriesResult,
  type PreparedWorkweekPublication,
} from "./team-workweek-publication-core";
import { GoogleWorkspaceOAuthContractError } from "./google-workspace-oauth-core";
import { getGoogleWorkspaceAccessToken } from "./google-workspace-oauth";

type PublicationErrorCode =
  | "invalid_request"
  | "not_found"
  | "forbidden"
  | "conflict"
  | "reconnect_required"
  | "unavailable";

export class TeamWorkweekPublicationError extends Error {
  constructor(readonly code: PublicationErrorCode, message: string) {
    super(message);
    this.name = "TeamWorkweekPublicationError";
  }
}

type PublicationResult = Readonly<{
  id: string;
  status: "preparing" | "published";
  syncState: "delayed" | "confirmed";
  publishedAt: string | null;
  lastSyncAt: string | null;
  publicationRevision: number;
  recovery: "retry" | "reconnect" | "identity_conflict" | null;
}>;

type PublicationDelayClass = Extract<GoogleWorkweekSeriesResult, { state: "delayed" }>["errorClass"] | "storage_failed";

function publicationError(error: { code?: string } | null | undefined) {
  if (error?.code === "42501") {
    return new TeamWorkweekPublicationError("forbidden", "Keine Berechtigung für diese Grundwoche.");
  }
  if (error?.code === "P0002") {
    return new TeamWorkweekPublicationError("not_found", "Private Grundwoche wurde nicht gefunden.");
  }
  if (error?.code === "P0003") {
    return new TeamWorkweekPublicationError("conflict", "Google-Synchronisierung ist noch nicht vollständig bestätigt.");
  }
  if (error?.code === "22023") {
    return new TeamWorkweekPublicationError("invalid_request", "Grundwoche ist ungültig.");
  }
  return new TeamWorkweekPublicationError("unavailable", "Grundwoche konnte nicht veröffentlicht werden.");
}

function isPreparedPublication(value: unknown): value is PreparedWorkweekPublication {
  if (!value || typeof value !== "object") return false;
  const input = value as Partial<PreparedWorkweekPublication>;
  return typeof input.id === "string"
    && typeof input.sourceVersionId === "string"
    && typeof input.ownerProfileId === "string"
    && typeof input.effectiveFrom === "string"
    && input.timezone === "Europe/Berlin"
    && (input.status === "preparing" || input.status === "published")
    && Number.isInteger(input.publicationRevision)
    && (input.publishedAt === null || typeof input.publishedAt === "string")
    && (input.lastSyncAt === null || typeof input.lastSyncAt === "string")
    && Array.isArray(input.series)
    && input.series.every((series) => Boolean(
      series
      && typeof series.id === "string"
      && series.calendarId === "primary"
      && typeof series.googleEventId === "string"
      && (series.state === "pending" || series.state === "confirmed")
      && Number.isInteger(series.weekday)
      && Number.isInteger(series.startMinute)
      && Number.isInteger(series.endMinute),
    ));
}

function isPublicationResult(value: unknown): value is PublicationResult {
  if (!value || typeof value !== "object") return false;
  const input = value as Partial<PublicationResult>;
  return typeof input.id === "string"
    && (input.status === "preparing" || input.status === "published")
    && (input.syncState === "delayed" || input.syncState === "confirmed")
    && Number.isInteger(input.publicationRevision);
}

function recoveryFor(errorClass: PublicationDelayClass): PublicationResult["recovery"] {
  return errorClass === "storage_failed" ? "retry" : googleWorkweekRecovery(errorClass);
}

function resultWithRecovery(value: unknown, recovery: PublicationResult["recovery"]) {
  if (!isPublicationResult(value)) {
    throw new TeamWorkweekPublicationError("unavailable", "Veröffentlichungsstatus konnte nicht bestätigt werden.");
  }
  return { ...value, recovery: value.status === "published" ? null : recovery } satisfies PublicationResult;
}

async function markDelayed(
  serviceSupabase: SupabaseClient,
  publicationId: string,
  errorClass: PublicationDelayClass,
  observedAt: string,
) {
  const { data, error } = await serviceSupabase.rpc("delay_team_workweek_publication", {
    p_publication_id: publicationId,
    p_error_class: errorClass,
    p_observed_at: observedAt,
  });
  if (error) throw publicationError(error);
  return resultWithRecovery(data, recoveryFor(errorClass));
}

export async function publishTeamWorkweek({
  serviceSupabase,
  userSupabase,
  versionId,
  ensureSeries = ensureGoogleWorkweekSeries,
  now = () => new Date(),
}: {
  serviceSupabase: SupabaseClient;
  userSupabase: SupabaseClient;
  versionId: string;
  ensureSeries?: typeof ensureGoogleWorkweekSeries;
  now?: () => Date;
}): Promise<PublicationResult> {
  const preparedResponse = await userSupabase.rpc("prepare_team_workweek_publication", {
    p_version_id: versionId,
  });
  if (preparedResponse.error) throw publicationError(preparedResponse.error);
  if (!isPreparedPublication(preparedResponse.data)) {
    throw new TeamWorkweekPublicationError("unavailable", "Grundwoche konnte nicht vorbereitet werden.");
  }
  const publication = preparedResponse.data;
  if (publication.status === "published") {
    return {
      id: publication.id,
      status: "published",
      syncState: "confirmed",
      publishedAt: publication.publishedAt,
      lastSyncAt: publication.lastSyncAt,
      publicationRevision: publication.publicationRevision,
      recovery: null,
    };
  }

  let accessToken: string;
  try {
    accessToken = await getGoogleWorkspaceAccessToken(serviceSupabase, publication.ownerProfileId);
  } catch (error) {
    const observedAt = now().toISOString();
    const reconnectRequired = error instanceof GoogleWorkspaceOAuthContractError && error.code === "reconnect_required";
    return await markDelayed(
      serviceSupabase,
      publication.id,
      reconnectRequired ? "oauth_reconnect_required" : "provider_unavailable",
      observedAt,
    );
  }

  let delayed: Extract<GoogleWorkweekSeriesResult, { state: "delayed" }> | null = null;
  for (const series of publication.series) {
    if (series.state === "confirmed") continue;
    let result: GoogleWorkweekSeriesResult;
    try {
      result = await ensureSeries({ accessToken, publication, series, now });
    } catch {
      result = { state: "delayed", errorClass: "provider_unavailable" };
    }
    if (result.state === "delayed") {
      delayed ??= result;
      continue;
    }
    const confirmation = await serviceSupabase.rpc("confirm_team_workweek_google_series", {
      p_series_id: series.id,
      p_etag: result.etag,
      p_founderops_revision: publication.publicationRevision,
      p_observed_at: result.observedAt,
    });
    if (confirmation.error) {
      const observedAt = now().toISOString();
      return await markDelayed(serviceSupabase, publication.id, "storage_failed", observedAt);
    }
  }

  if (delayed) {
    const observedAt = now().toISOString();
    return await markDelayed(serviceSupabase, publication.id, delayed.errorClass, observedAt);
  }

  const finalized = await userSupabase.rpc("finalize_team_workweek_publication", {
    p_publication_id: publication.id,
  });
  if (finalized.error) throw publicationError(finalized.error);
  if (!isPublicationResult(finalized.data) || finalized.data.status !== "published") {
    throw new TeamWorkweekPublicationError("unavailable", "Grundwoche konnte nicht veröffentlicht werden.");
  }
  return { ...finalized.data, recovery: null };
}
