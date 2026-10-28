import type { PlanningHeaderData, PlanningShellState, NotificationEvent } from "@/lib/types";
import { emptyPlanningHeaderData, normalizePlanningHeaderData, planningHeaderSlotKeys, type PlanningHeaderSlotKey } from "@/lib/planning-header-data";
import { applyLocalNotificationAction } from "@/lib/notification-lifecycle";
import type { PlanningReadStatus } from "../planning-state";
import type { PlanningNotificationsState, NotificationAction, NotificationActionResult, NotificationOperationView } from "../planning-notifications-state";
import type { PlatformReleaseRecord } from "@/features/platform-releases/model/platform-release-model";

export type HeaderNotificationsAdapter = {
  readHeader?: (slots: readonly PlanningHeaderSlotKey[]) => Promise<PlanningHeaderData>;
  updateNotification?: (eventId: number, action: NotificationAction) => Promise<{ action: NotificationAction; status: NotificationEvent["status"] }>;
  readPlatformReleases?: () => Promise<PlatformReleaseRecord[]>;
  markPlatformReleaseSeen?: (version: string) => Promise<void>;
};
export function createHeaderNotificationsState(options: {
  initialHeaderData?: PlanningHeaderData; initialData: PlanningShellState; notificationsLoaded: boolean;
  adapter: HeaderNotificationsAdapter; isActive: () => boolean; generation: () => number; changed: () => void;
  refreshNotifications: () => Promise<boolean>;
}) {
  let header = normalizePlanningHeaderData(options.initialHeaderData);
  let events = options.initialData.notificationEvents;
  let deliveries = options.initialData.notificationDeliveries;
  let notificationsDenied = false;
  let audienceRestricted = false;
  let notificationAuthorityGeneration = 0;
  let releasesDenied = false;
  let notificationCompleteness: "complete" | "partial" = "partial";
  let notificationStatus: PlanningReadStatus = options.notificationsLoaded ? "current" : "not-loaded";
  let releases: PlatformReleaseRecord[] = [];
  let releaseStatus: PlanningReadStatus = "not-loaded";
  let clock = 0;
  let affectedAt = 0;
  let releaseRead: Promise<boolean> | undefined;
  const slots = Object.fromEntries(planningHeaderSlotKeys.map(key => [key, { readStatus: (header[key].state === "ready" ? header[key].freshness === "stale" ? "stale" : "current" : header[key].state === "error" ? "unavailable" : "not-loaded") as PlanningReadStatus, error: header[key].error || "" }])) as ReturnType<PlanningNotificationsState["header"]>["slots"];
  const acceptedHeaderAt = new Map<PlanningHeaderSlotKey, number>();
  const headerReads = new Map<PlanningHeaderSlotKey, { started: number; promise: Promise<boolean> }>();
  const operations = new Map<string, NotificationOperationView>();
  const requests = new Map<string, Promise<NotificationActionResult>>();
  const denied = (error: unknown) => typeof error === "object" && error !== null && "status" in error && (error.status === 401 || error.status === 403);
  const current = (generation: number) => options.isActive() && generation === options.generation();
  function projectedEvents() {
    let next = events;
    for (const operation of operations.values()) if (operation.eventId && ["saving", "unconfirmed"].includes(operation.phase)) next = next.map(event => event.id === operation.eventId ? applyLocalNotificationAction(event, operation.action) : event);
    return next;
  }
  function headerView(optimistic = true) {
    const data = { ...header };
    for (const key of planningHeaderSlotKeys) {
      const status = slots[key].readStatus;
      const state = status === "not-loaded" ? "idle" : status === "loading" || status === "stale" ? header[key].state === "ready" ? "ready" : "loading" : status === "unavailable" || status === "forbidden" ? "error" : "ready";
      Object.assign(data, { [key]: { ...header[key], state, freshness: status === "current" ? "current" : "stale", error: slots[key].error || undefined } });
    }
    const hidden = new Set([...operations.values()].filter(operation => ["saving", "unconfirmed"].includes(operation.phase)).map(operation => operation.eventId).filter(Boolean));
    if (optimistic && hidden.size) data.notifications = { ...data.notifications, data: { ...data.notifications.data, items: data.notifications.data.items.filter(event => !hidden.has(event.id)) } };
    return { data, slots: { ...slots } };
  }
  function invalidateNotifications() {
    affectedAt = ++clock;
    slots.notifications = { readStatus: "stale", error: "" };
    headerReads.delete("notifications");
    if (notificationStatus !== "not-loaded") notificationStatus = "stale";
    if (releaseStatus !== "not-loaded") { releaseStatus = "stale"; releaseRead = undefined; }
  }
  function acceptHeader(incoming: PlanningHeaderData | undefined, started: number) {
    if (!incoming) return;
    const normalized = normalizePlanningHeaderData(incoming);
    for (const key of planningHeaderSlotKeys) {
      if (started < (acceptedHeaderAt.get(key) || 0) || key === "notifications" && started < affectedAt) continue;
      if (normalized[key].state === "idle") continue;
      acceptedHeaderAt.set(key, started);
      header = { ...header, [key]: normalized[key] };
      slots[key] = { readStatus: normalized[key].state === "error" ? "unavailable" : "current", error: normalized[key].error || "" };
    }
  }
  async function refreshHeader(requested: readonly PlanningHeaderSlotKey[] = planningHeaderSlotKeys): Promise<boolean> {
    if (!options.isActive() || !options.adapter.readHeader) return false;
    const pending = requested.filter(key => !headerReads.has(key));
    const existing = requested.flatMap(key => headerReads.get(key)?.promise || []);
    if (!pending.length) return (await Promise.all(existing)).every(Boolean);
    const generation = options.generation();
    const started = ++clock;
    pending.forEach(key => { slots[key] = { ...slots[key], readStatus: "loading" }; });
    options.changed();
    const promise = (async () => {
      try {
        const incoming = await options.adapter.readHeader!(pending);
        if (!current(generation)) return false;
        const accepted = pending.filter(key => headerReads.get(key)?.started === started && !(key === "notifications" && started < affectedAt));
        const selected = { ...emptyPlanningHeaderData };
        accepted.forEach(key => Object.assign(selected, { [key]: incoming[key] }));
        acceptHeader(selected, started);
        accepted.filter(key => incoming[key].state === "idle").forEach(key => { slots[key] = { readStatus: "unavailable", error: "Kalender und Benachrichtigungen konnten nicht geladen werden." }; });
        options.changed();
        return accepted.length === pending.length;
      } catch (error) {
        if (!current(generation)) return false;
        for (const key of pending) if (headerReads.get(key)?.started === started && started >= (acceptedHeaderAt.get(key) || 0) && !(key === "notifications" && started < affectedAt)) {
          const forbidden = denied(error);
          slots[key] = { readStatus: forbidden ? "forbidden" : "unavailable", error: error instanceof Error ? error.message : "Kalender und Benachrichtigungen konnten nicht geladen werden." };
          if (forbidden) Object.assign(header, { [key]: emptyPlanningHeaderData[key] });
        }
        options.changed(); return false;
      } finally { pending.forEach(key => { if (headerReads.get(key)?.started === started) headerReads.delete(key); }); }
    })();
    pending.forEach(key => headerReads.set(key, { started, promise }));
    return (await Promise.all([...existing, promise])).every(Boolean);
  }
  async function refreshAffected() {
    await Promise.all([refreshHeader(["notifications"]), notificationStatus !== "not-loaded" ? options.refreshNotifications() : Promise.resolve(true), releaseStatus !== "not-loaded" ? loadPlatformReleases() : Promise.resolve(true)]);
  }
  function action(key: string, operation: NotificationOperationView, execute: () => Promise<{ status?: NotificationEvent["status"] }>): Promise<NotificationActionResult> {
    if (!options.isActive()) return Promise.resolve({ ok: false, phase: "session-ended" });
    if (operation.eventId && notificationsDenied || operation.releaseVersion && releasesDenied) return Promise.resolve({ ok: false, phase: "rejected", error: "Kein Zugriff auf diesen Bereich." });
    if (operations.get(key)?.phase === "unconfirmed") return Promise.resolve({ ok: false, phase: "unconfirmed", error: "Das Ergebnis ist noch unklar." });
    const pending = requests.get(key); if (pending) return pending;
    const generation = options.generation();
    const authority = notificationAuthorityGeneration;
    const acceptsOperation = () => current(generation) && (!operation.eventId || authority === notificationAuthorityGeneration);
    operations.set(key, operation); invalidateNotifications(); options.changed();
    const result = (async (): Promise<NotificationActionResult> => {
      try {
        const saved = await execute();
        if (!acceptsOperation()) return { ok: false, phase: "session-ended" };
        operation.phase = "saved";
        if (operation.eventId && saved.status) events = events.map(event => event.id === operation.eventId ? { ...event, status: saved.status! } : event);
        invalidateNotifications(); options.changed();
        void refreshAffected();
        return { ok: true, phase: "saved", status: saved.status };
      } catch (error) {
        if (!acceptsOperation()) return { ok: false, phase: "session-ended" };
        const status = typeof error === "object" && error !== null && "status" in error ? Number(error.status) : 0;
        operation.phase = [400,401,403,404,422].includes(status) ? "rejected" : "unconfirmed";
        operation.error = error instanceof Error ? error.message : "Benachrichtigung konnte nicht aktualisiert werden.";
        if (denied(error)) {
          if (operation.releaseVersion) { releases = []; releasesDenied = true; releaseStatus = "forbidden"; }
          else { events = []; deliveries = []; notificationsDenied = true; notificationStatus = "forbidden"; header.notifications = emptyPlanningHeaderData.notifications; slots.notifications = { readStatus: "forbidden", error: operation.error }; }
          operations.delete(key);
        }
        options.changed();
        return { ok: false, phase: operation.phase, error: operation.error };
      }
    })();
    requests.set(key, result);
    void result.finally(() => { if (requests.get(key) === result) requests.delete(key); });
    return result;
  }
  async function loadPlatformReleases(): Promise<boolean> {
    if (!options.isActive() || !options.adapter.readPlatformReleases) return false;
    if (releaseRead) return releaseRead;
    const generation = options.generation(), started = ++clock;
    releaseStatus = "loading"; options.changed();
    const read = (async () => {
      try { const next = await options.adapter.readPlatformReleases!(); if (!current(generation) || started < affectedAt) return false; releases = next; releasesDenied = false; releaseStatus = "current"; options.changed(); return true; }
      catch (error) { if (!current(generation) || started < affectedAt) return false; releaseStatus = denied(error) ? "forbidden" : "unavailable"; if (denied(error)) { releases = []; releasesDenied = true; } options.changed(); return false; }
    })();
    releaseRead = read;
    void read.finally(() => { if (releaseRead === read) releaseRead = undefined; });
    return read;
  }
  async function check(key: string) {
    const operation = operations.get(key); if (!operation || operation.phase !== "unconfirmed" || !options.isActive()) return false;
    operation.checking = true; options.changed();
    await Promise.all([refreshAffected(), key.startsWith("release:") ? loadPlatformReleases() : Promise.resolve(true)]);
    if (!options.isActive() || operations.get(key) !== operation) return false;
    operation.checking = false; options.changed(); return true;
  }
  const publicState: PlanningNotificationsState = {
    header: () => { options.isActive(); return headerView(); }, refreshHeader,
    notifications: () => { options.isActive(); return { completeness: notificationCompleteness, events: projectedEvents(), deliveries, readStatus: notificationStatus, operations: [...operations.values()].filter(value => value.releaseVersion ? !releasesDenied : !notificationsDenied && (!audienceRestricted || events.some(event => event.id === value.eventId) || header.notifications.data.items.some(event => event.id === value.eventId))).map(value => ({ ...value })) }; },
    refreshNotifications: () => options.isActive() ? options.refreshNotifications() : Promise.resolve(false),
    updateNotificationStatus: (eventId, actionValue) => action(`notification:${eventId}`, { eventId, action: actionValue, phase: "saving", error: "", checking: false }, async () => {
      if (!options.adapter.updateNotification) throw Object.assign(new Error("Benachrichtigung kann gerade nicht geändert werden."), { status: 400 });
      const result = await options.adapter.updateNotification(eventId, actionValue);
      if (result.action !== actionValue || !["pending","dismissed","resolved","sent","failed"].includes(result.status)) throw new Error("Ob die Änderung übernommen wurde, ist noch unklar.");
      return result;
    }),
    checkNotificationStatus: eventId => check(`notification:${eventId}`),
    platformReleases: () => { options.isActive(); return { releases, readStatus: releaseStatus }; }, loadPlatformReleases,
    markPlatformReleaseSeen: version => {
      const previous = operations.get(`release:${version}`);
      if (previous?.phase === "saved") return Promise.resolve({ ok: true, phase: "saved" });
      return action(`release:${version}`, { releaseVersion: version, action: "seen", phase: "saving", error: "", checking: false }, async () => { if (!options.adapter.markPlatformReleaseSeen) throw Object.assign(new Error("Produktaktualisierung kann gerade nicht als gesehen markiert werden."), { status: 400 }); await options.adapter.markPlatformReleaseSeen(version); return {}; });
    },
    checkPlatformReleaseSeen: version => check(`release:${version}`),
  };
  return { publicState,
    deliveryStarted() {
      affectedAt=++clock;
      if(slots.notifications.readStatus!=="not-loaded"){slots.notifications={readStatus:"stale",error:""};acceptedHeaderAt.set("notifications",affectedAt);headerReads.delete("notifications");}
      if(notificationStatus!=="not-loaded")notificationStatus="stale";
      if(releaseStatus!=="not-loaded"){releaseStatus="stale";releaseRead=undefined;}
      options.changed();
    },
    async refreshDeliveryEffects() {
      await Promise.all([slots.notifications.readStatus!=="not-loaded"?refreshHeader(["notifications"]):Promise.resolve(true),notificationStatus!=="not-loaded"?options.refreshNotifications():Promise.resolve(true),releaseStatus!=="not-loaded"?loadPlatformReleases():Promise.resolve(true)]);
    },
    beginWorkspaceRead(workspace: string) { const started = ++clock; if (workspace === "notifications") notificationStatus = "loading"; return started; },
    acceptWorkspaceRead(workspace: string, data: PlanningShellState, headerData: PlanningHeaderData | undefined, started: number, coverage?: import("@/features/notifications/model/notifications-read-model").NotificationsWorkspaceModel["coverage"]) {
      acceptHeader(headerData, started);
      if (workspace === "notifications" && started >= affectedAt) { const merge = <T extends { id: number }>(before: T[], next: T[], complete: boolean) => complete ? next : [...before.filter(item => !next.some(row => row.id === item.id)), ...next];
        events = merge(events, data.notificationEvents, coverage?.events === "complete");
        deliveries = coverage?.deliveries === "forbidden" ? [] : merge(deliveries, data.notificationDeliveries, coverage?.deliveries === "complete");
        notificationsDenied = false;
        notificationCompleteness = coverage?.events === "complete" ? "complete" : "partial";
        notificationStatus = "current"; }
    },
    workspaceFailed(workspace: string, error: unknown) { if (workspace !== "notifications") return; notificationStatus = denied(error) ? "forbidden" : "unavailable"; if (denied(error)) { events = []; deliveries = []; notificationsDenied = true; header.notifications = emptyPlanningHeaderData.notifications; slots.notifications = { readStatus: "forbidden", error: "Kein Zugriff auf Benachrichtigungen." }; } },
    projectConfirmed(data: PlanningShellState) { return { ...data, notificationEvents: events, notificationDeliveries: deliveries }; },
    projectVisible(data: PlanningShellState) { return { ...data, notificationEvents: projectedEvents(), notificationDeliveries: deliveries }; },
    confirmedHeader: () => headerView(false).data,
    invalidateNotificationAuthority() {
      if (!options.isActive()) return;
      const loaded = slots.notifications.readStatus !== "not-loaded" || notificationStatus !== "not-loaded" || [...operations.values()].some(operation => operation.eventId);
      affectedAt = ++clock;
      notificationAuthorityGeneration++;
      for (const operation of operations.values()) if (operation.eventId && operation.phase === "saving") { operation.phase = "unconfirmed"; operation.error = "Der Zugriff hat sich geändert. Ob die Änderung übernommen wurde, ist noch unklar."; }
      acceptedHeaderAt.set("notifications", affectedAt);
      headerReads.delete("notifications");
      audienceRestricted = true;
      notificationsDenied = true;
      events = []; deliveries = [];
      header = { ...header, notifications: emptyPlanningHeaderData.notifications };
      slots.notifications = { readStatus: loaded ? "stale" : "not-loaded", error: "" };
      notificationStatus = loaded ? "forbidden" : "not-loaded";
      options.changed();
      if (loaded) { void refreshHeader(["notifications"]); void options.refreshNotifications(); }
    },
    invalidateHeader(keys: readonly PlanningHeaderSlotKey[]) {
      const loaded = keys.filter(key => slots[key].readStatus !== "not-loaded");
      if (!loaded.length || !options.isActive()) return;
      const invalidated = ++clock;
      if (loaded.includes("notifications")) { affectedAt = invalidated; if (notificationStatus !== "not-loaded") notificationStatus = "stale"; }
      for (const key of loaded) { acceptedHeaderAt.set(key, invalidated); headerReads.delete(key); slots[key] = { readStatus: "stale", error: "" }; }
      options.changed();
      void refreshHeader(loaded);
    },
    hydrateHeader(incoming: PlanningHeaderData) { if (!options.isActive()) return; if (planningHeaderSlotKeys.some(key => incoming[key].state !== "idle")) { void refreshHeader(planningHeaderSlotKeys.filter(key => incoming[key].state !== "idle")); } },
    clear() { header = { ...emptyPlanningHeaderData }; events = []; deliveries = []; releases = []; operations.clear(); requests.clear(); headerReads.clear(); releaseRead = undefined; notificationsDenied = false; releasesDenied = false; audienceRestricted = false; notificationStatus = "not-loaded"; releaseStatus = "not-loaded"; planningHeaderSlotKeys.forEach(key => { slots[key] = { readStatus: "not-loaded", error: "" }; }); },
  };
}
