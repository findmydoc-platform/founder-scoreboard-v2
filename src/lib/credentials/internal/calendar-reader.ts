import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { observeCalendarResultPhase } from "../../runtime-logging";
import type { CalendarPublication, CalendarSnapshot } from "../types";

const pageSize = 100;
const relation = "team_workweek_publications!team_workweek_publications_owner_profile_id_fkey";
const publicationColumns = "id,owner_profile_id,effective_from,effective_to,effective_at,effective_until,timezone,published_at,last_sync_at,publication_revision,windows";
const tailColumns = "id,effective_from,publication_revision";
const profileSelection = `id,published:${relation}(),calendar:${relation}(${publicationColumns}),tail:${relation}(${tailColumns})`;

type TailMarker = { id: string; effective_from: string; publication_revision: number };
type ProfileRow = { id: string; calendar: CalendarPublication[]; tail: TailMarker[] };
type PublicationCursor = TailMarker;
type ReadResult<T> = { data: T | null; error: { message: string } | null };

const failed = <T>(): ReadResult<T> => ({ data: null, error: { message: "Calendar snapshot is unavailable." } });
const compareString = (left: string, right: string) => left < right ? -1 : left > right ? 1 : 0;
const compareNumber = (left: number, right: number) => left < right ? -1 : left > right ? 1 : 0;

function validDate(value: unknown): value is string {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function comparePublication(left: TailMarker, right: TailMarker) {
  return compareString(right.effective_from, left.effective_from)
    || compareNumber(right.publication_revision, left.publication_revision)
    || compareString(right.id, left.id);
}

function isMarker(value: unknown): value is TailMarker {
  if (!value || typeof value !== "object") return false;
  const marker = value as TailMarker;
  return typeof marker.id === "string" && marker.id.length > 0 && validDate(marker.effective_from)
    && Number.isSafeInteger(marker.publication_revision) && marker.publication_revision > 0;
}

function isPublication(value: unknown, ownerProfileId: string): value is CalendarPublication {
  if (!value || typeof value !== "object") return false;
  const row = value as CalendarPublication;
  return typeof row.id === "string" && row.id.length > 0 && row.owner_profile_id === ownerProfileId
    && validDate(row.effective_from) && (row.effective_to === null || validDate(row.effective_to))
    && (row.effective_at === undefined || row.effective_at === null || (typeof row.effective_at === "string" && Number.isFinite(Date.parse(row.effective_at))))
    && (row.effective_until === undefined || row.effective_until === null || (typeof row.effective_until === "string" && Number.isFinite(Date.parse(row.effective_until))))
    && row.timezone === "Europe/Berlin" && typeof row.published_at === "string" && Number.isFinite(Date.parse(row.published_at))
    && typeof row.last_sync_at === "string" && Number.isFinite(Date.parse(row.last_sync_at))
    && Number.isSafeInteger(row.publication_revision) && row.publication_revision > 0
    && Array.isArray(row.windows) && row.windows.every(window => Number.isInteger(window.weekday) && window.weekday >= 1 && window.weekday <= 7
      && Number.isInteger(window.startMinute) && Number.isInteger(window.endMinute) && window.startMinute >= 0
      && window.startMinute < window.endMinute && window.endMinute <= 1439);
}

function cursorFor(row: CalendarPublication): PublicationCursor {
  return { id: row.id, effective_from: row.effective_from, publication_revision: row.publication_revision };
}

function sameMarker(left: TailMarker, right: TailMarker) {
  return left.id === right.id && left.effective_from === right.effective_from && left.publication_revision === right.publication_revision;
}

function dateFilter(earliestDate: string) {
  return `effective_to.is.null,effective_to.gte.${earliestDate}`;
}

function continuationFilter(earliestDate: string, cursor: PublicationCursor) {
  if (!/^[0-9a-f]{8}-(?:[0-9a-f]{4}-){3}[0-9a-f]{12}$/i.test(cursor.id)) return null;
  const afterCursor = `or(effective_from.lt.${cursor.effective_from},and(effective_from.eq.${cursor.effective_from},publication_revision.lt.${cursor.publication_revision}),and(effective_from.eq.${cursor.effective_from},publication_revision.eq.${cursor.publication_revision},id.lt.${cursor.id}))`;
  return `and(or(${dateFilter(earliestDate)}),${afterCursor})`;
}

async function readProfilePage(data: SupabaseClient, earliestDate: string, afterId?: string) {
  let query = data.from("profiles").select(profileSelection, { count: "exact" })
    .eq("published.status", "published").not("published", "is", null)
    .eq("calendar.status", "published").eq("tail.status", "published")
    .or(dateFilter(earliestDate), { referencedTable: "calendar" })
    .or(dateFilter(earliestDate), { referencedTable: "tail" })
    .order("id", { ascending: true }).limit(pageSize).limit(1, { referencedTable: "published" })
    .order("effective_from", { referencedTable: "calendar", ascending: false })
    .order("publication_revision", { referencedTable: "calendar", ascending: false })
    .order("id", { referencedTable: "calendar", ascending: false }).limit(pageSize, { referencedTable: "calendar" })
    .order("effective_from", { referencedTable: "tail", ascending: true })
    .order("publication_revision", { referencedTable: "tail", ascending: true })
    .order("id", { referencedTable: "tail", ascending: true }).limit(1, { referencedTable: "tail" });
  if (afterId !== undefined) query = query.gt("id", afterId);
  return await observeCalendarResultPhase("calendar.snapshot", () => query.returns<ProfileRow[]>());
}

async function readPublicationPage(data: SupabaseClient, ownerProfileId: string, earliestDate: string, cursor?: PublicationCursor) {
  let query = data.from("team_workweek_publications").select(publicationColumns)
    .eq("owner_profile_id", ownerProfileId).eq("status", "published");
  const filter = cursor ? continuationFilter(earliestDate, cursor) : dateFilter(earliestDate);
  if (!filter) return null;
  query = query.or(filter)
    .order("effective_from", { ascending: false }).order("publication_revision", { ascending: false }).order("id", { ascending: false })
    .limit(pageSize);
  return await observeCalendarResultPhase("calendar.publications", () => query.returns<CalendarPublication[]>());
}

async function completeOwnerPublications(data: SupabaseClient, ownerProfileId: string, earliestDate: string, embedded: CalendarPublication[], markers: TailMarker[]) {
  if (!Array.isArray(embedded) || embedded.length > pageSize || !Array.isArray(markers) || markers.length > 1) return null;
  if (embedded.some(row => !isPublication(row, ownerProfileId))) return null;
  for (let index = 1; index < embedded.length; index++) if (comparePublication(embedded[index - 1], embedded[index]) >= 0) return null;
  if (markers.length === 0) return embedded.length === 0 ? [] : null;

  const marker = markers[0];
  if (!isMarker(marker)) return null;
  const seenIds = new Set<string>();
  for (const row of embedded) {
    if (seenIds.has(row.id)) return null;
    seenIds.add(row.id);
  }
  const markerIndex = embedded.findIndex(row => row.id === marker.id);
  if (markerIndex >= 0) return markerIndex === embedded.length - 1 && sameMarker(cursorFor(embedded[markerIndex]), marker) ? embedded : null;

  const completed = [...embedded];
  let cursor = embedded.length ? cursorFor(embedded[embedded.length - 1]) : undefined;
  for (;;) {
    const page = await readPublicationPage(data, ownerProfileId, earliestDate, cursor);
    if (!page || page.error || !Array.isArray(page.data) || page.data.length === 0 || page.data.length > pageSize) return null;
    let previous = cursor;
    let foundMarker = false;
    for (let index = 0; index < page.data.length; index++) {
      const row = page.data[index];
      if (!isPublication(row, ownerProfileId) || seenIds.has(row.id) || (previous && comparePublication(previous, row) >= 0)) return null;
      seenIds.add(row.id);
      completed.push(row);
      previous = cursorFor(row);
      if (row.id === marker.id) {
        if (index !== page.data.length - 1 || !sameMarker(previous, marker)) return null;
        foundMarker = true;
      }
    }
    cursor = previous;
    if (foundMarker) return completed;
  }
}

async function readSnapshot(data: SupabaseClient, earliestDate: string): Promise<ReadResult<CalendarSnapshot>> {
  if (!validDate(earliestDate)) return failed();
  const publishedOwnerIds = new Set<string>();
  const publications: CalendarPublication[] = [];
  const seenProfileIds = new Set<string>();
  const seenPublicationIds = new Set<string>();
  let totalProfiles: number | null = null;
  let readProfiles = 0;
  let cursor: string | undefined;

  try {
    for (;;) {
      const page = await readProfilePage(data, earliestDate, cursor);
      if (page.error || !Array.isArray(page.data) || !Number.isSafeInteger(page.count) || page.count === null || page.count < 0 || page.data.length > pageSize) {
        return failed();
      }
      if (totalProfiles === null) totalProfiles = page.count;
      if (page.count !== totalProfiles - readProfiles || page.data.length > page.count || (page.count > 0 && page.data.length === 0)) return failed();

      for (const profile of page.data) {
        if (!profile || typeof profile.id !== "string" || profile.id.length === 0 || seenProfileIds.has(profile.id)) return failed();
        seenProfileIds.add(profile.id);
        publishedOwnerIds.add(profile.id);
        const ownerPublications = await completeOwnerPublications(data, profile.id, earliestDate, profile.calendar, profile.tail);
        if (!ownerPublications) return failed();
        for (const publication of ownerPublications) {
          if (seenPublicationIds.has(publication.id)) return failed();
          seenPublicationIds.add(publication.id);
          publications.push(publication);
        }
      }

      readProfiles += page.data.length;
      if (readProfiles === totalProfiles) break;
      const nextCursor = page.data[page.data.length - 1]?.id;
      if (!nextCursor || nextCursor === cursor) return failed();
      cursor = nextCursor;
    }
  } catch {
    return failed();
  }

  publications.sort(comparePublication);
  return { data: { publications, publishedOwnerIds: [...publishedOwnerIds].sort(compareString) }, error: null };
}

export function createCalendarReader(data: SupabaseClient) {
  return Object.freeze({ readSnapshot: (earliestDate: string) => readSnapshot(data, earliestDate) });
}
