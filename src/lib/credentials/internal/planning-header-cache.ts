import "server-only";
import { unstable_cache } from "next/cache";
import type { SupabaseClient } from "@supabase/supabase-js";
import { loadHeaderQuickLinks, loadHeaderCalendarEvents } from "../../planning-header-data";
import type { HeaderCalendarEvent, HeaderDataSlot, HeaderQuickLink } from "../../types";

export function planningHeaderSlotLoaders(service: SupabaseClient) {
  const quickLinks = unstable_cache(async () => {
    const result = await loadHeaderQuickLinks(service);
    if (result.state === "error") throw new Error("Quick links are unavailable.");
    return result;
  }, ["planning-header-quick-links-v2"], { revalidate: 300, tags: ["planning-header-quick-links"] });
  const calendarEvents = unstable_cache(async () => {
    const result = await loadHeaderCalendarEvents(service);
    if (result.state === "error") throw new Error("Calendar events are unavailable.");
    return result;
  }, ["planning-header-calendar-events-v1"], { revalidate: 300, tags: ["planning-header-calendar-events"] });
  return {
    async quickLinks(): Promise<HeaderDataSlot<HeaderQuickLink[]>> {
      try { return await quickLinks(); } catch { return { state: "error", data: [], error: "Kuratierte Links konnten nicht geladen werden." }; }
    },
    async calendarEvents(): Promise<HeaderDataSlot<HeaderCalendarEvent[]>> {
      try { return await calendarEvents(); } catch { return { state: "error", data: [], error: "Kalenderdaten konnten nicht geladen werden." }; }
    },
  };
}
