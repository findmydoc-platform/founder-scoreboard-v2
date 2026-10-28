import { taskDetailStoryTask } from "@/features/tasks/molecules/task-detail-story-fixtures";
import { expect, test } from "vitest";
import { createPlanningState } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { emptyTeamWorkweekWindows } from "@/features/team-workweek/model/team-workweek-draft";

const draft = { effectiveFrom: "2026-11-02", activationMode: "future_monday" as const, windows: { ...emptyTeamWorkweekWindows(), monday: [{ start: "09:00", end: "17:00" }] } };
const version = { ...draft, id: "private-1", timezone: "Europe/Berlin" as const, status: "preparing" as const, createdAt: "2026-10-28T09:00:00Z" };
const baseline = { id: "published-before", effectiveFrom: "2026-10-26", status: "published" as const, syncState: "confirmed" as const, publicationRevision: 2, publishedAt: "2026-10-26T09:00:00Z", lastSyncAt: "2026-10-26T09:00:00Z", googleReconciliationState: "confirmed" as const, lastGoogleReconciliationAt: null };
const context = { version: null, publication: null, latestPublished: baseline, minimumEffectiveFrom: "2026-11-02" };

test("a confirmed private save survives publication rejection without replacing the confirmed Team baseline", async () => {
  const { planning } = createPlanningState({ userId: "account", initialData: emptyPlanningShellState, adapter: {
    saveTask: async () => ({ task: {} }), readWorkspace: async () => null,
    readPrivateWorkweek: async () => ({ status: 200, value: context }),
    savePrivateWorkweek: async () => ({ status: 201, value: { version } }),
    publishPrivateWorkweek: async () => ({ status: 422, value: { error: "Veröffentlichung nicht möglich." } }),
  } });
  await planning.loadPrivateWorkweek();
  await planning.savePrivateWorkweek(draft);
  await planning.publishPrivateWorkweek(version.id);
  expect(planning.privateWorkweek()).toMatchObject({
    savedVersion: version, context: { version, latestPublished: baseline },
    save: { phase: "confirmed", submitted: draft }, publication: { phase: "rejected", submitted: { versionId: version.id } },
  });
  expect(planning.protectedCache()?.tasks).toEqual([]);
});

test("lost save confirmation retains submitted input across a safe check and never resubmits it", async () => {
  let writes = 0; let reads = 0;
  const { planning } = createPlanningState({ userId: "account", initialData: emptyPlanningShellState, adapter: {
    saveTask: async () => ({ task: {} }), readWorkspace: async () => null,
    readPrivateWorkweek: async () => { reads++; return { status: 200, value: { ...context, version } }; },
    savePrivateWorkweek: async () => { writes++; throw new Error("Antwort verloren"); },
  } });
  await planning.savePrivateWorkweek(draft);
  expect(planning.privateWorkweek().save).toMatchObject({ phase: "unconfirmed", submitted: draft, checked: false });
  await planning.loadPrivateWorkweek();
  expect(planning.privateWorkweek().save).toMatchObject({ phase: "unconfirmed", submitted: draft, checked: true });
  await planning.savePrivateWorkweek(draft);
  expect(writes).toBe(1);
  expect(reads).toBe(1);
  expect(planning.privateWorkweek().contextRefreshRequired).toBe(true);
});

const confirmed = { id: "published-after", status: "published" as const, syncState: "confirmed" as const, publicationRevision: 1, publishedAt: "2026-10-28T10:00:00Z", lastSyncAt: "2026-10-28T10:00:00Z", effectiveAt: "2026-11-02T00:00:00+01:00", effectiveUntil: "2026-11-09T00:00:00+01:00", activationMode: "future_monday" as const, successorPublicationId: "successor", recovery: null };

test("publication confirmation survives unavailable editing context and invalidates each loaded calendar once", async () => {
  let contextReads = 0;
  const { planning } = createPlanningState({ userId: "account", initialData: emptyPlanningShellState, adapter: {
    saveTask: async () => ({ task: {} }), readWorkspace: async () => null,
    readPrivateWorkweek: async () => ++contextReads === 1 ? { status: 200, value: { ...context, version } } : { status: 503, value: { error: "Stand nicht erreichbar" } },
    publishPrivateWorkweek: async () => ({ status: 200, value: { publication: confirmed } }),
    readWorkweekCalendar: async () => ({ currentWorkweeks: [], calendarWorkweeks: [], referenceDate: "2026-10-28" }),
  } });
  const week = { policy: "team-week" as const, from: "2026-10-26", to: "2026-11-01" };
  const month = { policy: "header-month" as const, from: "2026-10-26", to: "2026-12-06" };
  await planning.loadWorkweekCalendar(week); await planning.loadWorkweekCalendar(month);
  const before = planning.workweekCalendar(week).invalidation;
  await planning.loadPrivateWorkweek();
  await planning.publishPrivateWorkweek(version.id);
  await planning.loadPrivateWorkweek();
  expect(planning.privateWorkweek()).toMatchObject({ confirmedPublication: confirmed, contextRefreshRequired: true, readStatus: "unavailable", publication: { phase: "confirmed" }, context: { latestPublished: { id: confirmed.id, publicationRevision: 1, effectiveAt: confirmed.effectiveAt } } });
  expect(planning.workweekCalendar(week).invalidation).toBe(before + 1);
  expect(planning.workweekCalendar(month).invalidation).toBe(before + 1);
});

function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }

test("reads begun before a save cannot replace its accepted version, and account replacement discards a late publication", async () => {
  const old = deferred<{ status: number; value: typeof context }>();
  const publication = deferred<{ status: number; value: { publication: typeof confirmed } }>();
  const { planning, internal } = createPlanningState({ userId: "account", initialData: emptyPlanningShellState, adapter: {
    saveTask: async () => ({ task: {} }), readWorkspace: async () => null,
    readPrivateWorkweek: async () => old.promise,
    savePrivateWorkweek: async () => ({ status: 201, value: { version } }),
    publishPrivateWorkweek: async () => publication.promise,
  } });
  const read = planning.loadPrivateWorkweek();
  await planning.savePrivateWorkweek(draft);
  old.resolve({ status: 200, value: context }); await read;
  expect(planning.privateWorkweek().savedVersion?.id).toBe(version.id);
  const write = planning.publishPrivateWorkweek(version.id);
  internal.sessionChanged("another-account");
  publication.resolve({ status: 200, value: { publication: confirmed } }); await write;
  expect(planning.privateWorkweek()).toMatchObject({ context: null, savedVersion: null, confirmedPublication: null, save: { submitted: null }, publication: { submitted: null } });
});

test("a lost publication response uses only a GET check; an explicitly bound resumable pending result preserves domain recovery", async () => {
  let writes = 0;
  const { planning } = createPlanningState({ userId: "account", initialData: emptyPlanningShellState, adapter: {
    saveTask: async () => ({ task: {} }), readWorkspace: async () => null,
    readPrivateWorkweek: async () => ({ status: 200, value: { ...context, version, pendingPublication: { id: "attempt", sourceVersionId: version.id, effectiveFrom: version.effectiveFrom, resumeAllowed: true } } }),
    publishPrivateWorkweek: async () => { writes++; throw new Error("Antwort verloren"); },
  } });
  await planning.publishPrivateWorkweek(version.id);
  expect(planning.privateWorkweek().publication).toMatchObject({ phase: "unconfirmed", submitted: { versionId: version.id } });
  await planning.loadPrivateWorkweek();
  expect(writes).toBe(1);
  expect(planning.privateWorkweek()).toMatchObject({ contextRefreshRequired: false, publication: { phase: "preparing", checked: true }, context: { pendingPublication: { sourceVersionId: version.id, resumeAllowed: true } } });
});

test("denial withholds retained private inputs and invalidates older reads without clearing independently authorized task data", async () => {
  const task = taskDetailStoryTask({ id: "independent-task", title: "Accepted task", updatedAt: "task-revision" });
  let denied = false;
  const old = deferred<{ status: number; value: typeof context }>();
  let reads = 0;
  const { planning } = createPlanningState({ userId: "account", initialData: { ...emptyPlanningShellState, tasks: [task] }, adapter: {
    saveTask: async () => ({ task: {} }), readWorkspace: async () => null,
    savePrivateWorkweek: async () => ({ status: 201, value: { version } }),
    readPrivateWorkweek: async () => ++reads === 1 ? old.promise : denied ? { status: 403, value: { error: "Kein Zugriff" } } : { status: 200, value: context },
  } });
  await planning.savePrivateWorkweek(draft);
  const pending = planning.loadPrivateWorkweek(); denied = true;
  await planning.loadPrivateWorkweek(); old.resolve({ status: 200, value: context }); await pending;
  expect(planning.privateWorkweek()).toMatchObject({ readStatus: "forbidden", savedVersion: null, save: { submitted: null }, context: null });
  expect(planning.board().tasks).toEqual([task]);
  expect(planning.protectedCache()?.tasks).toEqual([task]);
  denied = false; await planning.loadPrivateWorkweek();
  expect(planning.privateWorkweek().readStatus).toBe("current");
});

test("a delayed provider result retains its actual recovery and cannot change the confirmed Team baseline", async () => {
  const delayed = { ...confirmed, id: "attempt", status: "preparing" as const, syncState: "delayed" as const, publishedAt: null, recovery: "reconnect" as const };
  const { planning } = createPlanningState({ userId: "account", initialData: emptyPlanningShellState, adapter: {
    saveTask: async () => ({ task: {} }), readWorkspace: async () => null,
    readPrivateWorkweek: async () => ({ status: 200, value: { ...context, version } }),
    publishPrivateWorkweek: async () => ({ status: 202, value: { publication: delayed } }),
  } });
  await planning.loadPrivateWorkweek(); await planning.publishPrivateWorkweek(version.id);
  expect(planning.privateWorkweek()).toMatchObject({ confirmedPublication: null, publication: { phase: "preparing", result: delayed }, context: { latestPublished: baseline, publication: { status: "preparing", syncState: "delayed" } } });
});

test("confirmed provider effects with open FounderOps finalization remain a partial outcome rather than a rejected write", async () => {
  const { planning } = createPlanningState({ userId: "account", initialData: emptyPlanningShellState, adapter: {
    saveTask: async () => ({ task: {} }), readWorkspace: async () => null,
    publishPrivateWorkweek: async () => ({ status: 503, value: { code: "completion_pending", completionPending: true, error: "Abschluss offen" } }),
  } });
  await planning.publishPrivateWorkweek(version.id);
  expect(planning.privateWorkweek()).toMatchObject({ contextRefreshRequired: true, publication: { phase: "preparing", completionPending: true, submitted: { versionId: version.id } } });
});

test("a historical publication receipt cannot replace a different current version accepted while the request was in flight", async () => {
  const receipt = deferred<{ status: number; value: { publication: typeof confirmed } }>();
  let newer = false;
  const foreignVersion = { ...version, id: "foreign-private" };
  const foreignPublished = { ...baseline, id: "foreign-publication", publicationRevision: 1 };
  const { planning } = createPlanningState({ userId: "account", initialData: emptyPlanningShellState, adapter: {
    saveTask: async () => ({ task: {} }), readWorkspace: async () => null,
    readPrivateWorkweek: async () => ({ status: 200, value: { ...context, version: newer ? foreignVersion : version, latestPublished: newer ? foreignPublished : baseline } }),
    publishPrivateWorkweek: async () => receipt.promise,
  } });
  await planning.loadPrivateWorkweek();
  const write = planning.publishPrivateWorkweek(version.id);
  newer = true; await planning.loadPrivateWorkweek();
  receipt.resolve({ status: 200, value: { publication: confirmed } }); await write;
  expect(planning.privateWorkweek()).toMatchObject({ confirmedPublication: confirmed, contextRefreshRequired: true, publication: { sourceVersion: version }, context: { version: foreignVersion, latestPublished: foreignPublished } });
});

test("credential-bound denied checks withhold accepted private state even when the adapter rejects before returning a reply", async () => {
  const { planning } = createPlanningState({ userId: "account", initialData: emptyPlanningShellState, adapter: {
    saveTask: async () => ({ task: {} }), readWorkspace: async () => null,
    savePrivateWorkweek: async () => ({ status: 201, value: { version } }),
    readPrivateWorkweek: async () => { throw Object.assign(new Error("Kein Zugriff"), { status: 403 }); },
  } });
  await planning.savePrivateWorkweek(draft); await planning.loadPrivateWorkweek();
  expect(planning.privateWorkweek()).toMatchObject({ readStatus: "forbidden", savedVersion: null, save: { submitted: null }, context: null });
});
