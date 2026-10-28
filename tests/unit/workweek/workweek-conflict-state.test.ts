import { expect, test } from "vitest";
import { createPlanningState } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import type { TeamWorkweekConflict } from "@/features/team-workweek/model/team-workweek-draft";

const conflict: TeamWorkweekConflict = { id: "conflict", conflictRevision: 3, state: "open", decision: null, observedAt: "2026-10-28T10:00:00Z", founderops: { effectiveFrom: "2026-11-02", supported: true, windows: [{ weekday: 1, startMinute: 540, endMinute: 1020 }] }, google: { effectiveFrom: "2026-11-02", supported: true, windows: [{ weekday: 1, startMinute: 660, endMinute: 1020 }] } };
const context = { version: null, minimumEffectiveFrom: "2026-11-02" };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }

test("private editing context and a concurrent conflict consumer share one conflict read", async () => {
  const pending = deferred<{ status: number; value: { conflict: TeamWorkweekConflict | null } }>(); let reads = 0;
  const { planning } = createPlanningState({ userId: "account", initialData: emptyPlanningShellState, adapter: {
    saveTask: async () => ({ task: {} }), readWorkspace: async () => null,
    readPrivateWorkweek: async () => ({ status: 200, value: context }),
    readWorkweekConflict: async () => { reads++; return pending.promise; },
  } });
  const editing = planning.loadPrivateWorkweek(); const second = planning.loadWorkweekConflict();
  pending.resolve({ status: 200, value: { conflict } }); await Promise.all([editing, second]);
  expect(reads).toBe(1);
  expect(planning.privateWorkweek()).toMatchObject({ readStatus: "current", context, conflict, conflictReadStatus: "current" });
});

test("a failed conflict read cannot replace the previously accepted complete editing context", async () => {
  let failed = false;
  const { planning } = createPlanningState({ userId: "account", initialData: emptyPlanningShellState, adapter: {
    saveTask: async () => ({ task: {} }), readWorkspace: async () => null,
    readPrivateWorkweek: async () => ({ status: 200, value: { ...context, minimumEffectiveFrom: failed ? "2026-11-09" : "2026-11-02" } }),
    readWorkweekConflict: async () => failed ? { status: 503, value: { error: "Konflikt nicht erreichbar" } } : { status: 200, value: { conflict } },
  } });
  await planning.loadPrivateWorkweek(); failed = true; await planning.loadPrivateWorkweek();
  expect(planning.privateWorkweek()).toMatchObject({ context, contextRefreshRequired: true, conflict, conflictReadStatus: "unavailable" });
});

test("a background revision cannot authorize the displayed earlier choice and unsupported variants never enter the decision adapter", async () => {
  let current = conflict; let posts = 0;
  const { planning } = createPlanningState({ userId: "account", initialData: emptyPlanningShellState, adapter: {
    saveTask: async () => ({ task: {} }), readWorkspace: async () => null,
    readPrivateWorkweek: async () => ({ status: 200, value: context }), readWorkweekConflict: async () => ({ status: 200, value: { conflict: current } }),
    resolveWorkweekConflict: async () => { posts++; return { status: 202, value: { publication: { status: "preparing", recovery: "retry" } } }; },
  } });
  await planning.loadPrivateWorkweek(); current = { ...conflict, conflictRevision: 4 }; await planning.loadWorkweekConflict();
  const stale = await planning.resolveWorkweekConflict(conflict, "google");
  expect(stale.status).toBe(409); expect(posts).toBe(0);
  expect(planning.privateWorkweek().conflictDecision).toMatchObject({ phase: "stale", submitted: { conflictId: conflict.id, conflictRevision: 3, decision: "google" } });
  current = { ...current, google: { ...current.google, supported: false } }; await planning.loadWorkweekConflict();
  await planning.resolveWorkweekConflict(current, "google"); expect(posts).toBe(0);
});

test.each(["preparing", "published"] as const)("a %s decision retains its actual result and invalidates calendars only when publication confirms", async status => {
  const publication = { status, recovery: status === "preparing" ? "retry" as const : null, effectiveAt: "2026-11-02T00:00:00+01:00" };
  const { planning } = createPlanningState({ userId: "account", initialData: emptyPlanningShellState, adapter: {
    saveTask: async () => ({ task: {} }), readWorkspace: async () => null,
    readPrivateWorkweek: async () => ({ status: 200, value: context }), readWorkweekConflict: async () => ({ status: 200, value: { conflict } }),
    resolveWorkweekConflict: async () => ({ status: status === "published" ? 200 : 202, value: { publication } }),
    readWorkweekCalendar: async () => ({ currentWorkweeks: [], calendarWorkweeks: [], referenceDate: "2026-10-28" }),
  } });
  const scope = { policy: "team-week" as const, from: "2026-10-26", to: "2026-11-01" };
  await planning.loadPrivateWorkweek(); await planning.loadWorkweekCalendar(scope); const before = planning.workweekCalendar(scope).invalidation;
  await planning.resolveWorkweekConflict(conflict, "founderops");
  expect(planning.privateWorkweek()).toMatchObject({ conflictDecision: { phase: status, result: publication, basis: conflict }, contextRefreshRequired: true });
  expect(planning.workweekCalendar(scope).invalidation).toBe(before + (status === "published" ? 1 : 0));
  expect(planning.privateWorkweek().conflict).toEqual(status === "published" ? null : conflict);
});

test.each([0, 409])("unknown decision result %s survives a GET-only check without replay or matching proof", async status => {
  let posts = 0; let current: TeamWorkweekConflict | null = conflict;
  const { planning } = createPlanningState({ userId: "account", initialData: emptyPlanningShellState, adapter: {
    saveTask: async () => ({ task: {} }), readWorkspace: async () => null,
    readPrivateWorkweek: async () => ({ status: 200, value: context }), readWorkweekConflict: async () => ({ status: 200, value: { conflict: current } }),
    resolveWorkweekConflict: async () => { posts++; if (!status) throw new Error("Antwort verloren"); return { status, value: { code: "session_superseded", error: "Antwort gehört nicht mehr zum aktuellen Zugriff" } }; },
  } });
  await planning.loadPrivateWorkweek(); await planning.resolveWorkweekConflict(conflict, "google");
  current = null; await planning.loadPrivateWorkweek(); await planning.resolveWorkweekConflict(conflict, "google");
  expect(posts).toBe(1);
  expect(planning.privateWorkweek().conflictDecision).toMatchObject({ phase: "unconfirmed", checked: true, submitted: { conflictRevision: 3, decision: "google" }, basis: conflict });
});

test("a preparing choice cannot be replaced by the other choice, and a matching resolving GET authorizes only deliberate continuation", async () => {
  let posts = 0; let current = conflict;
  const publication = { status: "preparing" as const, recovery: "retry" as const };
  const { planning } = createPlanningState({ userId: "account", initialData: emptyPlanningShellState, adapter: {
    saveTask: async () => ({ task: {} }), readWorkspace: async () => null,
    readPrivateWorkweek: async () => ({ status: 200, value: context }), readWorkweekConflict: async () => ({ status: 200, value: { conflict: current } }),
    resolveWorkweekConflict: async () => { posts++; return { status: 202, value: { publication } }; },
  } });
  await planning.loadPrivateWorkweek(); await planning.resolveWorkweekConflict(conflict, "google");
  current = { ...conflict, state: "resolving", decision: "google" }; await planning.loadPrivateWorkweek();
  await planning.resolveWorkweekConflict(current, "founderops");
  expect(posts).toBe(1); expect(planning.privateWorkweek().conflictDecision).toMatchObject({ phase: "preparing", result: publication, submitted: { decision: "google" } });
  await planning.resolveWorkweekConflict(current, "google"); expect(posts).toBe(2);
});

test("confirmed resolution cannot be resurrected by an older conflict row and a denied conflict read leaves private context authorized", async () => {
  let denied = false;
  const { planning } = createPlanningState({ userId: "account", initialData: emptyPlanningShellState, adapter: {
    saveTask: async () => ({ task: {} }), readWorkspace: async () => null,
    readPrivateWorkweek: async () => ({ status: 200, value: context }), readWorkweekConflict: async () => denied ? { status: 403, value: { error: "Kein Konfliktzugriff" } } : { status: 200, value: { conflict } },
    resolveWorkweekConflict: async () => ({ status: 200, value: { publication: { status: "published", recovery: null } } }),
  } });
  await planning.loadPrivateWorkweek(); await planning.resolveWorkweekConflict(conflict, "google");
  await planning.loadWorkweekConflict(); expect(planning.privateWorkweek().conflict).toBeNull();
  denied = true; await planning.loadWorkweekConflict();
  expect(planning.privateWorkweek()).toMatchObject({ context, conflict: null, conflictReadStatus: "forbidden", conflictDecision: { basis: null, submitted: null } });
});

test("an account replacement rejects a late decision receipt", async () => {
  const pending = deferred<{ status: number; value: { publication: { status: "published"; recovery: null } } }>();
  const { planning, internal } = createPlanningState({ userId: "account", initialData: emptyPlanningShellState, adapter: {
    saveTask: async () => ({ task: {} }), readWorkspace: async () => null,
    readPrivateWorkweek: async () => ({ status: 200, value: context }), readWorkweekConflict: async () => ({ status: 200, value: { conflict } }),
    resolveWorkweekConflict: async () => pending.promise,
  } });
  await planning.loadPrivateWorkweek(); const write = planning.resolveWorkweekConflict(conflict, "google"); internal.sessionChanged("other");
  pending.resolve({ status: 200, value: { publication: { status: "published", recovery: null } } }); await write;
  expect(planning.privateWorkweek()).toMatchObject({ context: null, conflict: null, conflictDecision: { phase: "idle", basis: null, submitted: null } });
});


test.each(["linked", "different-publication", "partial-receipt"] as const)("a %s conflict receipt confirms only the publication attempt that actual identities cover", async mode => {
  const receipt = { id: mode === "different-publication" ? "another-attempt" : "attempt", status: "published" as const, recovery: null, syncState: "confirmed" as const, publicationRevision: 2, publishedAt: "2026-10-28T11:00:00Z", lastSyncAt: "2026-10-28T11:00:00Z" };
  let publications = 0;
  const { planning } = createPlanningState({ userId: "account", initialData: emptyPlanningShellState, adapter: {
    saveTask: async () => ({ task: {} }), readWorkspace: async () => null,
    readPrivateWorkweek: async () => ({ status: 200, value: { ...context, pendingPublication: { id: "attempt", sourceVersionId: "private-version", effectiveFrom: "2026-11-02", resumeAllowed: false } } }),
    readWorkweekConflict: async () => ({ status: 200, value: { conflict } }),
    publishPrivateWorkweek: async () => { publications++; throw new Error("Antwort verloren"); },
    resolveWorkweekConflict: async () => ({ status: 200, value: { publication: mode === "partial-receipt" ? { status: "published", recovery: null } : receipt } }),
  } });
  await planning.publishPrivateWorkweek("private-version"); await planning.loadPrivateWorkweek();
  expect(planning.privateWorkweek().publication.phase).toBe("preparing");
  await planning.resolveWorkweekConflict(conflict, "google");
  expect(planning.privateWorkweek().conflictDecision.phase).toBe("published");
  expect(planning.privateWorkweek().publication).toMatchObject({ phase: mode === "linked" ? "confirmed" : "preparing", submitted: { versionId: "private-version" } });
  expect(planning.privateWorkweek().confirmedPublication).toEqual(mode === "partial-receipt" ? null : receipt);
  expect(publications).toBe(1);
});

test("an explicit freshly checked conflict decision preserves unrelated reconciliation uncertainty and never replays it", async () => {
  let reconciliations = 0; let decisions = 0;
  const { planning } = createPlanningState({ userId: "account", initialData: emptyPlanningShellState, adapter: {
    saveTask: async () => ({ task: {} }), readWorkspace: async () => null,
    readPrivateWorkweek: async () => ({ status: 200, value: context }), readWorkweekConflict: async () => ({ status: 200, value: { conflict } }),
    reconcilePrivateWorkweek: async () => { reconciliations++; throw new Error("Antwort verloren"); },
    resolveWorkweekConflict: async () => { decisions++; return { status: 200, value: { publication: { status: "published", recovery: null } } }; },
  } });
  await planning.loadPrivateWorkweek(); await planning.reconcileWorkweek();
  await planning.resolveWorkweekConflict(conflict, "google"); expect(decisions).toBe(0);
  await planning.loadPrivateWorkweek(); await planning.resolveWorkweekConflict(conflict, "google");
  expect(decisions).toBe(1);
  expect(planning.privateWorkweek()).toMatchObject({ conflictDecision: { phase: "published" }, reconciliation: { phase: "unconfirmed", checked: true }, contextRefreshRequired: true });
  await planning.reconcileWorkweek(); expect(reconciliations).toBe(1);
});
