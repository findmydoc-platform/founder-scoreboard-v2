import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  FmdTool,
  FounderEvent,
  HeaderCalendarEvent,
  HeaderDataSlot,
  HeaderNotification,
  HeaderNotificationsData,
  HeaderQuickLink,
  NotificationEvent,
  PlanningData,
  PlanningHeaderData,
  PlatformRole,
} from "@/lib/types";
import { reconcileNotificationEvents } from "@/lib/notification-resolution";
import { isOperationalLeadRole } from "@/lib/platform";

export const maxHeaderQuickLinks = 5;
export const maxHeaderCalendarEvents = 200;
export const maxHeaderNotifications = 12;

export const headerQuickLinkSelect = "id,name,category,url,preview_image_url";
export const headerCalendarEventSelect = "id,title,category,starts_at,ends_at,location,status";
export const headerNotificationSelect = "id,type,actor_profile_id,recipient_profile_id,entity_type,entity_id,title,body,created_at";

export const planningHeaderSlotKeys = ["quickLinks", "calendarEvents", "notifications"] as const;
export type PlanningHeaderSlotKey = typeof planningHeaderSlotKeys[number];

export const emptyHeaderNotifications: HeaderNotificationsData = {
  unreadCount: 0,
  items: [],
};

export const emptyPlanningHeaderData: PlanningHeaderData = {
  quickLinks: headerSlot("idle", []),
  calendarEvents: headerSlot("idle", []),
  notifications: headerSlot("idle", emptyHeaderNotifications),
};

type HeaderQuickLinkRow = {
  id: string;
  name: string;
  category: HeaderQuickLink["category"];
  url: string | null;
  preview_image_url: string | null;
};

type HeaderCalendarEventRow = {
  id: number;
  title: string;
  category: HeaderCalendarEvent["category"];
  starts_at: string;
  ends_at: string | null;
  location: string | null;
  status: HeaderCalendarEvent["status"];
};

type HeaderNotificationRow = {
  id: number;
  type: string;
  actor_profile_id: string | null;
  recipient_profile_id: string | null;
  entity_type: string;
  entity_id: string;
  title: string;
  body: string | null;
  created_at: string;
};

type PlanningHeaderProjectionOptions = {
  fmdToolsLoaded?: boolean;
  eventsLoaded?: boolean;
  notificationEventsLoaded?: boolean;
  currentProfileId?: string | null;
  platformRole?: PlatformRole | null;
};

type PlanningHeaderLoadOptions = PlanningHeaderProjectionOptions & {
  data?: PlanningData;
  notificationEventsReconciled?: boolean;
  slots?: readonly PlanningHeaderSlotKey[];
};

function headerSlot<T>(state: HeaderDataSlot<T>["state"], data: T, patch: Omit<HeaderDataSlot<T>, "state" | "data"> = {}): HeaderDataSlot<T> {
  return { state, data, ...patch };
}

export function readyHeaderSlot<T>(data: T, loadedAt?: string): HeaderDataSlot<T> {
  return headerSlot("ready", data, loadedAt ? { loadedAt } : {});
}

function loadingHeaderSlot<T>(slot: HeaderDataSlot<T>): HeaderDataSlot<T> {
  return headerSlot("loading", slot.data);
}

function errorHeaderSlot<T>(slot: HeaderDataSlot<T>, error: string): HeaderDataSlot<T> {
  return headerSlot("error", slot.data, { error });
}

function isHeaderSlot<T>(value: unknown): value is HeaderDataSlot<T> {
  return Boolean(value && typeof value === "object" && "state" in value && "data" in value);
}

function validHeaderState(value: unknown): HeaderDataSlot<unknown>["state"] {
  return value === "loading" || value === "ready" || value === "error" ? value : "idle";
}

function normalizeHeaderSlot<T>(
  value: HeaderDataSlot<T> | T | undefined,
  emptyData: T,
  normalizeData: (data: T | undefined) => T,
): HeaderDataSlot<T> {
  if (isHeaderSlot<T>(value)) {
    return {
      state: validHeaderState(value.state),
      data: normalizeData(value.data),
      ...(value.loadedAt ? { loadedAt: value.loadedAt } : {}),
      ...(value.error ? { error: value.error } : {}),
    };
  }
  if (value !== undefined) return readyHeaderSlot(normalizeData(value as T));
  return headerSlot("idle", emptyData);
}

function normalizeQuickLinks(links: HeaderQuickLink[] | undefined): HeaderQuickLink[] {
  return (links || []).map((link) => ({
    id: link.id,
    name: link.name,
    category: link.category,
    url: link.url,
    previewImageUrl: link.previewImageUrl || "",
  }));
}

function normalizeCalendarEvents(events: HeaderCalendarEvent[] | undefined): HeaderCalendarEvent[] {
  return (events || []).map((event) => ({
    id: event.id,
    title: event.title,
    category: event.category,
    startsAt: event.startsAt,
    endsAt: event.endsAt || event.startsAt,
    location: event.location || "",
    status: event.status,
  }));
}

function normalizeHeaderNotifications(data: HeaderNotificationsData | undefined): HeaderNotificationsData {
  const items = (data?.items || []).map((event) => ({
    id: event.id,
    type: event.type,
    actorProfileId: event.actorProfileId || "",
    recipientProfileId: event.recipientProfileId || "",
    entityType: event.entityType,
    entityId: event.entityId,
    title: event.title,
    body: event.body || "",
    createdAt: event.createdAt,
  }));
  return {
    unreadCount: Number(data?.unreadCount ?? items.length),
    items,
  };
}

export function normalizePlanningHeaderData(value?: Partial<PlanningHeaderData> | null): PlanningHeaderData {
  const legacy = value as Partial<PlanningHeaderData> & { events?: HeaderCalendarEvent[] } | null | undefined;
  return {
    quickLinks: normalizeHeaderSlot(legacy?.quickLinks, [], normalizeQuickLinks),
    calendarEvents: normalizeHeaderSlot(legacy?.calendarEvents ?? legacy?.events, [], normalizeCalendarEvents),
    notifications: normalizeHeaderSlot(legacy?.notifications, emptyHeaderNotifications, normalizeHeaderNotifications),
  };
}

function mapHeaderQuickLink(row: HeaderQuickLinkRow): HeaderQuickLink {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    url: row.url || "",
    previewImageUrl: row.preview_image_url || "",
  };
}

function mapHeaderCalendarEvent(row: HeaderCalendarEventRow): HeaderCalendarEvent {
  return {
    id: row.id,
    title: row.title,
    category: row.category,
    startsAt: row.starts_at,
    endsAt: row.ends_at || row.starts_at,
    location: row.location || "",
    status: row.status,
  };
}

function mapHeaderNotification(row: HeaderNotificationRow): HeaderNotification {
  return {
    id: row.id,
    type: row.type,
    actorProfileId: row.actor_profile_id || "",
    recipientProfileId: row.recipient_profile_id || "",
    entityType: row.entity_type,
    entityId: row.entity_id,
    title: row.title,
    body: row.body || "",
    createdAt: row.created_at,
  };
}

export function projectHeaderQuickLinks(tools: FmdTool[]): HeaderQuickLink[] {
  return [...tools]
    .filter((tool) => tool.isCurated && Boolean(tool.url.trim()))
    .sort((left, right) => left.name.localeCompare(right.name, "de"))
    .slice(0, maxHeaderQuickLinks)
    .map((tool) => ({
      id: tool.id,
      name: tool.name,
      category: tool.category,
      url: tool.url,
      previewImageUrl: tool.previewImageUrl || "",
    }));
}

export function projectHeaderCalendarEvents(events: FounderEvent[]): HeaderCalendarEvent[] {
  return [...events]
    .sort((left, right) => new Date(left.startsAt).getTime() - new Date(right.startsAt).getTime())
    .slice(0, maxHeaderCalendarEvents)
    .map((event) => ({
      id: event.id,
      title: event.title,
      category: event.category,
      startsAt: event.startsAt,
      endsAt: event.endsAt || event.startsAt,
      location: event.location || "",
      status: event.status,
    }));
}

export function projectHeaderNotifications(
  events: NotificationEvent[],
  currentProfileId?: string | null,
  platformRole?: PlatformRole | null,
): HeaderNotificationsData {
  const pending = events
    .filter((event) => event.status === "pending" && !event.seenAt)
    .filter((event) => !currentProfileId
      || event.recipientProfileId === currentProfileId
      || !event.recipientProfileId && Boolean(platformRole && isOperationalLeadRole(platformRole)))
    .sort((left, right) => new Date(right.createdAt).getTime() - new Date(left.createdAt).getTime());
  return {
    unreadCount: pending.length,
    items: pending.slice(0, maxHeaderNotifications).map((event) => ({
      id: event.id,
      type: event.type,
      actorProfileId: event.actorProfileId,
      recipientProfileId: event.recipientProfileId,
      entityType: event.entityType,
      entityId: event.entityId,
      title: event.title,
      body: event.body,
      createdAt: event.createdAt,
    })),
  };
}

export function projectPlanningHeaderData(
  data: PlanningData,
  fallback: PlanningHeaderData = emptyPlanningHeaderData,
  options: PlanningHeaderProjectionOptions = {},
): PlanningHeaderData {
  return {
    quickLinks: options.fmdToolsLoaded ? readyHeaderSlot(projectHeaderQuickLinks(data.fmdTools)) : fallback.quickLinks,
    calendarEvents: options.eventsLoaded ? readyHeaderSlot(projectHeaderCalendarEvents(data.events)) : fallback.calendarEvents,
    notifications: options.notificationEventsLoaded
      ? readyHeaderSlot(projectHeaderNotifications(data.notificationEvents, options.currentProfileId, options.platformRole))
      : fallback.notifications,
  };
}

export function mergePlanningHeaderData(current: PlanningHeaderData, incoming: PlanningHeaderData): PlanningHeaderData {
  return {
    quickLinks: incoming.quickLinks.state === "idle" ? current.quickLinks : incoming.quickLinks,
    calendarEvents: incoming.calendarEvents.state === "idle" ? current.calendarEvents : incoming.calendarEvents,
    notifications: incoming.notifications.state === "idle" ? current.notifications : incoming.notifications,
  };
}

export function markPlanningHeaderDataLoading(current: PlanningHeaderData, slots: readonly PlanningHeaderSlotKey[]): PlanningHeaderData {
  return {
    quickLinks: slots.includes("quickLinks") ? loadingHeaderSlot(current.quickLinks) : current.quickLinks,
    calendarEvents: slots.includes("calendarEvents") ? loadingHeaderSlot(current.calendarEvents) : current.calendarEvents,
    notifications: slots.includes("notifications") ? loadingHeaderSlot(current.notifications) : current.notifications,
  };
}

export function markPlanningHeaderDataError(current: PlanningHeaderData, slots: readonly PlanningHeaderSlotKey[], error: string): PlanningHeaderData {
  return {
    quickLinks: slots.includes("quickLinks") ? errorHeaderSlot(current.quickLinks, error) : current.quickLinks,
    calendarEvents: slots.includes("calendarEvents") ? errorHeaderSlot(current.calendarEvents, error) : current.calendarEvents,
    notifications: slots.includes("notifications") ? errorHeaderSlot(current.notifications, error) : current.notifications,
  };
}

export function idlePlanningHeaderSlots(data: PlanningHeaderData): PlanningHeaderSlotKey[] {
  return planningHeaderSlotKeys.filter((slot) => data[slot].state === "idle");
}

export function parsePlanningHeaderSlots(value: string | null): PlanningHeaderSlotKey[] | null {
  if (!value) return [...planningHeaderSlotKeys];
  const slots = value.split(",").map((slot) => slot.trim()).filter(Boolean);
  if (!slots.length) return [...planningHeaderSlotKeys];
  if (slots.some((slot) => !planningHeaderSlotKeys.includes(slot as PlanningHeaderSlotKey))) return null;
  return [...new Set(slots)] as PlanningHeaderSlotKey[];
}

async function loadHeaderQuickLinks(supabase: SupabaseClient): Promise<HeaderDataSlot<HeaderQuickLink[]>> {
  const result = await supabase
    .from("fmd_tools")
    .select(headerQuickLinkSelect)
    .eq("is_curated", true)
    .not("url", "is", null)
    .neq("url", "")
    .order("name")
    .limit(maxHeaderQuickLinks);
  if (result.error) return errorHeaderSlot(emptyPlanningHeaderData.quickLinks, "Kuratierte Links konnten nicht geladen werden.");
  const links = ((result.data || []) as HeaderQuickLinkRow[]).map(mapHeaderQuickLink).filter((link) => Boolean(link.url.trim()));
  return readyHeaderSlot(links, new Date().toISOString());
}

async function loadHeaderCalendarEvents(supabase: SupabaseClient): Promise<HeaderDataSlot<HeaderCalendarEvent[]>> {
  const result = await supabase
    .from("founder_events")
    .select(headerCalendarEventSelect)
    .order("starts_at", { ascending: true })
    .limit(maxHeaderCalendarEvents);
  if (result.error) return errorHeaderSlot(emptyPlanningHeaderData.calendarEvents, "Kalenderdaten konnten nicht geladen werden.");
  return readyHeaderSlot(((result.data || []) as HeaderCalendarEventRow[]).map(mapHeaderCalendarEvent), new Date().toISOString());
}

async function loadHeaderNotifications(
  supabase: SupabaseClient,
  currentProfileId?: string | null,
  platformRole?: PlatformRole | null,
  notificationEventsReconciled = false,
): Promise<HeaderDataSlot<HeaderNotificationsData>> {
  if (!currentProfileId) return readyHeaderSlot(emptyHeaderNotifications, new Date().toISOString());
  if (!notificationEventsReconciled) {
    await reconcileNotificationEvents(supabase, { currentProfileId, platformRole });
  }
  let query = supabase
    .from("notification_events")
    .select(headerNotificationSelect, { count: "exact" })
    .eq("status", "pending")
    .is("seen_at", null)
    .order("created_at", { ascending: false })
    .limit(maxHeaderNotifications);
  query = platformRole && isOperationalLeadRole(platformRole)
    ? query.or(`recipient_profile_id.eq.${currentProfileId},recipient_profile_id.is.null`)
    : query.eq("recipient_profile_id", currentProfileId);
  const result = await query;
  if (result.error) return errorHeaderSlot(emptyPlanningHeaderData.notifications, "Benachrichtigungen konnten nicht geladen werden.");
  return readyHeaderSlot({
    unreadCount: Number(result.count ?? result.data?.length ?? 0),
    items: ((result.data || []) as HeaderNotificationRow[]).map(mapHeaderNotification),
  }, new Date().toISOString());
}

export async function loadPlanningHeaderData(
  supabase: SupabaseClient,
  options: PlanningHeaderLoadOptions = {},
): Promise<PlanningHeaderData> {
  const requestedSlots = new Set(options.slots || planningHeaderSlotKeys);
  const [quickLinks, calendarEvents, notifications] = await Promise.all([
    requestedSlots.has("quickLinks")
      ? options.fmdToolsLoaded && options.data
        ? Promise.resolve(readyHeaderSlot(projectHeaderQuickLinks(options.data.fmdTools)))
        : loadHeaderQuickLinks(supabase)
      : Promise.resolve(emptyPlanningHeaderData.quickLinks),
    requestedSlots.has("calendarEvents")
      ? options.eventsLoaded && options.data
        ? Promise.resolve(readyHeaderSlot(projectHeaderCalendarEvents(options.data.events)))
        : loadHeaderCalendarEvents(supabase)
      : Promise.resolve(emptyPlanningHeaderData.calendarEvents),
    requestedSlots.has("notifications")
      ? options.notificationEventsLoaded && options.data
        ? Promise.resolve(readyHeaderSlot(projectHeaderNotifications(options.data.notificationEvents, options.currentProfileId, options.platformRole)))
        : loadHeaderNotifications(
          supabase,
          options.currentProfileId,
          options.platformRole,
          options.notificationEventsReconciled,
        )
      : Promise.resolve(emptyPlanningHeaderData.notifications),
  ]);

  return { quickLinks, calendarEvents, notifications };
}
