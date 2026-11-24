import type { PlanningHeaderData, PlanningShellState, NotificationEvent } from "@/lib/types";
import { emptyPlanningHeaderData, normalizePlanningHeaderData, planningHeaderSlotKeys, type PlanningHeaderSlotKey } from "@/lib/planning-header-data";
import { applyLocalNotificationAction } from "@/lib/notification-lifecycle";
import type { PlanningReadStatus } from "../planning-state";
import type { PlanningNotificationsState, NotificationAction, NotificationActionResult, NotificationOperationView, NotificationReadReceipt, NotificationPreviewReceipt, NotificationCountReceipt, NotificationCountView, NotificationInboxReceipt, NotificationInboxReference, NotificationEntryRead, NotificationEntryOutcome, NotificationSourceObservation, NotificationDemand } from "../planning-notifications-state";
import type { PlanningReadAuthority, PlanningServerHeaderRead, PlanningServerHeaderSlot } from "../planning-server-header-read";
import { unloadedPlatformReleaseReferences, type PlatformReleaseContent, type PlatformReleaseReferenceEntry, type PlatformReleaseReferenceEntryOutcome, type PlatformReleaseReferenceKey, type PlatformReleaseReferenceReceipt, type PlatformReleaseReferenceObservation, type PlatformReleaseReferenceState } from "@/features/platform-releases/model/platform-release-model";

export type HeaderNotificationsAdapter = {
  readHeader?: (slots: readonly PlanningHeaderSlotKey[]) => Promise<PlanningHeaderData & { readAuthority?: PlanningReadAuthority }>;
  observeNotificationSource?: (signal?: AbortSignal) => Promise<NotificationSourceObservation>;
  readNotificationCount?: () => Promise<NotificationCountReceipt>;
  readNotificationPreview?: () => Promise<NotificationPreviewReceipt>;
  readNotificationInbox?: (continuation?: string) => Promise<NotificationInboxReceipt>;
  updateNotification?: (eventId: number, action: NotificationAction) => Promise<{ action: NotificationAction; status: NotificationEvent["status"] }>;
  readPlatformReleases?: () => Promise<PlatformReleaseContent[]>;
  observeReleasePlanningSource?: (signal: AbortSignal) => Promise<PlatformReleaseReferenceObservation>;
  readPlatformReleaseReferences?: (key: PlatformReleaseReferenceKey, signal: AbortSignal) => Promise<PlatformReleaseReferenceReceipt>;
  markPlatformReleaseSeen?: (version: string) => Promise<void>;
};
export function createHeaderNotificationsState(options: {
  initialHeaderData?: PlanningHeaderData; initialData: PlanningShellState; notificationsLoaded: boolean;
  adapter: HeaderNotificationsAdapter; isActive: () => boolean; generation: () => number; changed: () => void;
  refreshNotifications: () => Promise<boolean>;
  serverRead?: PlanningServerHeaderRead;
  notificationEntry?: NotificationEntryRead;
  acceptsNotificationEntry?: (read: NotificationEntryRead) => boolean;
  releaseReferenceEntry?: PlatformReleaseReferenceEntry;
  acceptsReleaseReferenceEntry?: (read: PlatformReleaseReferenceEntry) => boolean;
  acceptsReadAuthority?: (read: PlanningReadAuthority) => boolean;
  acceptsServerRead?: (read: PlanningServerHeaderRead) => boolean;
  acceptsNotificationSource?: (read: NotificationSourceObservation) => boolean;
  acceptsNotificationCount?: (read: NotificationCountReceipt) => boolean;
  acceptsNotificationReceipt?: (read: NotificationReadReceipt) => boolean;
  now: () => number;
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
  let countView: NotificationCountView = { readStatus: "not-loaded", value: null };
  let countReceipt: NotificationCountReceipt | undefined;
  let countRead: { started: number; promise: Promise<boolean> } | undefined;
  const countStarted = () => countRead?.started;
  let previewReceipt: NotificationPreviewReceipt | undefined;
  let previewActive = false;
  const shouldRefreshPreview = () => previewActive || !options.adapter.readNotificationPreview;
  let inboxActive = false;
  const shouldRefreshInbox = () => inboxActive || !options.adapter.readNotificationInbox;
  let inboxReceipt: NotificationInboxReceipt | undefined;
  let inboxInteraction = false;
  let deferredInbox: { receipt: NotificationInboxReceipt; generation: number; started: number } | undefined;
  let inboxRead: { started: number; cursor?: string; promise: Promise<boolean> } | undefined;
  const inboxStarted = () => inboxRead?.started;
  let inboxContinuation: string | null = null;
  let inboxFirstPageSize = 0;
  let furtherReadStatus: PlanningReadStatus = "not-loaded";
  let references: NotificationInboxReference[] = [];
  let referenceCoverage: "complete" | "partial" | "unavailable" = "unavailable";
  let countExpiry: ReturnType<typeof setTimeout> | undefined;
  let previewExpiry: ReturnType<typeof setTimeout> | undefined;
  let inboxExpiry: ReturnType<typeof setTimeout> | undefined;
  function clearCountReceipt() { if (countExpiry) clearTimeout(countExpiry); countExpiry = undefined; countReceipt = undefined; }
  function clearPreviewReceipt() { if (previewExpiry) clearTimeout(previewExpiry); previewExpiry = undefined; previewReceipt = undefined; }
  function clearInboxReceipt() { if (inboxExpiry) clearTimeout(inboxExpiry); inboxExpiry = undefined; inboxReceipt = undefined; }
  function expiration(read: NotificationReadReceipt) { return Math.max(0, Math.min(read.readAuthority.deadline, Date.parse(read.validUntil)) - options.now()); }
  let releases: PlatformReleaseContent[] = [];
  let releaseStatus: PlanningReadStatus = "not-loaded";
  let clock = 0;
  let affectedAt = 0;
  let releaseRead: Promise<boolean> | undefined;
  const slots = Object.fromEntries(planningHeaderSlotKeys.map(key => [key, { readStatus: (header[key].state === "ready" ? header[key].freshness === "stale" ? "stale" : "current" : header[key].state === "error" ? "unavailable" : "not-loaded") as PlanningReadStatus, error: header[key].error || "" }])) as ReturnType<PlanningNotificationsState["header"]>["slots"];
  const headerAuthorities = new Map<PlanningHeaderSlotKey, PlanningReadAuthority>();
  const acceptedHeaderAt = new Map<PlanningHeaderSlotKey, number>();
  const headerReads = new Map<PlanningHeaderSlotKey, { started: number; promise: Promise<boolean> }>();
  const originalServerRead = options.serverRead ? { ...options.serverRead } : undefined;
  let serverTimeout: ReturnType<typeof setTimeout> | undefined;
  const serverReads = new Map<PlanningServerHeaderSlot, { read: PlanningServerHeaderRead; generation: number; started: number; finish: (accepted: boolean) => void }>();
  if (originalServerRead && options.acceptsServerRead?.(originalServerRead)) {
    for (const key of ["quickLinks", "calendarEvents"] as const) {
      const started = ++clock;
      const promise = new Promise<boolean>(finish => { serverReads.set(key, { read: originalServerRead, generation: options.generation(), started, finish }); });
      headerReads.set(key, { started, promise });
      slots[key] = { readStatus: "loading", error: "" };
    }
  }
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
      const state = status === "not-loaded" ? "idle" : status === "loading" || status === "stale" ? header[key].state === "ready" ? "ready" : "loading" : status === "unavailable" || status === "forbidden" ? key === "notifications" && status === "unavailable" && previewReceipt && options.acceptsNotificationReceipt?.(previewReceipt) ? "ready" : "error" : "ready";
      Object.assign(data, { [key]: { ...header[key], state, freshness: status === "current" ? "current" : "stale", error: slots[key].error || undefined } });
    }
    const hidden = new Set([...operations.values()].filter(operation => ["saving", "unconfirmed"].includes(operation.phase)).map(operation => operation.eventId).filter(Boolean));
    if (optimistic && hidden.size) data.notifications = { ...data.notifications, data: { ...data.notifications.data, items: data.notifications.data.items.filter(event => !hidden.has(event.id)) } };
    return { data, slots: { ...slots } };
  }
  function expireHeaderAuthorities() {
    if (previewReceipt && !options.acceptsNotificationReceipt?.(previewReceipt)) {
      clearPreviewReceipt();
      header = { ...header, notifications: { ...header.notifications, state: "idle", data: { ...header.notifications.data, items: [] } } };
      slots.notifications = { readStatus: "stale", error: "" };
    }
    for (const [key, read] of headerAuthorities) if (!options.acceptsReadAuthority?.(read)) {
      headerAuthorities.delete(key);
      header = { ...header, [key]: emptyPlanningHeaderData[key] };
      slots[key] = { readStatus: "not-loaded", error: "" };
    }
  }
  function invalidateNotifications() {
    affectedAt = ++clock;
    clearEntry();
    slots.notifications = { readStatus: "stale", error: "" };
    headerReads.delete("notifications");
    clearPreviewReceipt();
    clearCountReceipt();
    clearInboxReceipt(); deferredInbox = undefined; inboxRead = undefined; inboxContinuation = null; notificationCompleteness = "partial";
    countRead = undefined;
    if (countView.readStatus !== "not-loaded") countView = { readStatus: "stale", value: null };
    if (notificationStatus !== "not-loaded") notificationStatus = "stale";
    if (releaseStatus !== "not-loaded") { releaseStatus = "stale"; releaseRead = undefined; }
  }
  const notificationEntry = options.notificationEntry;
  const entryWaiters = new Map<NotificationEntryOutcome["area"], {
    started: number; generation: number; promise: Promise<boolean>; finish: (accepted: boolean) => void;
  }>();
  let entryTimeout: ReturnType<typeof setTimeout> | undefined;
  function reserveNotificationEntry() {
    if (!notificationEntry || !options.acceptsNotificationEntry?.(notificationEntry)) return;
    for (const area of ["inbox", "count"] as const) {
      const started = ++clock, generation = options.generation();
      let finish!: (accepted: boolean) => void;
      const promise = new Promise<boolean>(resolve => { finish = resolve; });
      entryWaiters.set(area, { started, generation, promise, finish });
    }
    countView = { readStatus: "loading", value: null };
    notificationStatus = "loading";
  }
  reserveNotificationEntry();

  function clearEntry() {
    if (entryTimeout) clearTimeout(entryTimeout);
    entryTimeout = undefined;
    for (const waiter of entryWaiters.values()) waiter.finish(false);
    entryWaiters.clear();
  }
  function applyCount(incoming: NotificationCountReceipt) {
    clearCountReceipt(); countReceipt = incoming;
    countView = { readStatus: "current", value: incoming.unreadCount };
    countExpiry = setTimeout(() => {
      if (countReceipt !== incoming) return;
      clearCountReceipt();
      countView = { readStatus: "stale", value: null };
      options.changed();
    }, expiration(incoming));
    options.changed();
  }
  function validInbox(incoming: NotificationInboxReceipt) {
    return options.acceptsNotificationReceipt?.(incoming) && Array.isArray(incoming.events) && Array.isArray(incoming.references)
      && ["partial", "complete"].includes(incoming.coverage) && ["partial", "complete", "unavailable"].includes(incoming.referenceCoverage)
      && (incoming.coverage === "partial" ? Boolean(incoming.continuation) : incoming.continuation === null)
      && new Set(incoming.events.map(event => event.id)).size === incoming.events.length
      && incoming.references.every(reference => incoming.events.some(event => event.entityId === reference.itemId)
        && reference.title && ["epic", "initiative", "deliverable", "sub_issue"].includes(reference.taskType));
  }
  function applyEntryFailure(area: NotificationEntryOutcome["area"], status: "forbidden" | "unavailable") {
    if (area === "count") countView = { readStatus: status, value: null };
    else {
      if (status === "forbidden") {
        events = []; deliveries = []; references = []; inboxContinuation = null; clearInboxReceipt(); notificationsDenied = true;
      }
      notificationStatus = status;
    }
    options.changed();
  }
  function acceptNotificationEntry(id: string, outcome: NotificationEntryOutcome) {
    const { area, result } = outcome;
    const pending = entryWaiters.get(area);
    if (!notificationEntry || !pending || id !== notificationEntry.id) return false;
    entryWaiters.delete(area);
    if (!entryWaiters.size && entryTimeout) { clearTimeout(entryTimeout); entryTimeout = undefined; }
    if (!current(pending.generation) || pending.started < affectedAt) { pending.finish(false); return false; }
    if (!options.acceptsNotificationEntry?.(notificationEntry) || result.status !== "ready"
      || result.receipt.readAuthority.deadline > notificationEntry.readAuthority.deadline) {
      applyEntryFailure(area, result.status === "forbidden" ? "forbidden" : "unavailable");
      pending.finish(false);
      return false;
    }
    if (area === "count" && options.acceptsNotificationCount?.(result.receipt)) applyCount(result.receipt);
    else if (area === "inbox" && validInbox(result.receipt)) applyInbox(result.receipt);
    else { applyEntryFailure(area, "unavailable"); pending.finish(false); return false; }
    pending.finish(true);
    return true;
  }
  async function refreshNotificationCount(): Promise<boolean> {
    if (!options.isActive() || !options.adapter.readNotificationCount) return false;
    const seeded = entryWaiters.get("count");
    if (seeded && seeded.started >= affectedAt) return seeded.promise;
    if (countRead) return countRead.promise;
    const generation = options.generation(), started = ++clock;
    countView = { readStatus: "loading", value: null };
    options.changed();
    const promise = (async () => {
      try {
        const incoming = await options.adapter.readNotificationCount!();
        if (!current(generation) || countStarted() !== started || started < affectedAt) return false;
        if (!options.acceptsNotificationCount?.(incoming)) throw new Error("Ungelesene Anzahl konnte nicht geprüft werden.");
        applyCount(incoming);
        return true;
      } catch (error) {
        if (!current(generation) || countStarted() !== started || started < affectedAt) return false;
        clearCountReceipt();
        countView = { readStatus: denied(error) ? "forbidden" : "unavailable", value: null };
        options.changed(); return false;
      } finally { if (countStarted() === started) countRead = undefined; }
    })();
    countRead = { started, promise };
    return promise;
  }
  function applyInbox(incoming: NotificationInboxReceipt, cursor?: string) {
    if (!cursor) inboxFirstPageSize = incoming.events.length;
    events = cursor ? [...events, ...incoming.events] : incoming.events;
    references = cursor ? [...references.filter(previous => !incoming.references.some(next => next.itemId === previous.itemId)), ...incoming.references] : incoming.references;
    referenceCoverage = !cursor ? incoming.referenceCoverage : referenceCoverage === "unavailable" || incoming.referenceCoverage === "unavailable" ? "unavailable" : referenceCoverage === "complete" && incoming.referenceCoverage === "complete" ? "complete" : "partial";
    notificationCompleteness = incoming.coverage; inboxContinuation = incoming.continuation;
    clearInboxReceipt(); inboxReceipt = incoming;
    inboxExpiry = setTimeout(() => { if (inboxReceipt === incoming) { clearInboxReceipt(); events = []; references = []; inboxContinuation = null; notificationCompleteness = "partial"; notificationStatus = "stale"; options.changed(); } }, expiration(incoming));
    notificationsDenied = false; notificationStatus = "current"; furtherReadStatus = cursor ? "current" : "not-loaded";
    options.changed();
  }
  async function loadNotificationPage(cursor?: string): Promise<boolean> {
    if (!options.isActive() || !options.adapter.readNotificationInbox) return false;
    const previous = !cursor ? inboxReceipt : undefined;
    const base = cursor ? inboxReceipt : undefined;
    if (cursor && (!base || base.continuation !== cursor || !options.acceptsNotificationReceipt?.(base))) return false;
    const seeded = !cursor ? entryWaiters.get("inbox") : undefined;
    if (seeded && seeded.started >= affectedAt) return seeded.promise;
    if (inboxRead && inboxRead.cursor === cursor) return inboxRead.promise;
    const generation = options.generation(), started = ++clock;
    deferredInbox = undefined;
    if (cursor) furtherReadStatus = "loading"; else { notificationStatus = "loading"; furtherReadStatus = "not-loaded"; }
    options.changed();
    const promise = (async () => {
      try {
        const incoming = await options.adapter.readNotificationInbox!(cursor);
        if (!current(generation) || inboxStarted() !== started || started < affectedAt) return false;
        if (!validInbox(incoming)) throw new Error("Benachrichtigungen konnten nicht geprüft werden.");
        if (base && (inboxReceipt !== base || incoming.sourceRevision !== base.sourceRevision || incoming.observedAt !== base.observedAt || incoming.validUntil !== base.validUntil || incoming.readAuthority.deadline > base.readAuthority.deadline || incoming.events.some(event => events.some(existing => existing.id === event.id)))) throw Object.assign(new Error("Die Liste hat sich geändert."), { status: 409 });
        if (!cursor && previous && inboxReceipt === previous && options.acceptsNotificationReceipt?.(previous) && incoming.sourceRevision === previous.sourceRevision) {
          if (incoming.events.length !== inboxFirstPageSize || JSON.stringify(incoming.events) !== JSON.stringify(events.slice(0, incoming.events.length))) throw new Error("Die Benachrichtigungen konnten nicht konsistent bestätigt werden.");
          notificationStatus = "current"; notificationsDenied = false; options.changed(); return true;
        }
        if (!cursor && inboxInteraction && previous && options.acceptsNotificationReceipt?.(previous) && events.length) {
          deferredInbox = { receipt: incoming, generation, started }; notificationStatus = "stale"; options.changed(); return true;
        }
        applyInbox(incoming, cursor); return true;
      } catch (error) {
        if (!current(generation) || inboxStarted() !== started || started < affectedAt) return false;
        if (denied(error)) { events = []; deliveries = []; references = []; inboxContinuation = null; clearInboxReceipt(); notificationsDenied = true; notificationStatus = "forbidden"; }
        else if (cursor) { furtherReadStatus = "unavailable"; if (typeof error === "object" && error !== null && "status" in error && error.status === 409) { inboxContinuation = null; notificationStatus = "stale"; notificationCompleteness = "partial"; } }
        else notificationStatus = "unavailable";
        options.changed(); return false;
      } finally { if (inboxStarted() === started) inboxRead = undefined; }
    })();
    inboxRead = { started, cursor, promise };
    return promise;
  }
  let sourceRead: { controller: AbortController; signal: AbortSignal; result: Promise<NotificationSourceObservation> } | undefined;
  async function checkNotificationSource(demand: NotificationDemand, signal?: AbortSignal) {
    if (!options.isActive() || signal?.aborted) return;
    const generation = options.generation(), invalidated = affectedAt;
    const scopes = [
      { needed: true, receipt: countReceipt, currentReceipt: () => countReceipt, status: countView.readStatus, refresh: refreshNotificationCount },
      { needed: demand.inbox, receipt: inboxReceipt, currentReceipt: () => inboxReceipt, status: notificationStatus, refresh: options.refreshNotifications },
      { needed: demand.preview && previewActive, receipt: previewReceipt, currentReceipt: () => previewReceipt, status: slots.notifications.readStatus, refresh: () => refreshHeader(["notifications"]) },
    ];
    const checking = scopes.filter(scope => scope.needed && scope.status === "current" && scope.receipt && options.acceptsNotificationReceipt?.(scope.receipt));
    const direct = scopes.filter(scope => scope.needed && scope.status !== "loading" && scope.status !== "forbidden" && !checking.includes(scope));
    const observer = options.adapter.observeNotificationSource;
    const jobs = direct.map(scope => scope.refresh());
    if (!checking.length) { await Promise.all(jobs); return; }
    if (!observer) { await Promise.all([...jobs, ...checking.map(scope => scope.refresh())]); return; }
    let reading = sourceRead;
    if (!reading || reading.signal?.aborted) {
      const controller = new AbortController();
      const observedSignal = signal ? AbortSignal.any([signal, controller.signal]) : controller.signal;
      reading = { controller, signal: observedSignal, result: observer(observedSignal) };
      sourceRead = reading;
    }
    const stillNeeded = () => current(generation) && invalidated === affectedAt && !signal?.aborted;
    try {
      const incoming = await reading.result;
      if (!stillNeeded() || !options.acceptsNotificationSource?.(incoming)) return;
      for (const scope of checking) {
        if (scope.currentReceipt() === scope.receipt && scope.receipt?.sourceRevision !== incoming.sourceRevision) jobs.push(scope.refresh());
      }
      // A known revision change makes retained hidden results stale without reading them.
      if (!demand.inbox && inboxReceipt && inboxReceipt === scopes[1].receipt && inboxReceipt.sourceRevision !== incoming.sourceRevision && notificationStatus === "current") {
        notificationStatus = "stale"; notificationCompleteness = "partial"; inboxContinuation = null;
        options.changed();
      }
      if (!demand.preview && previewReceipt && previewReceipt === scopes[2].receipt && previewReceipt.sourceRevision !== incoming.sourceRevision && slots.notifications.readStatus === "current") {
        slots.notifications = { readStatus: "stale", error: "" };
        options.changed();
      }
    } catch (error) {
      if (stillNeeded() && denied(error)) {
        invalidateNotifications();
        clearEntry();
        events = []; deliveries = []; references = []; referenceCoverage = "unavailable";
        notificationsDenied = true; notificationStatus = "forbidden";
        countView = { readStatus: "forbidden", value: null };
        header = { ...header, notifications: emptyPlanningHeaderData.notifications };
        slots.notifications = { readStatus: "forbidden", error: "Benachrichtigungen dürfen nicht geladen werden." };
        options.changed();
      }
    } finally {
      if (sourceRead === reading) sourceRead = undefined;
      await Promise.all(jobs);
    }
  }

  function acceptHeader(incoming: PlanningHeaderData | undefined, started: number) {
    if (!incoming) return;
    const normalized = normalizePlanningHeaderData(incoming);
    for (const key of planningHeaderSlotKeys) {
      if (started < (acceptedHeaderAt.get(key) || 0) || key === "notifications" && started < affectedAt) continue;
      if (normalized[key].state === "idle") continue;
      headerAuthorities.delete(key);
      acceptedHeaderAt.set(key, started);
      header = { ...header, [key]: normalized[key] };
      slots[key] = { readStatus: normalized[key].state === "error" ? "unavailable" : "current", error: normalized[key].error || "" };
    }
  }
  async function refreshNotificationPreview(): Promise<boolean> {
    if (!options.isActive() || !options.adapter.readNotificationPreview) return false;
    const pending = headerReads.get("notifications");
    if (pending) return pending.promise;
    const generation = options.generation(), started = ++clock;
    slots.notifications = { ...slots.notifications, readStatus: "loading" };
    options.changed();
    const promise = (async () => {
      try {
        const incoming = await options.adapter.readNotificationPreview!();
        if (!current(generation) || headerReads.get("notifications")?.started !== started || started < affectedAt) return false;
        if (!options.acceptsNotificationReceipt?.(incoming) || !Array.isArray(incoming.items)) throw new Error("Benachrichtigungen konnten nicht geprüft werden.");
        clearPreviewReceipt(); previewReceipt = incoming;
        previewExpiry = setTimeout(() => { if (previewReceipt === incoming) { clearPreviewReceipt(); header = { ...header, notifications: { ...header.notifications, state: "idle", data: { ...header.notifications.data, items: [] } } }; slots.notifications = { readStatus: "stale", error: "" }; options.changed(); } }, expiration(incoming));
        acceptedHeaderAt.set("notifications", started);
        header = { ...header, notifications: { state: "ready", data: { ...header.notifications.data, items: incoming.items } } };
        slots.notifications = { readStatus: "current", error: "" };
        options.changed(); return true;
      } catch (error) {
        if (!current(generation) || headerReads.get("notifications")?.started !== started || started < affectedAt) return false;
        const forbidden = denied(error);
        slots.notifications = { readStatus: forbidden ? "forbidden" : "unavailable", error: error instanceof Error ? error.message : "Benachrichtigungen konnten nicht geladen werden." };
        if (forbidden) { clearPreviewReceipt(); header = { ...header, notifications: emptyPlanningHeaderData.notifications }; }
        options.changed(); return false;
      } finally { if (headerReads.get("notifications")?.started === started) headerReads.delete("notifications"); }
    })();
    headerReads.set("notifications", { started, promise });
    return promise;
  }
  async function refreshHeader(requested: readonly PlanningHeaderSlotKey[] = planningHeaderSlotKeys): Promise<boolean> {
    if (requested.includes("notifications") && options.adapter.readNotificationPreview) {
      const others = requested.filter(key => key !== "notifications");
      return (await Promise.all([refreshNotificationPreview(), others.length ? refreshHeader(others) : Promise.resolve(true)])).every(Boolean);
    }
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
        if (incoming.readAuthority && !options.acceptsReadAuthority?.(incoming.readAuthority)) throw Object.assign(new Error("Die ursprüngliche Leseberechtigung ist abgelaufen."), { status: 403 });
        const accepted = pending.filter(key => headerReads.get(key)?.started === started && !(key === "notifications" && started < affectedAt));
        const selected = { ...emptyPlanningHeaderData };
        accepted.forEach(key => Object.assign(selected, { [key]: incoming[key] }));
        acceptHeader(selected, started);
        if (incoming.readAuthority) accepted.forEach(key => headerAuthorities.set(key, { ...incoming.readAuthority! }));
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
  async function refreshAffected(verification = false) {
    await Promise.all([shouldRefreshPreview() ? refreshHeader(["notifications"]) : Promise.resolve(true), countView.readStatus !== "not-loaded" ? refreshNotificationCount() : Promise.resolve(true), notificationStatus !== "not-loaded" && (verification || shouldRefreshInbox()) ? options.refreshNotifications() : Promise.resolve(true), releaseStatus !== "not-loaded" ? loadPlatformReleases() : Promise.resolve(true)]);
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
  // Retain at most the last requested manifest in the existing session owner.
  let releaseReference: { key: PlatformReleaseReferenceKey; state: PlatformReleaseReferenceState; receipt?: PlatformReleaseReferenceReceipt } | undefined;
  let releaseEntry: { read: PlatformReleaseReferenceEntry; generation: number; promise: Promise<boolean>; finish: (accepted: boolean) => void } | undefined;
  let releaseEntryTimeout: ReturnType<typeof setTimeout> | undefined;
  const initialReleaseEntry = options.releaseReferenceEntry;
  if (initialReleaseEntry && options.acceptsReleaseReferenceEntry?.(initialReleaseEntry)) {
    const { promise, resolve } = Promise.withResolvers<boolean>();
    releaseEntry = { read: initialReleaseEntry, generation: options.generation(), promise, finish: resolve };
    releaseReference = { key: initialReleaseEntry.key, state: { status: "loading" } };
  }
  let releaseReferenceRead: { controller: AbortController; promise: Promise<boolean> } | undefined;
  let releaseReferenceSourceRead: { controller: AbortController; signal: AbortSignal; promise: Promise<void> } | undefined;
  let releaseReferenceExpiry: ReturnType<typeof setTimeout> | undefined;
  const releaseReferenceMatches = (key: PlatformReleaseReferenceKey) => releaseReference?.key.version === key.version
    && releaseReference.key.manifestDigest === key.manifestDigest;
  function finishReleaseEntry(accepted: boolean) {
    if (releaseEntryTimeout) clearTimeout(releaseEntryTimeout);
    releaseEntryTimeout = undefined;
    releaseEntry?.finish(accepted);
    releaseEntry = undefined;
  }
  function clearReleasePlanningReferences() {
    finishReleaseEntry(false);
    releaseReferenceRead?.controller.abort();
    releaseReferenceRead = undefined;
    releaseReferenceSourceRead?.controller.abort();
    releaseReferenceSourceRead = undefined;
    if (releaseReferenceExpiry) clearTimeout(releaseReferenceExpiry);
    releaseReferenceExpiry = undefined;
    releaseReference = undefined;
  }
  function releasePlanningReferences(key: PlatformReleaseReferenceKey): PlatformReleaseReferenceState {
    if (!options.isActive() || !releaseReferenceMatches(key) || !releaseReference) return unloadedPlatformReleaseReferences;
    if (releaseReference.receipt && !options.acceptsNotificationSource?.(releaseReference.receipt)) return unloadedPlatformReleaseReferences;
    return releaseReference.state;
  }
  function acceptReleaseReceipt(key: PlatformReleaseReferenceKey, receipt: PlatformReleaseReferenceReceipt) {
    if (!options.acceptsNotificationSource?.(receipt) || receipt.version !== key.version
      || receipt.manifestDigest !== key.manifestDigest || !Array.isArray(receipt.planningReferences)) return false;
    const accepted = { key, state: { status: "ready", planningReferences: receipt.planningReferences }, receipt } satisfies NonNullable<typeof releaseReference>;
    releaseReference = accepted;
    releaseReferenceExpiry = setTimeout(() => {
      if (releaseReference !== accepted) return;
      clearReleasePlanningReferences();
      options.changed();
    }, Math.max(0, receipt.readAuthority.deadline - options.now()));
    return true;
  }
  function acceptReleaseReferenceEntry(id: string, outcome: PlatformReleaseReferenceEntryOutcome) {
    const pending = releaseEntry;
    if (!pending || pending.read.id !== id || !current(pending.generation) || !releaseReferenceMatches(pending.read.key)) return false;
    const { read } = pending;
    const eligible = options.acceptsReleaseReferenceEntry?.(read);
    const accepted = Boolean(eligible && outcome.status === "ready"
      && outcome.receipt.readAuthority.deadline <= read.readAuthority.deadline && acceptReleaseReceipt(read.key, outcome.receipt));
    if (!accepted) {
      const status = outcome.status === "forbidden" || read.readAuthority.deadline <= options.now() ? "forbidden"
        : outcome.status === "stale-manifest" && eligible ? "stale-manifest" : "unavailable";
      releaseReference = { key: read.key, state: { status } };
    }
    finishReleaseEntry(accepted);
    options.changed();
    return accepted;
  }
  function loadReleasePlanningReferences(key: PlatformReleaseReferenceKey): Promise<boolean> {
    const read = options.adapter.readPlatformReleaseReferences;
    if (!options.isActive() || !read || !/^v\d+\.\d+\.\d+$/.test(key.version) || !key.manifestDigest) return Promise.resolve(false);
    if (releaseReferenceMatches(key)) {
      if (releaseEntry) return releaseEntry.promise;
      if (releaseReferenceRead) return releaseReferenceRead.promise;
      const status = releasePlanningReferences(key).status;
      if (status === "ready") return Promise.resolve(true);
      if (status === "forbidden" || status === "stale-manifest") return Promise.resolve(false);
    }
    clearReleasePlanningReferences();
    const controller = new AbortController();
    const generation = options.generation();
    const pending = { key: { version: key.version, manifestDigest: key.manifestDigest }, state: { status: "loading" } } satisfies NonNullable<typeof releaseReference>;
    releaseReference = pending;
    const applies = () => current(generation) && !controller.signal.aborted && releaseReference === pending;
    const promise = (async () => {
      try {
        const receipt = await read(pending.key, controller.signal);
        if (!applies()) return false;
        const accepted = acceptReleaseReceipt(pending.key, receipt);
        if (!accepted) releaseReference = { key: pending.key, state: { status: "unavailable" } };
        options.changed();
        return accepted;
      } catch (error) {
        if (!applies()) return false;
        const manifestChanged = typeof error === "object" && error !== null && "status" in error && error.status === 409
          && "code" in error && error.code === "stale_manifest";
        const status = denied(error) ? "forbidden" : manifestChanged ? "stale-manifest" : "unavailable";
        releaseReference = { key: pending.key, state: { status } };
        options.changed();
        return false;
      } finally {
        if (releaseReferenceRead?.controller === controller) releaseReferenceRead = undefined;
      }
    })();
    releaseReferenceRead = { controller, promise };
    options.changed();
    return promise;
  }
  async function checkReleasePlanningReferences(key: PlatformReleaseReferenceKey, cancel?: AbortSignal) {
    const observe = options.adapter.observeReleasePlanningSource;
    const accepted = releaseReference;
    if (!observe || cancel?.aborted || !accepted?.receipt || releasePlanningReferences(key).status !== "ready") return;
    if (releaseReferenceSourceRead && !releaseReferenceSourceRead.signal.aborted) return releaseReferenceSourceRead.promise;
    const controller = new AbortController();
    const signal = cancel ? AbortSignal.any([cancel, controller.signal]) : controller.signal;
    const generation = options.generation();
    const applies = () => current(generation) && !signal.aborted && releaseReference === accepted;
    const promise = (async () => {
      try {
        const incoming = await observe(signal);
        if (!applies() || !options.acceptsNotificationSource?.(incoming) || incoming.sourceRevision === accepted.receipt?.sourceRevision) return;
        clearReleasePlanningReferences();
        options.changed();
      } catch (error) {
        if (!applies() || !denied(error)) return;
        clearReleasePlanningReferences();
        releaseReference = { key: accepted.key, state: { status: "forbidden" } };
        options.changed();
      } finally {
        if (releaseReferenceSourceRead?.controller === controller) releaseReferenceSourceRead = undefined;
      }
    })();
    releaseReferenceSourceRead = { controller, signal, promise };
    await promise;
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
    await Promise.all([refreshAffected(true), key.startsWith("release:") ? loadPlatformReleases() : Promise.resolve(true)]);
    if (!options.isActive() || operations.get(key) !== operation) return false;
    operation.checking = false; options.changed(); return true;
  }
  const publicState: PlanningNotificationsState = {
    header: () => { options.isActive(); expireHeaderAuthorities(); return headerView(); }, refreshHeader,
    setNotificationPreviewActive(active) { previewActive = active; },
    setNotificationInboxActive(active) { inboxActive = active; },
    acceptServerHeaderSlot(read, key, incoming) {
      const prepared = serverReads.get(key);
      if (!prepared || prepared.read.id !== read.id || prepared.read.userId !== read.userId || prepared.read.sessionRevision !== read.sessionRevision || prepared.read.deadline !== read.deadline || prepared.read.timeoutAt !== read.timeoutAt) return false;
      serverReads.delete(key);
      if (!serverReads.size && serverTimeout) { clearTimeout(serverTimeout); serverTimeout = undefined; }
      const selected = { ...emptyPlanningHeaderData, [key]: incoming[key] };
      const accepted = current(prepared.generation) && options.acceptsServerRead?.(read) === true
        && headerReads.get(key)?.started === prepared.started && prepared.started >= (acceptedHeaderAt.get(key) || 0);
      if (headerReads.get(key)?.started === prepared.started) headerReads.delete(key);
      if (accepted) {
        if (incoming[key].state === "idle") Object.assign(selected, { [key]: { ...emptyPlanningHeaderData[key], state: "error", error: "Header-Daten konnten nicht geladen werden." } });
        acceptHeader(selected, prepared.started);
        headerAuthorities.set(key, prepared.read);
      } else if (slots[key].readStatus === "loading" && !headerReads.has(key)) slots[key] = { readStatus: "not-loaded", error: "" };
      prepared.finish(accepted);
      options.changed();
      return accepted;
    },
    notifications: () => { options.isActive(); return { completeness: notificationCompleteness, events: projectedEvents(), deliveries, readStatus: notificationStatus, continuation: inboxContinuation, furtherReadStatus, references, referenceCoverage, operations: [...operations.values()].filter(value => value.releaseVersion ? !releasesDenied : !notificationsDenied && (!audienceRestricted || events.some(event => event.id === value.eventId) || header.notifications.data.items.some(event => event.id === value.eventId))).map(value => ({ ...value })) }; },
    acceptNotificationEntry,
    checkNotificationSource,
    refreshNotifications: () => options.isActive() ? options.refreshNotifications() : Promise.resolve(false),
    loadNotificationPage,
    setNotificationInteraction(active) {
      inboxInteraction = active;
      if (active || !deferredInbox) return;
      const pending = deferredInbox; deferredInbox = undefined;
      if (current(pending.generation) && pending.started >= affectedAt && options.acceptsNotificationReceipt?.(pending.receipt)) applyInbox(pending.receipt);
    },
    notificationCount: () => {
      if (!options.isActive()) return { readStatus: "not-loaded", value: null };
      if (countReceipt && !options.acceptsNotificationCount?.(countReceipt)) { clearCountReceipt(); countView = { readStatus: "stale", value: null }; }
      return { ...countView };
    },
    refreshNotificationCount,
    updateNotificationStatus: (eventId, actionValue) => action(`notification:${eventId}`, { eventId, action: actionValue, phase: "saving", error: "", checking: false }, async () => {
      if (!options.adapter.updateNotification) throw Object.assign(new Error("Benachrichtigung kann gerade nicht geändert werden."), { status: 400 });
      const result = await options.adapter.updateNotification(eventId, actionValue);
      if (result.action !== actionValue || !["pending","dismissed","resolved","sent","failed"].includes(result.status)) throw new Error("Ob die Änderung übernommen wurde, ist noch unklar.");
      return result;
    }),
    checkNotificationStatus: eventId => check(`notification:${eventId}`),
    releasePlanningReferences,
    loadReleasePlanningReferences,
    checkReleasePlanningReferences,
    acceptReleaseReferenceEntry,
    cancelReleaseReferenceEntry(id) {
      if (releaseEntry?.read.id !== id) return;
      clearReleasePlanningReferences();
      options.changed();
    },
    cancelReleasePlanningReferences(key) {
      if (!releaseReferenceMatches(key)) return;
      if (releaseReferenceRead) { clearReleasePlanningReferences(); options.changed(); }
      else releaseReferenceSourceRead?.controller.abort();
    },
    platformReleases: () => { options.isActive(); return { releases, readStatus: releaseStatus }; }, loadPlatformReleases,
    markPlatformReleaseSeen: version => {
      const previous = operations.get(`release:${version}`);
      if (previous?.phase === "saved") return Promise.resolve({ ok: true, phase: "saved" });
      return action(`release:${version}`, { releaseVersion: version, action: "seen", phase: "saving", error: "", checking: false }, async () => { if (!options.adapter.markPlatformReleaseSeen) throw Object.assign(new Error("Produktaktualisierung kann gerade nicht als gesehen markiert werden."), { status: 400 }); await options.adapter.markPlatformReleaseSeen(version); return {}; });
    },
    checkPlatformReleaseSeen: version => check(`release:${version}`),
  };
  return { publicState,
    clearReleasePlanningReferences,
    dispose() { clearReleasePlanningReferences(); sourceRead?.controller.abort(); sourceRead = undefined; clearEntry(); clearCountReceipt(); clearPreviewReceipt(); clearInboxReceipt(); inboxRead = undefined; deferredInbox = undefined; },
    watchServerRead() {
      if (releaseEntry && !releaseEntryTimeout) {
        const { read } = releaseEntry;
        releaseEntryTimeout = setTimeout(() => acceptReleaseReferenceEntry(read.id, { status: "unavailable" }), Math.max(0, read.timeoutAt - options.now()));
      }
      if (notificationEntry && entryWaiters.size && !entryTimeout) {
        entryTimeout = setTimeout(() => {
          entryTimeout = undefined;
          for (const [area, waiter] of entryWaiters) {
            if (current(waiter.generation) && waiter.started >= affectedAt) applyEntryFailure(area, "unavailable");
            waiter.finish(false);
          }
          entryWaiters.clear();
        }, Math.max(0, notificationEntry.timeoutAt - options.now()));
      }
      if (serverTimeout || !serverReads.size || !originalServerRead) return;
      serverTimeout = setTimeout(() => {
        serverTimeout = undefined;
        for (const [key, prepared] of serverReads) {
          if (current(prepared.generation) && headerReads.get(key)?.started === prepared.started) {
            headerReads.delete(key);
            slots[key] = { readStatus: "unavailable", error: key === "quickLinks" ? "Kuratierte Links konnten nicht geladen werden." : "Kalenderdaten konnten nicht geladen werden." };
          }
          prepared.finish(false);
        }
        serverReads.clear();
        options.changed();
      }, Math.max(0, originalServerRead.timeoutAt - Date.now()));
    },
    deliveryStarted() {
      affectedAt=++clock;
      clearEntry();
      if(slots.notifications.readStatus!=="not-loaded"){slots.notifications={readStatus:"stale",error:""};acceptedHeaderAt.set("notifications",affectedAt);headerReads.delete("notifications");}
      clearPreviewReceipt(); clearCountReceipt(); clearInboxReceipt(); countRead = undefined; inboxRead = undefined; deferredInbox = undefined; inboxContinuation = null; notificationCompleteness = "partial";
      if (countView.readStatus !== "not-loaded") countView = { readStatus: "stale", value: null };
      if(notificationStatus!=="not-loaded")notificationStatus="stale";
      if(releaseStatus!=="not-loaded"){releaseStatus="stale";releaseRead=undefined;}
      options.changed();
    },
    async refreshDeliveryEffects() {
      await Promise.all([slots.notifications.readStatus!=="not-loaded"&&shouldRefreshPreview()?refreshHeader(["notifications"]):Promise.resolve(true),countView.readStatus!=="not-loaded"?refreshNotificationCount():Promise.resolve(true),notificationStatus!=="not-loaded"&&shouldRefreshInbox()?options.refreshNotifications():Promise.resolve(true),releaseStatus!=="not-loaded"?loadPlatformReleases():Promise.resolve(true)]);
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
    confirmedHeader: () => { options.isActive(); expireHeaderAuthorities(); return headerView(false).data; },
    invalidateNotificationAuthority() {
      if (!options.isActive()) return;
      const inboxLoaded = notificationStatus !== "not-loaded";
      const loaded = slots.notifications.readStatus !== "not-loaded" || inboxLoaded || countView.readStatus !== "not-loaded" || [...operations.values()].some(operation => operation.eventId);
      affectedAt = ++clock;
      clearEntry();
      notificationAuthorityGeneration++;
      countRead = undefined; inboxRead = undefined; deferredInbox = undefined; clearCountReceipt(); clearPreviewReceipt(); clearInboxReceipt(); inboxContinuation = null; references = []; referenceCoverage = "unavailable"; notificationCompleteness = "partial";
      if (countView.readStatus !== "not-loaded") countView = { readStatus: "forbidden", value: null };
      for (const operation of operations.values()) if (operation.eventId && operation.phase === "saving") { operation.phase = "unconfirmed"; operation.error = "Der Zugriff hat sich geändert. Ob die Änderung übernommen wurde, ist noch unklar."; }
      acceptedHeaderAt.set("notifications", affectedAt);
      headerReads.delete("notifications");
      audienceRestricted = true;
      notificationsDenied = true;
      events = []; deliveries = [];
      header = { ...header, notifications: emptyPlanningHeaderData.notifications };
      slots.notifications = { readStatus: loaded ? "stale" : "not-loaded", error: "" };
      notificationStatus = inboxLoaded ? "forbidden" : "not-loaded";
      options.changed();
      if (loaded) { if (shouldRefreshPreview()) void refreshHeader(["notifications"]); if (inboxLoaded && shouldRefreshInbox() || !options.adapter.readNotificationPreview) void options.refreshNotifications(); if (countView.readStatus !== "not-loaded") void refreshNotificationCount(); }
    },
    invalidateHeader(keys: readonly PlanningHeaderSlotKey[]) {
      if (!options.isActive()) return;
      const loaded = keys.filter(key => slots[key].readStatus !== "not-loaded");
      const inboxLoaded = notificationStatus !== "not-loaded";
      const countLoaded = countView.readStatus !== "not-loaded";
      const notificationsAffected = keys.includes("notifications") && (loaded.includes("notifications") || inboxLoaded || countLoaded);
      if (!loaded.length && !notificationsAffected) return;
      const invalidated = ++clock;
      if (notificationsAffected) {
        affectedAt = invalidated; clearEntry(); clearPreviewReceipt(); clearCountReceipt(); clearInboxReceipt();
        countRead = undefined; inboxRead = undefined; deferredInbox = undefined; inboxContinuation = null; notificationCompleteness = "partial";
        if (countLoaded) countView = { readStatus: "stale", value: null };
        if (inboxLoaded) notificationStatus = "stale";
      }
      for (const key of loaded) { acceptedHeaderAt.set(key, invalidated); headerReads.delete(key); slots[key] = { readStatus: "stale", error: "" }; }
      options.changed();
      const requested = loaded.filter(key => key !== "notifications" || shouldRefreshPreview());
      if (requested.length) void refreshHeader(requested);
      if (notificationsAffected && countLoaded) void refreshNotificationCount();
      if (notificationsAffected && inboxLoaded && inboxActive) void options.refreshNotifications();
    },
    hydrateHeader(incoming: PlanningHeaderData) { if (!options.isActive()) return; const requested = planningHeaderSlotKeys.filter(key => incoming[key].state !== "idle" && (key !== "notifications" || shouldRefreshPreview())); if (requested.length) void refreshHeader(requested); },
    clear() { clearReleasePlanningReferences(); sourceRead?.controller.abort(); sourceRead = undefined; clearEntry(); if (serverTimeout) clearTimeout(serverTimeout); serverTimeout = undefined; serverReads.forEach(read => read.finish(false)); serverReads.clear(); headerAuthorities.clear(); header = { ...emptyPlanningHeaderData }; events = []; deliveries = []; releases = []; references = []; referenceCoverage = "unavailable"; inboxContinuation = null; inboxInteraction = false; deferredInbox = undefined; furtherReadStatus = "not-loaded"; operations.clear(); requests.clear(); headerReads.clear(); countRead = undefined; inboxRead = undefined; clearCountReceipt(); clearPreviewReceipt(); clearInboxReceipt(); countView = { readStatus: "not-loaded", value: null }; releaseRead = undefined; notificationsDenied = false; releasesDenied = false; audienceRestricted = false; notificationStatus = "not-loaded"; releaseStatus = "not-loaded"; planningHeaderSlotKeys.forEach(key => { slots[key] = { readStatus: "not-loaded", error: "" }; }); },
  };
}
