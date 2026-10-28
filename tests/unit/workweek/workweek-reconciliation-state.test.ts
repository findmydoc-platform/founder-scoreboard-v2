import { expect, test } from "vitest";
import { createPlanningState } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";

const previous = { id: "publication-before", effectiveFrom: "2026-10-26", status: "published" as const, syncState: "confirmed" as const, publicationRevision: 4, publishedAt: "2026-10-26T07:00:00Z", lastSyncAt: "2026-10-26T07:00:00Z", googleReconciliationState: "confirmed" as const, lastGoogleReconciliationAt: "2026-10-26T07:00:00Z" };
const context = { version: null, latestPublished: previous, minimumEffectiveFrom: "2026-11-02" };
const week = { policy: "team-week" as const, from: "2026-10-26", to: "2026-11-01" };
const month = { policy: "header-month" as const, from: "2026-10-26", to: "2026-12-06" };

test.each(["unchanged", "updated"] as const)("%s reconciliation preserves its real synchronization evidence and invalidates calendars only for a published change", async state => {
  const result = { state, lastSuccessfulSyncAt: "2026-10-28T10:00:00Z", recovery: null, effectiveAt: "2026-11-02T00:00:00+01:00", effectiveUntil: "2026-11-09T00:00:00+01:00" };
  const { planning } = createPlanningState({ userId: "account", initialData: emptyPlanningShellState, adapter: {
    saveTask: async () => ({ task: {} }), readWorkspace: async () => null,
    readPrivateWorkweek: async () => ({ status: 200, value: context }),
    reconcilePrivateWorkweek: async () => ({ status: 200, value: { reconciliation: result } }),
    readWorkweekCalendar: async () => ({ currentWorkweeks: [], calendarWorkweeks: [], referenceDate: "2026-10-28" }),
  } });
  await planning.loadPrivateWorkweek(); await planning.loadWorkweekCalendar(week); await planning.loadWorkweekCalendar(month);
  const before = planning.workweekCalendar(week).invalidation;
  await planning.reconcileWorkweek();
  expect(planning.privateWorkweek()).toMatchObject({ context: { latestPublished: previous }, contextRefreshRequired: true,
    reconciliation: { phase: "confirmed", displayedPublication: { id: previous.id, publicationRevision: 4 }, result } });
  expect(planning.workweekCalendar(week).invalidation).toBe(before + (state === "updated" ? 1 : 0));
  expect(planning.workweekCalendar(month).invalidation).toBe(before + (state === "updated" ? 1 : 0));
});

test.each([
  { state: "delayed" as const, recovery: "reconnect" as const, status: 202 },
  { state: "conflict" as const, recovery: "resolve_conflict" as const, status: 409 },
  { state: "delayed" as const, recovery: "restart" as const, status: 202 },
])("$state retains its actual $recovery direction and the last confirmed publication", async ({ state, recovery, status }) => {
  const result = { state, recovery, lastSuccessfulSyncAt: previous.lastSyncAt };
  const { planning } = createPlanningState({ userId: "account", initialData: emptyPlanningShellState, adapter: {
    saveTask: async () => ({ task: {} }), readWorkspace: async () => null,
    readPrivateWorkweek: async () => ({ status: 200, value: context }),
    reconcilePrivateWorkweek: async () => ({ status, value: { reconciliation: result } }),
  } });
  await planning.loadPrivateWorkweek(); await planning.reconcileWorkweek();
  expect(planning.privateWorkweek()).toMatchObject({ context: { latestPublished: previous }, reconciliation: { phase: state, result } });
});

test("a lost reconciliation response is checked with GET only and never confirmed by matching current data", async () => {
  let reads = 0; let writes = 0;
  const { planning } = createPlanningState({ userId: "account", initialData: emptyPlanningShellState, adapter: {
    saveTask: async () => ({ task: {} }), readWorkspace: async () => null,
    readPrivateWorkweek: async () => { reads++; return { status: 200, value: context }; },
    reconcilePrivateWorkweek: async () => { writes++; throw new Error("Antwort verloren"); },
  } });
  await planning.loadPrivateWorkweek(); await planning.reconcileWorkweek();
  expect(planning.privateWorkweek().reconciliation).toMatchObject({ phase: "unconfirmed", displayedPublication: { id: previous.id, publicationRevision: 4 } });
  await planning.loadPrivateWorkweek(); await planning.reconcileWorkweek();
  expect(reads).toBe(2); expect(writes).toBe(1);
  expect(planning.privateWorkweek()).toMatchObject({ contextRefreshRequired: true, reconciliation: { phase: "unconfirmed", checked: true, result: null } });
});

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }

test("one reconciliation owns the request across navigation and an account replacement discards its late result", async () => {
  const pending = deferred<{ status: number; value: { reconciliation: { state: "updated"; lastSuccessfulSyncAt: string; recovery: null } } }>();
  let writes = 0;
  const { planning, internal } = createPlanningState({ userId: "account", initialData: emptyPlanningShellState, adapter: {
    saveTask: async () => ({ task: {} }), readWorkspace: async () => null,
    readPrivateWorkweek: async () => ({ status: 200, value: context }),
    reconcilePrivateWorkweek: async () => { writes++; return pending.promise; },
  } });
  await planning.loadPrivateWorkweek(); const first = planning.reconcileWorkweek();
  await planning.reconcileWorkweek(); expect(writes).toBe(1);
  internal.sessionChanged("other-account");
  pending.resolve({ status: 200, value: { reconciliation: { state: "updated", lastSuccessfulSyncAt: "2026-10-28T10:00:00Z", recovery: null } } }); await first;
  expect(planning.privateWorkweek()).toMatchObject({ context: null, reconciliation: { phase: "idle", displayedPublication: null, result: null } });
});

test("safe verification accepts an actual changed publication and invalidates its calendars once while retaining the unknown reconciliation", async () => {
  let changed = false; let posts = 0;
  const current = { ...previous, id: "confirmed-current", publicationRevision: 1 };
  const { planning } = createPlanningState({ userId: "account", initialData: emptyPlanningShellState, adapter: {
    saveTask: async () => ({ task: {} }), readWorkspace: async () => null,
    readPrivateWorkweek: async () => ({ status: 200, value: { ...context, latestPublished: changed ? current : previous } }),
    reconcilePrivateWorkweek: async () => { posts++; throw new Error("Antwort verloren"); },
    readWorkweekCalendar: async () => ({ currentWorkweeks: [], calendarWorkweeks: [], referenceDate: "2026-10-28" }),
  } });
  await planning.loadPrivateWorkweek(); await planning.loadWorkweekCalendar(week); await planning.loadWorkweekCalendar(month);
  const before = planning.workweekCalendar(week).invalidation;
  await planning.reconcileWorkweek(); changed = true; await planning.loadPrivateWorkweek(); await planning.loadPrivateWorkweek();
  expect(planning.privateWorkweek()).toMatchObject({ context: { latestPublished: current }, reconciliation: { phase: "unconfirmed", displayedPublication: { id: previous.id } } });
  expect(planning.workweekCalendar(week).invalidation).toBe(before + 1);
  expect(planning.workweekCalendar(month).invalidation).toBe(before + 1);
  expect(posts).toBe(1);
});

test("a lower revision inside the same publication identity cannot restore earlier reconciliation context", async () => {
  let revision = 5;
  const { planning } = createPlanningState({ userId: "account", initialData: emptyPlanningShellState, adapter: {
    saveTask: async () => ({ task: {} }), readWorkspace: async () => null,
    readPrivateWorkweek: async () => ({ status: 200, value: { ...context, latestPublished: { ...previous, publicationRevision: revision } } }),
  } });
  await planning.loadPrivateWorkweek(); revision = 4;
  const result = await planning.loadPrivateWorkweek();
  expect(result.status).toBe(409);
  expect(planning.privateWorkweek()).toMatchObject({ contextRefreshRequired: true, readStatus: "stale", context: { latestPublished: { publicationRevision: 5 } } });
});

test("an unavailable refresh retains a confirmed updated outcome while a denied reconciliation withholds its private evidence", async () => {
  let available = true; let denied = false;
  const result = { state: "updated" as const, lastSuccessfulSyncAt: "2026-10-28T10:00:00Z", recovery: null };
  const { planning } = createPlanningState({ userId: "account", initialData: emptyPlanningShellState, adapter: {
    saveTask: async () => ({ task: {} }), readWorkspace: async () => null,
    readPrivateWorkweek: async () => available ? { status: 200, value: context } : { status: 503, value: { error: "Nicht erreichbar" } },
    reconcilePrivateWorkweek: async () => denied ? { status: 403, value: { error: "Kein Zugriff" } } : { status: 200, value: { reconciliation: result } },
  } });
  await planning.loadPrivateWorkweek(); await planning.reconcileWorkweek(); available = false; await planning.loadPrivateWorkweek();
  expect(planning.privateWorkweek()).toMatchObject({ contextRefreshRequired: true, context: { latestPublished: previous }, reconciliation: { phase: "confirmed", result } });
  available = true; await planning.loadPrivateWorkweek(); denied = true; await planning.reconcileWorkweek();
  expect(planning.privateWorkweek()).toMatchObject({ readStatus: "forbidden", context: null, reconciliation: { phase: "idle", displayedPublication: null, result: null } });
});
