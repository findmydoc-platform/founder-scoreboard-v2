import { expect, test, vi } from "vitest";
import { createPlanningState } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { taskDetailStoryTask } from "@/features/tasks/molecules/task-detail-story-fixtures";
import type { InitiativeCandidatePage, InitiativeCandidateQuery } from "@/features/planning-items/model/planning-item-candidates";
import type { TaskDetailModel } from "@/features/tasks/model/task-detail-read-model";

const actor = { id: "candidate-reader", name: "Reader", platformRole: "founder" as const, orgRole: "Founder", githubLogin: "", weeklyCapacity: 40 };
const task = taskDetailStoryTask({ id: "loaded-deliverable" });
const query: InitiativeCandidateQuery = { view: "candidates", kind: "initiative", query: " Säulen ", limit: 20 };
const item = { id: "off-page-initiative", title: "Säulen außerhalb des Boards", taskType: "initiative" as const, parentTaskId: "", approvalStatus: "approved", updatedAt: "2026-11-01T12:00:00Z" };
type CandidatePort = {
  loadCandidates(query: InitiativeCandidateQuery, options?: { immediate?: boolean; refresh?: boolean; signal?: AbortSignal }): Promise<{ ok: boolean }>;
  candidates(query: InitiativeCandidateQuery): { readStatus: string; items: InitiativeCandidatePage["items"]; coverage: string };
};
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function receipt() {
  return { candidates: { items: [item], total: 1, coverage: "complete" as const, continuation: null, sourceRevision: "candidate-source-one",
    observedAt: new Date(Date.now()).toISOString(), validUntil: new Date(Date.now() + 60_000).toISOString() },
  readAuthority: { userId: "candidate-user", deadline: Date.now() + 1_000 }, readActor: { profileId: actor.id, platformRole: actor.platformRole } };
}

test("candidate search waits 250 ms, Enter coalesces normalized demand, and reuse keeps the original authority deadline", async () => {
  vi.useFakeTimers(); vi.setSystemTime(1_000);
  try {
    const pending = deferred<ReturnType<typeof receipt>>();
    const reads: string[] = []; let signal: AbortSignal | undefined;
    const adapter = { now: () => Date.now(), saveTask: async () => ({ task }), readWorkspace: async () => null,
      readCandidates: async (scope: InitiativeCandidateQuery, options?: { signal?: AbortSignal }) => { reads.push(scope.query); signal = options?.signal; return pending.promise; } };
    const { planning } = createPlanningState({ userId: "candidate-user", initialData: emptyPlanningShellState, initialCurrentProfile: actor, adapter });
    const port = planning as typeof planning & Partial<CandidatePort>;
    const firstConsumer = new AbortController(), remainingConsumer = new AbortController();
    const first = port.loadCandidates?.(query, { signal: firstConsumer.signal });
    await vi.advanceTimersByTimeAsync(249); expect(reads).toEqual([]);
    await vi.advanceTimersByTimeAsync(1); expect(reads).toEqual(["säulen"]);
    const second = port.loadCandidates?.({ ...query, query: "SÄULEN" }, { immediate: true, signal: remainingConsumer.signal });
    expect(reads).toHaveLength(1);
    firstConsumer.abort(); expect(signal?.aborted).toBe(false);
    pending.resolve(receipt());
    expect(await first).toMatchObject({ ok: false }); expect(await second).toMatchObject({ ok: true });
    expect(port.candidates?.(query)).toMatchObject({ readStatus: "current", coverage: "complete", items: [item] });
    await port.loadCandidates?.(query, { immediate: true }); expect(reads).toHaveLength(1);
    await vi.advanceTimersByTimeAsync(1_001);
    expect(port.candidates?.(query)).toMatchObject({ readStatus: "stale", items: [] });
  } finally { vi.useRealTimers(); }
});

test.each(["source", "session"] as const)("a changed candidate %s binding rejects a late successful replacement", async change => {
  const pending = deferred<ReturnType<typeof receipt>>(); let delayed = false;
  const session = { userId: "candidate-user", revision: "candidate-session-one", expiresAt: Date.now() / 1000 + 3600, user: { id: "candidate-user" } };
  const data = { ...emptyPlanningShellState, profiles: [actor], tasks: [task] };
  const adapter = { saveTask: async () => ({ task }), readWorkspace: async () => ({ data, scopeRevision: "candidate-source-one", taskCoverage: "partial" as const }),
    readPlanningSourceVersion: async () => "candidate-source-two", readCandidates: async () => delayed ? pending.promise : receipt() };
  const owner = createPlanningState({ userId: session.userId, initialData: data, initialCurrentProfile: actor, initialSession: session, adapter });
  const port = owner.planning as typeof owner.planning & Partial<CandidatePort>;
  await owner.planning.refreshWorkspace("planning");
  await port.loadCandidates?.(query, { immediate: true });
  expect(port.candidates?.(query)).toMatchObject({ readStatus: "current", items: [item] });
  delayed = true;
  const reading = port.loadCandidates?.(query, { immediate: true, refresh: true });
  if (change === "session") owner.internal.bindSession({ ...session, revision: "candidate-session-two" });
  else await owner.planning.checkPlanningSource();
  pending.resolve({ ...receipt(), candidates: { ...receipt().candidates, items: [{ ...item, title: "Obsolete candidate title" }] } });
  expect(await reading).toMatchObject({ ok: false });
  expect(port.candidates?.(query)?.readStatus).not.toBe("current");
  expect(port.candidates?.(query)?.items.some(candidate => candidate.title === "Obsolete candidate title")).toBe(false);
});

test("releasing the final candidate consumer aborts transport and cannot publish its late result", async () => {
  const pending = deferred<ReturnType<typeof receipt>>(); let signal: AbortSignal | undefined;
  const adapter = { saveTask: async () => ({ task }), readWorkspace: async () => null,
    readCandidates: async (_scope: InitiativeCandidateQuery, options?: { signal?: AbortSignal }) => { signal = options?.signal; return pending.promise; } };
  const { planning } = createPlanningState({ userId: "candidate-user", initialData: emptyPlanningShellState, initialCurrentProfile: actor, adapter });
  const port = planning as typeof planning & Partial<CandidatePort>;
  const consumer = new AbortController();
  const reading = port.loadCandidates?.(query, { immediate: true, signal: consumer.signal });
  consumer.abort(); expect(signal?.aborted).toBe(true);
  pending.resolve(receipt()); expect(await reading).toMatchObject({ ok: false });
  expect(port.candidates?.(query)).toMatchObject({ readStatus: "not-loaded", items: [] });
});

const pageBasis = receipt();
pageBasis.readAuthority.deadline = Date.now() + 60_000;
function page(items: typeof item[], continuation: string | null, sourceRevision = "candidate-source-one") {
  return { ...pageBasis, candidates: { ...pageBasis.candidates, items, total: 2, coverage: continuation ? "partial" as const : "complete" as const, continuation, sourceRevision } };
}
const secondItem = { ...item, id: "second-initiative", title: "Säulen zweite Seite" };

test("compatible further-page demand coalesces and appends every candidate without replacing the first page", async () => {
  const next = deferred<ReturnType<typeof page>>(), reads: InitiativeCandidateQuery[] = [];
  const adapter = { saveTask: async () => ({ task }), readWorkspace: async () => null,
    readCandidates: async (scope: InitiativeCandidateQuery) => { reads.push(scope); return scope.continuation ? next.promise : page([item], "candidate-next"); } };
  const { planning } = createPlanningState({ userId: "candidate-user", initialData: emptyPlanningShellState, initialCurrentProfile: actor, adapter });
  await planning.loadCandidates(query, { immediate: true });
  const continuation = planning.candidates(query).continuation!;
  const one = planning.loadCandidates({ ...query, continuation }, { immediate: true });
  const two = planning.loadCandidates({ ...query, continuation }, { immediate: true });
  expect(reads.map(scope => scope.continuation || "initial")).toEqual(["initial", "candidate-next"]);
  next.resolve(page([secondItem], null));
  expect(await one).toMatchObject({ ok: true }); expect(await two).toMatchObject({ ok: true });
  expect(planning.candidates(query)).toMatchObject({ readStatus: "current", coverage: "complete", total: 2, continuation: null, items: [item, secondItem] });
  expect(planning.candidate(item.id)?.title).toBe(item.title);
});

test("a failed further page preserves usable candidates and retries only the missing page", async () => {
  const reads: Array<string | undefined> = []; let fail = true;
  const adapter = { saveTask: async () => ({ task }), readWorkspace: async () => null,
    readCandidates: async (scope: InitiativeCandidateQuery) => {
      reads.push(scope.continuation);
      if (!scope.continuation) return page([item], "candidate-next");
      if (fail) throw { status: 503 };
      return page([secondItem], null);
    } };
  const { planning } = createPlanningState({ userId: "candidate-user", initialData: emptyPlanningShellState, initialCurrentProfile: actor, adapter });
  await planning.loadCandidates(query, { immediate: true });
  expect(await planning.loadCandidates({ ...query, continuation: "candidate-next" }, { immediate: true })).toMatchObject({ ok: false });
  expect(planning.candidates(query)).toMatchObject({ readStatus: "current", furtherReadStatus: "unavailable", items: [item], coverage: "partial", continuation: "candidate-next" });
  expect(planning.candidate(item.id)?.title).toBe(item.title);
  fail = false;
  expect(await planning.loadCandidates({ ...query, continuation: "candidate-next" }, { immediate: true })).toMatchObject({ ok: true });
  expect(reads).toEqual([undefined, "candidate-next", "candidate-next"]);
  expect(planning.candidates(query).items).toEqual([item, secondItem]);
});

test("known source invalidation restarts candidate discovery without sending an obsolete continuation", async () => {
  const reads: InitiativeCandidateQuery[] = []; let source = "candidate-source-one";
  const data = { ...emptyPlanningShellState, profiles: [actor], tasks: [task] };
  const adapter = { saveTask: async () => ({ task }), readWorkspace: async () => ({ data, scopeRevision: "candidate-source-one", taskCoverage: "partial" as const }),
    readPlanningSourceVersion: async () => source,
    readCandidates: async (scope: InitiativeCandidateQuery) => { reads.push(scope); return page(scope.continuation ? [secondItem] : [item], "candidate-next", source); } };
  const { planning } = createPlanningState({ userId: "candidate-user", initialData: data, initialCurrentProfile: actor, adapter });
  await planning.refreshWorkspace("planning"); await planning.loadCandidates(query, { immediate: true });
  const previousCursor = planning.candidates(query).continuation!;
  source = "candidate-source-two"; await planning.checkPlanningSource();
  expect(planning.candidates(query)).toMatchObject({ readStatus: "stale", continuation: null });
  await planning.loadCandidates({ ...query, continuation: previousCursor }, { immediate: true });
  expect(reads.map(scope => scope.continuation)).toEqual([undefined, undefined]);
  expect(planning.candidates(query)).toMatchObject({ readStatus: "current", items: [item], coverage: "partial" });
  expect(planning.candidate(item.id)?.title).toBe(item.title);
});

function targetReceipt(id: string) {
  const deadline = Date.now() + 60_000;
  const model: TaskDetailModel = { revision: "2026-11-01T12:00:00Z", readArea: "target", sourceRevision: "independent-target-source",
    observedAt: new Date().toISOString(), validUntil: new Date(deadline).toISOString(), authorityDeadline: deadline,
    readActor: { profileId: actor.id, platformRole: actor.platformRole }, project: emptyPlanningShellState.project,
    item: taskDetailStoryTask({ id, title: "Independent canonical context", parentTaskId: "", updatedAt: "2026-11-01T12:00:00Z" }),
    people: [actor], sprints: [], ancestors: [], children: [], relatedItems: [], coverage: {},
    discussion: { comments: [], externalComments: [] }, blockers: [], relationships: [], activity: [], reviews: [] };
  return { model, readAuthority: { userId: "candidate-user", deadline } };
}

test("a current target denial removes its candidate label and count while preserving independent canonical context", async () => {
  const independentId = "independent-target";
  const adapter = { readWorkspace: async () => null, saveTask: async () => ({ task }), readCandidates: async () => receipt(),
    readTaskDetail: async (id: string) => { if (id === item.id) throw { status: 403 }; return targetReceipt(id); } };
  const { planning } = createPlanningState({ userId: "candidate-user", initialData: emptyPlanningShellState, initialCurrentProfile: actor, adapter });
  await planning.loadTaskDetail(independentId, { area: "target" });
  await planning.loadCandidates(query, { immediate: true });
  expect(planning.candidate(item.id)?.title).toBe(item.title);
  expect(await planning.loadTaskDetail(item.id, { area: "target" })).toMatchObject({ ok: false });
  expect(planning.candidate(item.id)).toBeNull();
  expect(planning.candidates(query)).toMatchObject({ readStatus: "stale", items: [], total: null, coverage: "unknown", continuation: null });
  expect(planning.taskDetail(independentId)).toMatchObject({ readStatus: "current", task: { id: independentId, title: "Independent canonical context" } });
});

test("an old-session target denial cannot invalidate a verified replacement-session candidate receipt", async () => {
  let rejectTarget!: (reason: unknown) => void;
  const pending = new Promise<ReturnType<typeof targetReceipt>>((_resolve, reject) => { rejectTarget = reject; });
  const session = { userId: "candidate-user", revision: "candidate-denial-old", expiresAt: Date.now() / 1000 + 3600, user: { id: "candidate-user" } };
  const data = { ...emptyPlanningShellState, profiles: [actor], tasks: [task] };
  const adapter = { saveTask: async () => ({ task }), readTaskDetail: async () => pending, readCandidates: async () => receipt(),
    readWorkspace: async () => ({ data, scopeRevision: "candidate-source-one", taskCoverage: "partial" as const, currentProfile: actor,
      readAuthority: { userId: session.userId, deadline: Date.now() + 60_000 } }) };
  const owner = createPlanningState({ userId: session.userId, initialSession: session, initialData: data, initialCurrentProfile: actor, adapter });
  const oldRead = owner.planning.loadTaskDetail(item.id, { area: "target" });
  owner.internal.bindSession({ ...session, revision: "candidate-denial-new" });
  await owner.planning.refreshWorkspace("planning");
  await owner.planning.loadCandidates(query, { immediate: true });
  expect(owner.planning.candidates(query)).toMatchObject({ readStatus: "current", items: [item] });
  rejectTarget({ status: 403 }); expect(await oldRead).toMatchObject({ ok: false });
  expect(owner.planning.candidates(query)).toMatchObject({ readStatus: "current", total: 1, items: [item] });
  expect(owner.planning.candidate(item.id)?.title).toBe(item.title);
});
