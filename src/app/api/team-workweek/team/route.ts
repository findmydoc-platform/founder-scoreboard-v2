import { type NextRequest, NextResponse } from "next/server";
import {
  selectCalendarWorkweek,
  validateCalendarWorkweekRange,
  type CalendarTeamWorkweek,
} from "@/features/team-workweek/model/team-workweek-calendar";
import { berlinTodayIso, inflatePublishedTeamWorkweekWindows } from "@/features/team-workweek/model/team-workweek-draft";
import { selectVisibleTeamWorkweeks } from "@/features/team-workweek/model/published-team-workweek";
import { apiError, authzError } from "@/lib/api-response";
import { authorizeCredentialAction } from "@/lib/credentials";
import type { CalendarPublication } from "@/lib/credentials/types";
import { observeCalendarPhase, observeCalendarPreparation, observeCalendarRoute, recordCalendarDenial, recordCalendarFailure } from "@/lib/runtime-logging";

export const dynamic = "force-dynamic";

type PublishedVersionRow = CalendarPublication;

function calendarWorkweek(row: PublishedVersionRow): CalendarTeamWorkweek {
  return {
    id: row.id,
    ownerProfileId: row.owner_profile_id,
    effectiveFrom: row.effective_from,
    ...(row.effective_at ? { effectiveAt: row.effective_at } : {}),
    ...(row.effective_until ? { effectiveUntil: row.effective_until } : {}),
    effectiveTo: row.effective_to,
    timezone: row.timezone,
    publicationRevision: row.publication_revision,
    lastSyncAt: row.last_sync_at,
    windows: inflatePublishedTeamWorkweekWindows(row.windows || []),
  };
}

export function GET(request: NextRequest) {
  return observeCalendarRoute(request, () => calendarResponse(request));
}

async function calendarResponse(request: NextRequest) {
  const permission = await authorizeCredentialAction({ credential: { kind: "session-request", request }, action: "calendar.read" });
  if (!permission.ok) {
    recordCalendarDenial(permission.code);
    if (permission.status >= 500) recordCalendarFailure({ operation: "calendar.authorization", errorCode: "calendar_authorization_unavailable", errorCategory: "unexpected_error" });
    return authzError(permission);
  }
  const requestedRange = validateCalendarWorkweekRange(
    request.nextUrl.searchParams.get("from"),
    request.nextUrl.searchParams.get("to"),
  );
  if (!requestedRange.ok) return apiError(requestedRange.error, 400);

  const now = new Date();
  const referenceDate = berlinTodayIso(now);
  // Retain current and all future plans, plus history needed by the requested range.
  const earliestDate = requestedRange.range && requestedRange.range.from < referenceDate ? requestedRange.range.from : referenceDate;
  const [publications, owners] = await observeCalendarPhase("calendar.data", () => Promise.all([
    permission.calendar.readPublications(earliestDate),
    // An owner with historical hours is still published, even without a current plan.
    permission.calendar.readPublishedOwners(),
  ]));
  const { data, error } = publications;
  if (error || owners.error) {
    recordCalendarFailure({ operation: "calendar.publications", errorCode: "calendar_data_unavailable", errorCategory: "unexpected_error" });
    return apiError("Veröffentlichte Grundwochen konnten nicht geladen werden.", 503);
  }

  return observeCalendarPreparation(() => {
    const visible = selectVisibleTeamWorkweeks((data || []).map((row) => ({
      ownerProfileId: row.owner_profile_id,
      effectiveFrom: row.effective_from,
      ...(row.effective_at ? { effectiveAt: row.effective_at } : {}),
      ...(row.effective_until ? { effectiveUntil: row.effective_until } : {}),
      effectiveTo: row.effective_to,
      publicationRevision: row.publication_revision,
      row,
    })), referenceDate, now);

    const workweeks = visible.map(({ row, phase }) => ({
      id: row.id,
      ownerProfileId: row.owner_profile_id,
      effectiveFrom: row.effective_from,
      ...(row.effective_at ? { effectiveAt: row.effective_at } : {}),
      ...(row.effective_until ? { effectiveUntil: row.effective_until } : {}),
      timezone: row.timezone,
      publishedAt: row.published_at,
      lastSyncAt: row.last_sync_at,
      publicationRevision: row.publication_revision,
      phase,
      windows: inflatePublishedTeamWorkweekWindows(row.windows || []),
    }));
    const allCalendarWorkweeks = (data || []).map(calendarWorkweek);
    const currentWorkweeks = [...new Set(allCalendarWorkweeks.map(({ ownerProfileId }) => ownerProfileId))]
      .map((ownerProfileId) => selectCalendarWorkweek(allCalendarWorkweeks, ownerProfileId, referenceDate, now))
      .filter((workweek): workweek is CalendarTeamWorkweek => workweek !== null && (!workweek.effectiveAt || new Date(workweek.effectiveAt) <= now));
    const calendarWorkweeks = requestedRange.range
      ? allCalendarWorkweeks
        .filter((workweek) => workweek.effectiveFrom <= requestedRange.range!.to)
        .filter((workweek) => !workweek.effectiveTo || workweek.effectiveTo >= requestedRange.range!.from)
      : undefined;

    return NextResponse.json({
      referenceDate,
      upcomingWorkweeks: allCalendarWorkweeks.filter(row => (row.effectiveAt ? Date.parse(row.effectiveAt) > now.getTime() : row.effectiveFrom > referenceDate) && (!row.effectiveUntil || Date.parse(row.effectiveUntil) > Date.parse(row.effectiveAt || `${row.effectiveFrom}T00:00:00Z`)) && (!row.effectiveTo || row.effectiveTo >= row.effectiveFrom)),
      publishedOwnerIds: [...new Set((owners.data || []).map(row => row.owner_profile_id))],
      workweeks,
      currentWorkweeks,
      ...(calendarWorkweeks ? { calendarWorkweeks } : {}),
    });
  });
}
