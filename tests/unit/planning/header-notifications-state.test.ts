import { expect, test } from "vitest";
import { createPlanningState } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { emptyPlanningHeaderData, readyHeaderSlot } from "@/lib/planning-header-data";

function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
test("Header slots retain independent authoritative data and read failures", async () => {
  const { planning } = createPlanningState({ userId: "header-user", initialData: emptyPlanningShellState, initialHeaderData: { ...emptyPlanningHeaderData, quickLinks: readyHeaderSlot([]) }, adapter: {
    saveTask: async () => ({ task: {} }), readWorkspace: async () => null,
    readHeader: async slots => { if (slots.includes("calendarEvents")) throw new Error("Calendar unavailable"); return { ...emptyPlanningHeaderData, notifications: readyHeaderSlot({ unreadCount: 27, items: [] }) }; },
  } });
  await planning.refreshHeader(["notifications"]);
  await planning.refreshHeader(["calendarEvents"]);
  expect(planning.header().slots).toMatchObject({ quickLinks: { readStatus: "current" }, calendarEvents: { readStatus: "unavailable" }, notifications: { readStatus: "current" } });
  expect(planning.header().data.notifications.data.unreadCount).toBe(27);
});

test("an older workspace Header cannot replace a newer accepted slot", async () => {
  const old = deferred<{ data: typeof emptyPlanningShellState; headerData: typeof emptyPlanningHeaderData }>();
  const { planning } = createPlanningState({ userId: "header-user", initialData: emptyPlanningShellState, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: () => old.promise, readHeader: async () => ({ ...emptyPlanningHeaderData, notifications: readyHeaderSlot({ unreadCount: 7, items: [] }) }) } });
  const reading = planning.refreshWorkspace("planning");
  await planning.refreshHeader(["notifications"]);
  old.resolve({ data: emptyPlanningShellState, headerData: { ...emptyPlanningHeaderData, notifications: readyHeaderSlot({ unreadCount: 1, items: [] }) } });
  await reading;
  expect(planning.header().data.notifications.data.unreadCount).toBe(7);
});

const notification = { id: 1, title: "My notification", status: "pending", seenAt: "", dismissedAt: "", resolvedAt: "", resolutionReason: "", recipientProfileId: "profile", actorProfileId: "", entityId: "task", entityType: "task", type: "task_changed", body: "", createdAt: "2026-10-28T00:00:00Z" } satisfies import("@/lib/types").NotificationEvent;
const notificationData = { ...emptyPlanningShellState, notificationEvents: [notification] };
const notificationHeader = { ...emptyPlanningHeaderData, notifications: readyHeaderSlot({ unreadCount: 57, items: [notification] }) };

test("a returned existing status is authoritative while old notification reads and inferred counters are withheld", async () => {
  const old = deferred<{ data: typeof notificationData; headerData: typeof notificationHeader }>();
  const fresh = deferred<typeof notificationHeader>();
  let reads = 0;
  const { planning } = createPlanningState({ userId: "header-user", initialData: notificationData, initialWorkspace: "notifications", initialHeaderData: notificationHeader, adapter: {
    saveTask: async () => ({ task: {} }), readWorkspace: () => ++reads === 1 ? old.promise : new Promise(() => {}), readHeader: () => fresh.promise,
    updateNotification: async (_id, action) => ({ action, status: "resolved" }),
  } });
  const reading = planning.refreshNotifications();
  await expect(planning.updateNotificationStatus(1, "dismiss")).resolves.toMatchObject({ ok: true, status: "resolved" });
  old.resolve({ data: notificationData, headerData: notificationHeader }); await reading;
  expect(planning.notifications().events[0].status).toBe("resolved");
  expect(planning.header().data.notifications.data.unreadCount).toBe(57);
  expect(planning.header().data.notifications.freshness).toBe("stale");
  fresh.resolve({ ...notificationHeader, notifications: readyHeaderSlot({ unreadCount: 56, items: [] }) });
  await planning.refreshHeader(["notifications"]);
  expect(planning.header().data.notifications.data.unreadCount).toBe(56);
  expect(planning.header().slots.notifications.readStatus).toBe("current");
});

test("a known rejection removes its own optimism without undoing another task confirmation", async () => {
  const failed = deferred<{ action: "dismiss"; status: "dismissed" }>();
  const task = { id: "other", title: "Other task", updatedAt: "r1" } as import("@/lib/types").Task;
  const { planning } = createPlanningState({ userId: "header-user", initialData: { ...notificationData, tasks: [task] }, initialWorkspace: "notifications", initialHeaderData: notificationHeader, adapter: {
    saveTask: async () => ({ task: { ...task, title: "Confirmed task", updatedAt: "r2" } }), readWorkspace: async () => null, updateNotification: () => failed.promise,
  } });
  const saving = planning.updateNotificationStatus(1, "dismiss");
  expect(planning.notifications().events[0].status).toBe("dismissed");
  await planning.saveTask(task, { title: "Confirmed task" });
  failed.reject(Object.assign(new Error("Invalid action"), { status: 422 }));
  await expect(saving).resolves.toMatchObject({ phase: "rejected" });
  expect(planning.notifications().events[0].status).toBe("pending");
  expect(planning.taskDetail("other").task?.title).toBe("Confirmed task");
});

test("an unknown notification result keeps its submitted action and checks without replay or inferred confirmation", async () => {
  let writes = 0;
  const { planning } = createPlanningState({ userId: "header-user", initialData: notificationData, initialWorkspace: "notifications", initialHeaderData: notificationHeader, adapter: {
    saveTask: async () => ({ task: {} }), readWorkspace: async () => ({ data: { ...notificationData, notificationEvents: [{ ...notification, status: "dismissed" }] }, notificationCoverage: { events: "complete", deliveries: "complete" } }),
    readHeader: async () => ({ ...notificationHeader, notifications: readyHeaderSlot({ unreadCount: 56, items: [] }) }),
    updateNotification: async () => { writes++; throw new Error("Connection lost"); },
  } });
  await expect(planning.updateNotificationStatus(1, "dismiss")).resolves.toMatchObject({ phase: "unconfirmed" });
  await planning.checkNotificationStatus(1);
  await planning.updateNotificationStatus(1, "dismiss");
  expect(writes).toBe(1);
  expect(planning.notifications().operations).toMatchObject([{ eventId: 1, action: "dismiss", phase: "unconfirmed", checking: false }]);
});

test.each([null, "replacement"])("session end withholds Header, notification and release results (%s)", async replacement => {
  const read = deferred<typeof notificationHeader>();
  const write = deferred<{ action: "dismiss"; status: "dismissed" }>();
  let session!: (account: string | null) => void;
  const { planning } = createPlanningState({ userId: "header-user", initialData: notificationData, initialHeaderData: notificationHeader, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => null, subscribeSession: listener => { session = listener; return () => {}; }, readHeader: () => read.promise, updateNotification: () => write.promise } });
  const reading = planning.refreshHeader(["notifications"]), writing = planning.updateNotificationStatus(1, "dismiss");
  session(replacement); read.resolve(notificationHeader); write.resolve({ action: "dismiss", status: "dismissed" }); await Promise.all([reading, writing]);
  expect(planning.header().data.notifications.data.items).toEqual([]);
  expect(planning.notifications().events).toEqual([]);
  expect(planning.notifications().operations).toEqual([]);
  expect(planning.platformReleases().releases).toEqual([]);
});

test("bounded notification reads preserve omitted records and only explicit complete empty reads clear membership", async () => {
  let complete = false;
  const { planning } = createPlanningState({ userId: "header-user", initialData: notificationData, initialWorkspace: "notifications", adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => ({ data: emptyPlanningShellState, notificationCoverage: { events: complete ? "complete" : "partial", deliveries: "complete" } }) } });
  await planning.refreshNotifications(); expect(planning.notifications().events).toHaveLength(1);
  expect(planning.notifications().completeness).toBe("partial");
  complete = true; await planning.refreshNotifications(); expect(planning.notifications().events).toEqual([]);
  expect(planning.notifications().completeness).toBe("complete");
});

test("release reads coalesce and denied acknowledgement withholds the restricted release projection", async () => {
  const { platformReleaseSeed } = await import("@/features/platform-releases/model/platform-release-seed");
  const pending = deferred<typeof platformReleaseSeed>(); let reads = 0;
  const { planning } = createPlanningState({ userId: "header-user", initialData: emptyPlanningShellState, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => null, readPlatformReleases: () => { reads++; return pending.promise; }, markPlatformReleaseSeen: async () => { throw Object.assign(new Error("Forbidden"), { status: 403 }); } } });
  const first = planning.loadPlatformReleases(), second = planning.loadPlatformReleases();
  pending.resolve(platformReleaseSeed); await Promise.all([first, second]);
  expect(reads).toBe(1); expect(planning.platformReleases().releases).toHaveLength(platformReleaseSeed.length);
  await planning.markPlatformReleaseSeen(platformReleaseSeed[0].version);
  expect(planning.platformReleases().releases).toEqual([]);
  expect(planning.platformReleases().readStatus).toBe("forbidden");
});

test("confirmed release acknowledgement refreshes the shared sidebar and exact Header projection once", async () => {
  const { platformReleaseSeed } = await import("@/features/platform-releases/model/platform-release-seed");
  let seenAt = ""; let writes = 0;
  const { planning } = createPlanningState({ userId: "header-user", initialData: emptyPlanningShellState, initialHeaderData: notificationHeader, adapter: {
    saveTask: async () => ({ task: {} }), readWorkspace: async () => null,
    readPlatformReleases: async () => [{ ...platformReleaseSeed[0], seenAt }],
    markPlatformReleaseSeen: async () => { writes++; seenAt = "2026-10-28T01:00:00Z"; },
    readHeader: async () => ({ ...notificationHeader, notifications: readyHeaderSlot({ unreadCount: 56, items: [] }) }),
  } });
  await planning.loadPlatformReleases(); await planning.markPlatformReleaseSeen(platformReleaseSeed[0].version);
  await Promise.all([planning.loadPlatformReleases(), planning.refreshHeader(["notifications"])]);
  expect(planning.platformReleases().releases[0].seenAt).toBe("2026-10-28T01:00:00Z");
  expect(planning.header().data.notifications.data.unreadCount).toBe(56);
  await planning.markPlatformReleaseSeen(platformReleaseSeed[0].version); expect(writes).toBe(1);
});

test("a lost release acknowledgement remains unconfirmed after matching safe reads and cannot replay on remount", async () => {
  const { platformReleaseSeed } = await import("@/features/platform-releases/model/platform-release-seed");
  let writes = 0;
  const { planning } = createPlanningState({ userId: "header-user", initialData: emptyPlanningShellState, adapter: {
    saveTask: async () => ({ task: {} }), readWorkspace: async () => null,
    readPlatformReleases: async () => [{ ...platformReleaseSeed[0], seenAt: "2026-10-28T01:00:00Z" }],
    markPlatformReleaseSeen: async () => { writes++; throw new Error("Lost response"); },
  } });
  await planning.markPlatformReleaseSeen(platformReleaseSeed[0].version);
  await planning.checkPlatformReleaseSeen(platformReleaseSeed[0].version);
  await planning.markPlatformReleaseSeen(platformReleaseSeed[0].version);
  expect(writes).toBe(1);
  expect(planning.notifications().operations[0]).toMatchObject({ phase: "unconfirmed", releaseVersion: platformReleaseSeed[0].version });
  expect(planning.platformReleases().releases[0].seenAt).toBe("2026-10-28T01:00:00Z");
});

test("an inactive initial owner withholds protected Header hydration", () => {
  const { planning } = createPlanningState({ userId: "", initialData: emptyPlanningShellState, initialHeaderData: notificationHeader, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => null } });
  expect(planning.header().data.notifications.data.items).toEqual([]);
  expect(planning.header().data.notifications.data.unreadCount).toBe(0);
});
