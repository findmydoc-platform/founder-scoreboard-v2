import { expect, test } from "vitest";
import { createPlanningState } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { emptyTeamWorkweekWindows } from "@/features/team-workweek/model/team-workweek-draft";

const source = { id: "private-before", effectiveFrom: "2026-11-02", activationMode: "future_monday" as const, timezone: "Europe/Berlin" as const, status: "preparing" as const, createdAt: "2026-10-28T09:00:00Z", windows: { ...emptyTeamWorkweekWindows(), monday: [{ start: "09:00", end: "17:00" }] } };
const replacement = { ...source, id: "private-after" };
const baseline = { id: "confirmed-team", effectiveFrom: "2026-10-26", status: "published" as const, syncState: "confirmed" as const, publicationRevision: 2, publishedAt: "2026-10-26T09:00:00Z", lastSyncAt: "2026-10-26T09:00:00Z", googleReconciliationState: "confirmed" as const, lastGoogleReconciliationAt: null };
const context = { version: source, latestPublished: baseline, minimumEffectiveFrom: "2026-11-02", restartAvailable: true, weekContext: { weekStart: "2026-11-02", contextToken: "current-context", effectiveUntil: null, basePublicationId: baseline.id, basePublicationRevision: 2, windows: [{ weekday: 1, startMinute: 540, endMinute: 1020 }] } };
const adapter = { saveTask: async () => ({ task: {} }), readWorkspace: async () => null, readWorkweekConflict: async () => ({ status: 200, value: { conflict: null } }) };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }

test("a ready restart retains its source and returned private version after an unavailable context without publishing it", async () => {
  let reads = 0; let restarts = 0;
  const { planning } = createPlanningState({ userId: "account", initialData: emptyPlanningShellState, adapter: {
    ...adapter, readPrivateWorkweek: async () => ++reads === 1 ? { status: 200, value: context } : { status: 503, value: { error: "Kontext nicht erreichbar" } },
    restartPrivateWorkweek: async () => { restarts++; return { status: 200, value: { version: replacement, restart: { state: "ready", recovery: null } } }; },
  } });
  await planning.loadPrivateWorkweek(); await planning.restartWorkweek(source.id); await planning.loadPrivateWorkweek();
  expect(planning.privateWorkweek()).toMatchObject({ restart: { phase: "ready", submitted: { versionId: source.id }, result: { version: replacement } }, savedVersion: replacement, context: { version: replacement, latestPublished: baseline }, readStatus: "unavailable", contextRefreshRequired: true, confirmedPublication: null });
  expect(restarts).toBe(1);
});


test("an unknown restart is checked by GET only and cannot retry before a complete current recovery context", async () => {
  let posts = 0;
  const { planning } = createPlanningState({ userId: "account", initialData: emptyPlanningShellState, adapter: {
    ...adapter, readPrivateWorkweek: async () => ({ status: 200, value: context }),
    restartPrivateWorkweek: async () => { posts++; throw new Error("Antwort verloren"); },
  } });
  await planning.loadPrivateWorkweek(); await planning.restartWorkweek(source.id);
  await planning.restartWorkweek(source.id); expect(posts).toBe(1);
  await planning.loadPrivateWorkweek();
  expect(posts).toBe(1);
  expect(planning.privateWorkweek().restart).toMatchObject({ phase: "unconfirmed", checked: true, submitted: { versionId: source.id } });
});


const receipt = { id: "pending", status: "published" as const, syncState: "confirmed" as const, publicationRevision: 3, publishedAt: "2026-10-28T11:00:00Z", lastSyncAt: "2026-10-28T11:00:00Z", recovery: null };
const pending = { id: "pending", sourceVersionId: "earlier-source", effectiveFrom: "2026-11-02", resumeAllowed: true };
test("resuming an earlier pending identity confirms only that publication and retains it after a failed editing-context read", async () => {
  let reads = 0; const inputs: string[] = [];
  const { planning } = createPlanningState({ userId: "account", initialData: emptyPlanningShellState, adapter: {
    ...adapter, readPrivateWorkweek: async () => ++reads === 1 ? { status: 200, value: { ...context, pendingPublication: pending } } : { status: 503, value: { error: "Kontext nicht erreichbar" } },
    publishPrivateWorkweek: async versionId => { inputs.push(versionId); return { status: 200, value: { publication: receipt } }; },
    readWorkweekCalendar: async () => ({ currentWorkweeks: [], calendarWorkweeks: [], referenceDate: "2026-10-28" }),
  } });
  const scope = { policy: "team-week" as const, from: "2026-10-26", to: "2026-11-01" };
  await planning.loadPrivateWorkweek(); await planning.loadWorkweekCalendar(scope); const before = planning.workweekCalendar(scope).invalidation;
  await planning.resumeWorkweekPublication(pending); await planning.loadPrivateWorkweek();
  expect(inputs).toEqual(["earlier-source"]);
  expect(planning.privateWorkweek()).toMatchObject({ resume: { phase: "confirmed", submitted: { publicationId: "pending", versionId: "earlier-source" }, result: receipt }, confirmedPublication: receipt, context: { version: source, latestPublished: baseline }, readStatus: "unavailable", contextRefreshRequired: true });
  expect(planning.workweekCalendar(scope).invalidation).toBe(before + 1);
});


test("a complete independently bound current edit context permits a conscious new save while preserving the lost save as unproven history", async () => {
  let saves = 0;
  const { planning } = createPlanningState({ userId: "account", initialData: emptyPlanningShellState, adapter: {
    ...adapter, readPrivateWorkweek: async () => ({ status: 200, value: { ...context, version: replacement, restartAvailable: false } }),
    savePrivateWorkweek: async () => { if (++saves === 1) throw new Error("Erste Antwort verloren"); return { status: 201, value: { version: { ...replacement, id: "new-conscious-save" } } }; },
  } });
  const first = { ...source, selectedWeekStart: context.weekContext.weekStart, contextToken: "old-context" };
  const next = { ...replacement, selectedWeekStart: context.weekContext.weekStart, contextToken: context.weekContext.contextToken };
  await planning.savePrivateWorkweek(first); await planning.loadPrivateWorkweek();
  expect(planning.privateWorkweek()).toMatchObject({ save: { phase: "unconfirmed", submitted: first }, currentContextReady: true, contextRefreshRequired: false });
  await planning.savePrivateWorkweek(next);
  expect(saves).toBe(2);
  expect(planning.privateWorkweek()).toMatchObject({ save: { phase: "confirmed", submitted: next }, history: [{ kind: "save", operation: { phase: "unconfirmed", submitted: first } }] });
});


test("fresh permission for another week never authorizes resubmitting an older draft token", async () => {
  let saves = 0;
  const { planning } = createPlanningState({ userId: "account", initialData: emptyPlanningShellState, adapter: {
    ...adapter, readPrivateWorkweek: async () => ({ status: 200, value: { ...context, version: replacement, weekContext: { ...context.weekContext, weekStart: "2026-11-09", contextToken: "different-week-context" } } }),
    savePrivateWorkweek: async () => { saves++; throw new Error("Antwort verloren"); },
  } });
  const oldDraft = { ...source, selectedWeekStart: "2026-11-02", contextToken: "original-context" };
  await planning.savePrivateWorkweek(oldDraft); await planning.loadPrivateWorkweek();
  const result = await planning.savePrivateWorkweek(oldDraft);
  expect(result).toMatchObject({ status: 409, value: { code: "edit_context_stale" } });
  expect(saves).toBe(1);
  expect(planning.privateWorkweek().save).toMatchObject({ phase: "unconfirmed", submitted: oldDraft });
});


test.each(["unknown", "delayed"] as const)("new %s reconciliation revokes independently established current write permission", async outcome => {
  const { planning } = createPlanningState({ userId: "account", initialData: emptyPlanningShellState, adapter: {
    ...adapter, readPrivateWorkweek: async () => ({ status: 200, value: { ...context, restartAvailable: false } }),
    reconcilePrivateWorkweek: async () => { if (outcome === "unknown") throw new Error("Antwort verloren"); return { status: 202, value: { reconciliation: { state: "delayed", recovery: "retry", lastSuccessfulSyncAt: null } } }; },
  } });
  await planning.loadPrivateWorkweek(); expect(planning.privateWorkweek().currentContextReady).toBe(true);
  await planning.reconcileWorkweek();
  expect(planning.privateWorkweek()).toMatchObject({ currentContextReady: false, contextRefreshRequired: true, reconciliation: { phase: outcome === "unknown" ? "unconfirmed" : "delayed" } });
});

test("changing the loaded week revokes permission while loading, and session replacement clears historical input and rejects a late restart", async () => {
  const next = deferred<{ status: number; value: typeof context }>();
  const write = deferred<{ status: number; value: { version: typeof replacement; restart: { state: "ready"; recovery: null } } }>();
  let reads = 0;
  const { planning, internal } = createPlanningState({ userId: "account", initialData: emptyPlanningShellState, adapter: {
    ...adapter, readPrivateWorkweek: async () => ++reads === 1 ? { status: 200, value: context } : next.promise,
    restartPrivateWorkweek: async () => write.promise,
  } });
  await planning.loadPrivateWorkweek(); const loading = planning.loadPrivateWorkweek("2026-11-09");
  expect(planning.privateWorkweek()).toMatchObject({ currentContextReady: false, recovery: { restartVersionId: null, resumablePublication: null } });
  next.resolve({ status: 200, value: context }); await loading;
  const restarting = planning.restartWorkweek(source.id); internal.sessionChanged("replacement-account");
  write.resolve({ status: 200, value: { version: replacement, restart: { state: "ready", recovery: null } } }); await restarting;
  expect(planning.privateWorkweek()).toMatchObject({ currentContextReady: false, history: [], restart: { phase: "idle", submitted: null }, context: null, savedVersion: null });
});


test.each(["retry", "reconnect", "identity_conflict"] as const)("delayed restart %s preserves its actual previous attempt and publishes no Team effect", async recovery => {
  const { planning } = createPlanningState({ userId: "account", initialData: emptyPlanningShellState, adapter: {
    ...adapter, readPrivateWorkweek: async () => ({ status: 200, value: context }),
    restartPrivateWorkweek: async () => ({ status: 202, value: { restart: { state: "delayed", recovery, reason: "uncertain" } } }),
  } });
  await planning.loadPrivateWorkweek(); await planning.restartWorkweek(source.id);
  expect(planning.privateWorkweek()).toMatchObject({ currentContextReady: false, restart: { phase: "delayed", submitted: { versionId: source.id }, result: { restart: { recovery, reason: "uncertain" } } }, context: { version: source, latestPublished: baseline }, confirmedPublication: null });
});

test("resume checks exact pending identity and permission, and restart cannot bypass a resumable pending attempt", async () => {
  let allowed = true; let posts = 0;
  const { planning } = createPlanningState({ userId: "account", initialData: emptyPlanningShellState, adapter: {
    ...adapter, readPrivateWorkweek: async () => ({ status: 200, value: { ...context, pendingPublication: { ...pending, resumeAllowed: allowed } } }),
    publishPrivateWorkweek: async () => { posts++; return { status: 200, value: { publication: receipt } }; },
    restartPrivateWorkweek: async () => { posts++; return { status: 200, value: { version: replacement, restart: { state: "ready", recovery: null } } }; },
  } });
  await planning.loadPrivateWorkweek();
  await planning.resumeWorkweekPublication({ ...pending, id: "obsolete-pending" }); await planning.restartWorkweek(pending.sourceVersionId);
  expect(posts).toBe(0);
  allowed = false; await planning.loadPrivateWorkweek(); await planning.resumeWorkweekPublication(pending); expect(posts).toBe(0);
  await planning.restartWorkweek(pending.sourceVersionId); expect(posts).toBe(1);
  expect(planning.privateWorkweek().restart.submitted).toEqual({ versionId: "earlier-source", pendingPublicationId: "pending" });
});

test("unknown resume verification performs no mutation, and a deliberate permitted domain continuation retains the unproven earlier call", async () => {
  let posts = 0;
  const { planning } = createPlanningState({ userId: "account", initialData: emptyPlanningShellState, adapter: {
    ...adapter, readPrivateWorkweek: async () => ({ status: 200, value: { ...context, pendingPublication: pending } }),
    publishPrivateWorkweek: async () => { if (++posts === 1) throw new Error("Antwort verloren"); return { status: 200, value: { publication: receipt } }; },
  } });
  await planning.loadPrivateWorkweek(); await planning.resumeWorkweekPublication(pending);
  await planning.resumeWorkweekPublication(pending); expect(posts).toBe(1);
  await planning.loadPrivateWorkweek(); expect(posts).toBe(1);
  expect(planning.privateWorkweek().resume).toMatchObject({ phase: "unconfirmed", checked: true });
  await planning.resumeWorkweekPublication(pending); expect(posts).toBe(2);
  expect(planning.privateWorkweek()).toMatchObject({ resume: { phase: "confirmed", result: receipt }, history: [{ kind: "resume", operation: { phase: "unconfirmed", submitted: { publicationId: "pending", versionId: "earlier-source" } } }] });
});

test("a denied recovery withholds all retained private outcomes and invalidates a late receipt", async () => {
  let denied = false;
  const response = deferred<{ status: number; value: { publication: typeof receipt } }>();
  const { planning } = createPlanningState({ userId: "account", initialData: emptyPlanningShellState, adapter: {
    ...adapter, readPrivateWorkweek: async () => denied ? { status: 403, value: { error: "Kein Zugriff" } } : { status: 200, value: { ...context, pendingPublication: pending } },
    publishPrivateWorkweek: async () => response.promise,
  } });
  await planning.loadPrivateWorkweek(); const writing = planning.resumeWorkweekPublication(pending);
  denied = true; await planning.loadPrivateWorkweek(); response.resolve({ status: 200, value: { publication: receipt } }); await writing;
  expect(planning.privateWorkweek()).toMatchObject({ readStatus: "forbidden", context: null, history: [], currentContextReady: false, resume: { submitted: null, result: null }, confirmedPublication: null });
});


test("a status-only legacy resume result cannot invent a confirmed publication identity", async () => {
  const { planning } = createPlanningState({ userId: "account", initialData: emptyPlanningShellState, adapter: {
    ...adapter, readPrivateWorkweek: async () => ({ status: 200, value: { ...context, pendingPublication: pending } }),
    publishPrivateWorkweek: async () => ({ status: 200, value: { publication: { status: "published", recovery: null } as typeof receipt } }),
  } });
  await planning.loadPrivateWorkweek(); await planning.resumeWorkweekPublication(pending);
  expect(planning.privateWorkweek()).toMatchObject({ resume: { phase: "confirmed", result: { status: "published" } }, confirmedPublication: null });
});
