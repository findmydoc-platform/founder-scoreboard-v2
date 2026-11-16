import { expect, test, vi } from "vitest";
import { createPlanningState } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { taskDetailStoryTask } from "@/features/tasks/molecules/task-detail-story-fixtures";
import type { InitiativeCandidatePage, InitiativeCandidateQuery } from "@/features/planning-items/model/planning-item-candidates";

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
