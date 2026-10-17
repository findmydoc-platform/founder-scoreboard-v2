import "server-only";

import { revalidateTag } from "next/cache";
import type { HeaderCalendarEvent, HeaderDataSlot, HeaderQuickLink } from "@/lib/types";

const sharedHeaderCacheTags = {
  quickLinks: "planning-header-quick-links",
  calendarEvents: "planning-header-calendar-events",
} as const;

export type SharedPlanningHeaderCacheSlot = keyof typeof sharedHeaderCacheTags;

function sharedHeaderCacheError<T>(data: T, error: string): HeaderDataSlot<T> { return { state: "error", data, error }; }

export async function loadCachedHeaderQuickLinks(): Promise<HeaderDataSlot<HeaderQuickLink[]>> {
  try {
    const { authorizeCredentialAction } = await import("./credentials");
  const permission = await authorizeCredentialAction({ credential: { kind: "server-cookies" }, action: "planning.header.read" });
  if (!permission.ok) return sharedHeaderCacheError([], "Kuratierte Links konnten nicht geladen werden.");
  const result = await permission.planning.loadHeader(["quickLinks"]);
  return result.ok ? result.headerData.quickLinks : sharedHeaderCacheError([], "Kuratierte Links konnten nicht geladen werden.");
  } catch { return sharedHeaderCacheError([], "Kuratierte Links konnten nicht geladen werden."); }
}

export async function loadCachedHeaderCalendarEvents(): Promise<HeaderDataSlot<HeaderCalendarEvent[]>> {
  try {
    const { authorizeCredentialAction } = await import("./credentials");
  const permission = await authorizeCredentialAction({ credential: { kind: "server-cookies" }, action: "planning.header.read" });
  if (!permission.ok) return sharedHeaderCacheError([], "Kalenderdaten konnten nicht geladen werden.");
  const result = await permission.planning.loadHeader(["calendarEvents"]);
  return result.ok ? result.headerData.calendarEvents : sharedHeaderCacheError([], "Kalenderdaten konnten nicht geladen werden.");
  } catch { return sharedHeaderCacheError([], "Kalenderdaten konnten nicht geladen werden."); }
}

export const sharedPlanningHeaderSlotLoaders = {
  quickLinks: loadCachedHeaderQuickLinks,
  calendarEvents: loadCachedHeaderCalendarEvents,
};

export function invalidateSharedPlanningHeaderCache(slot: SharedPlanningHeaderCacheSlot) {
  revalidateTag(sharedHeaderCacheTags[slot], { expire: 0 });
}
