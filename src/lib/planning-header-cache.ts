import "server-only";

import { revalidateTag, unstable_cache } from "next/cache";
import {
  loadHeaderCalendarEvents,
  loadHeaderQuickLinks,
} from "@/lib/planning-header-data";
import type { HeaderCalendarEvent, HeaderDataSlot, HeaderQuickLink } from "@/lib/types";
import { getServerSupabase } from "@/lib/supabase";

const sharedHeaderCacheSeconds = 300;
const sharedHeaderCacheTags = {
  quickLinks: "planning-header-quick-links",
  calendarEvents: "planning-header-calendar-events",
} as const;

export type SharedPlanningHeaderCacheSlot = keyof typeof sharedHeaderCacheTags;

const readCachedHeaderQuickLinks = unstable_cache(
  async () => {
    const supabase = getServerSupabase();
    if (!supabase) throw new Error("Planning data source is unavailable.");
    const result = await loadHeaderQuickLinks(supabase);
    if (result.state === "error") throw new Error(result.error || "Quick links are unavailable.");
    return result;
  },
  ["planning-header-quick-links-v1"],
  { revalidate: sharedHeaderCacheSeconds, tags: [sharedHeaderCacheTags.quickLinks] },
);

const readCachedHeaderCalendarEvents = unstable_cache(
  async () => {
    const supabase = getServerSupabase();
    if (!supabase) throw new Error("Planning data source is unavailable.");
    const result = await loadHeaderCalendarEvents(supabase);
    if (result.state === "error") throw new Error(result.error || "Calendar events are unavailable.");
    return result;
  },
  ["planning-header-calendar-events-v1"],
  { revalidate: sharedHeaderCacheSeconds, tags: [sharedHeaderCacheTags.calendarEvents] },
);

function sharedHeaderCacheError<T>(data: T, error: string): HeaderDataSlot<T> {
  return { state: "error", data, error };
}

export async function loadCachedHeaderQuickLinks(): Promise<HeaderDataSlot<HeaderQuickLink[]>> {
  try {
    return await readCachedHeaderQuickLinks();
  } catch {
    return sharedHeaderCacheError([], "Kuratierte Links konnten nicht geladen werden.");
  }
}

export async function loadCachedHeaderCalendarEvents(): Promise<HeaderDataSlot<HeaderCalendarEvent[]>> {
  try {
    return await readCachedHeaderCalendarEvents();
  } catch {
    return sharedHeaderCacheError([], "Kalenderdaten konnten nicht geladen werden.");
  }
}

export const sharedPlanningHeaderSlotLoaders = {
  quickLinks: loadCachedHeaderQuickLinks,
  calendarEvents: loadCachedHeaderCalendarEvents,
};

export function invalidateSharedPlanningHeaderCache(slot: SharedPlanningHeaderCacheSlot) {
  revalidateTag(sharedHeaderCacheTags[slot], { expire: 0 });
}
