import { afterEach, expect, test, vi } from "vitest";
import { createPlanningState, type PlanningWorkspaceRead } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import type { Task } from "@/lib/types";
import { planningWorkspaceHydration } from "@/features/planning/model/planning-workspace-hydration";

const task = { id: "coordinated-task", title: "Accepted card", updatedAt: "r1", taskType: "deliverable" } as Task;
const data = { ...emptyPlanningShellState, tasks: [task] };
function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<T>((done, fail) => { resolve = done; reject = fail; });
  return { promise, resolve, reject };
}
afterEach(() => vi.useRealTimers());

test("search bursts suppress obsolete queued queries and Enter starts the final normalized query immediately", async () => {
  vi.useFakeTimers();
  const queries: unknown[] = [];
  const { planning } = createPlanningState({ userId: "reader", initialData: data, adapter: {
    saveTask: async () => ({ task }),
    readWorkspace: async (_workspace, query) => { queries.push(query); return { data, query }; },
  } });
  const first = planning.scheduleBoardQuery({ filters: { query: "n" } });
  await vi.advanceTimersByTimeAsync(200);
  const second = planning.scheduleBoardQuery({ filters: { query: "needle" } });
  await vi.advanceTimersByTimeAsync(249);
  expect(queries).toEqual([]);
  const entered = planning.scheduleBoardQuery({ filters: { query: " needle " } }, { immediate: true });
  await expect(Promise.all([first, second, entered])).resolves.toEqual([false, false, true]);
  expect(queries).toMatchObject([{ filters: { query: "needle" } }]);
  await vi.advanceTimersByTimeAsync(1000);
  expect(queries).toHaveLength(1);
});

test("confirmed changes invalidate immediately and refresh only active demand after a 500 ms quiet window", async () => {
  vi.useFakeTimers();
  let reads = 0;
  const { planning } = createPlanningState({ userId: "reader", initialData: data, adapter: {
    saveTask: async (_task, patch) => ({ task: { ...task, ...patch, updatedAt: "saved" } }),
    readWorkspace: async () => { reads++; return { data }; },
  } });
  const release = planning.activatePlanningView();
  await planning.saveTask(task, { title: "First edit" });
  expect(planning.board().freshness).toBe("stale");
  await vi.advanceTimersByTimeAsync(400);
  await planning.saveTask(planning.workspace("planning").tasks[0], { title: "Second edit" });
  await vi.advanceTimersByTimeAsync(499);
  expect(reads).toBe(0);
  await vi.advanceTimersByTimeAsync(1);
  expect(reads).toBe(1);
  release();
  await planning.saveTask(planning.workspace("planning").tasks[0], { title: "Hidden edit" });
  await vi.advanceTimersByTimeAsync(1000);
  expect(reads).toBe(1);
  expect(planning.board().freshness).toBe("stale");
});

test("changes during a read accumulate one remaining refresh and obsolete fields and coverage never enter the owner", async () => {
  vi.useFakeTimers();
  const old = deferred<PlanningWorkspaceRead>();
  let reads = 0;
  const { planning } = createPlanningState({ userId: "reader", initialData: data, adapter: {
    saveTask: async (_task, patch) => ({ task: { ...task, ...patch, updatedAt: "saved" } }),
    readWorkspace: async () => ++reads === 1 ? old.promise : { data: { ...data, tasks: [{ ...task, title: "Final current card" }] }, taskCoverage: "partial" },
  } });
  planning.activatePlanningView();
  const reading = planning.refreshWorkspace("planning");
  await planning.saveTask(task, { title: "Confirmed card" });
  await vi.advanceTimersByTimeAsync(600);
  await planning.saveTask(planning.workspace("planning").tasks[0], { title: "Latest confirmed card" });
  await vi.advanceTimersByTimeAsync(600);
  expect(reads).toBe(1);
  old.resolve({ data: { ...data, tasks: [{ ...task, title: "Obsolete card", note: "Obsolete detail" }] }, taskCoverage: "complete" });
  await expect(reading).resolves.toBe(false);
  expect(planning.taskDetail(task.id).task).toMatchObject({ title: "Latest confirmed card" });
  expect(planning.taskDetail(task.id).task?.note).not.toBe("Obsolete detail");
  await vi.advanceTimersByTimeAsync(0);
  expect(reads).toBe(2);
  expect(planning.workspace("planning")).toMatchObject({ readStatus: "current", completeness: "partial", tasks: [{ title: "Final current card" }] });
});

test("a denial for the current scope clears protected content even after a query supersedes its request", async () => {
  const denied = deferred<PlanningWorkspaceRead>();
  let reads = 0;
  const { planning } = createPlanningState({ userId: "reader", initialData: data, adapter: {
    saveTask: async () => ({ task }),
    readWorkspace: async (_workspace, query) => ++reads === 1 ? denied.promise : { data, query },
  } });
  const first = planning.ensureBoardQuery({ filters: { query: "first" } });
  await planning.ensureBoardQuery({ filters: { query: "second" } });
  denied.reject({ status: 403 });
  await expect(first).resolves.toBe(false);
  expect(planning.workspace("planning")).toMatchObject({ readStatus: "forbidden", tasks: [] });
  expect(planning.taskDetail(task.id).task).toBeNull();
});

test("compatible consumers keep their transport alive; superseded demand cancels transport and rejects late success", async () => {
  const old = deferred<PlanningWorkspaceRead>();
  const signals: (AbortSignal | undefined)[] = [];
  const { planning } = createPlanningState({ userId: "reader", initialData: data, adapter: {
    saveTask: async () => ({ task }),
    readWorkspace: async (_workspace, query, options) => {
      signals.push(options?.signal);
      return signals.length === 1 ? old.promise : { data, query };
    },
  } });
  const first = planning.ensureBoardQuery({ filters: { query: "old" } });
  const shared = planning.ensureBoardQuery({ filters: { query: "old" } });
  expect(signals).toHaveLength(1);
  expect(signals[0]?.aborted).toBe(false);
  await planning.ensureBoardQuery({ filters: { query: "new" } });
  expect(signals[0]?.aborted).toBe(true);
  // The controlled adapter ignores abort: propagation is not proof of backend termination.
  old.resolve({ data: { ...data, tasks: [{ ...task, title: "Late card", note: "Late detail" }] }, taskCoverage: "complete" });
  await expect(Promise.all([first, shared])).resolves.toEqual([false, false]);
  expect(planning.taskDetail(task.id).task?.title).toBe("Accepted card");
  expect(planning.taskDetail(task.id).task?.note).not.toBe("Late detail");
});

test("leaving one active consumer preserves shared reads until the final consumer leaves", async () => {
  const pending = deferred<PlanningWorkspaceRead>();
  let signal: AbortSignal | undefined;
  const { planning } = createPlanningState({ userId: "reader", initialData: data, adapter: {
    saveTask: async () => ({ task }),
    readWorkspace: async (_workspace, _query, options) => { signal = options?.signal; return pending.promise; },
  } });
  const leaveFirst = planning.activatePlanningView();
  const leaveSecond = planning.activatePlanningView();
  const reading = planning.refreshWorkspace("planning");
  leaveFirst();
  expect(signal?.aborted).toBe(false);
  leaveSecond();
  expect(signal?.aborted).toBe(true);
  pending.resolve({ data: { ...data, tasks: [{ ...task, title: "Late after leaving" }] } });
  await expect(reading).resolves.toBe(false);
  expect(planning.workspace("planning").tasks[0].title).toBe("Accepted card");
});

test("explicit refresh and current query demand share only compatible in-flight content", async () => {
  const response = deferred<PlanningWorkspaceRead>();
  let reads = 0;
  const { planning } = createPlanningState({ userId: "reader", initialData: data, adapter: {
    saveTask: async () => ({ task }),
    readWorkspace: () => { reads++; return response.promise; },
  } });
  const first = planning.ensureBoardQuery({ filters: { query: "shared" } });
  const second = planning.refreshWorkspace("planning");
  expect(reads).toBe(1);
  response.resolve({ data });
  await expect(Promise.all([first, second])).resolves.toEqual([true, true]);
});

test("leaving the final observer cancels version transport without accepting a late unchanged result", async () => {
  const response = deferred<string>();
  let signal: AbortSignal | undefined;
  const session = { userId: "reader", revision: "session", expiresAt: Date.now() / 1000 + 3600, user: { id: "reader" } };
  const hydration = planningWorkspaceHydration("planning", { revision: "r1", scopeRevision: "source-1", project: data.project, items: [task], people: [], sprints: [], relationships: [], preferences: [], coverage: { items: "complete" } }, session, { userId: "reader", deadline: session.expiresAt * 1000 });
  const { planning } = createPlanningState({ userId: "reader", initialData: data, initialSession: session, initialWorkspaceRead: hydration, adapter: {
    saveTask: async () => ({ task }), readWorkspace: async () => { throw new Error("No fallback permitted"); },
    readPlanningSourceVersion: async options => { signal = options?.signal; return response.promise; },
  } });
  const leave = planning.activatePlanningView();
  const checking = planning.checkPlanningSource();
  leave();
  expect(signal?.aborted).toBe(true);
  response.resolve("source-1");
  await checking;
  expect(planning.board()).toMatchObject({ sourceStatus: "unverified", tasks: [task] });
});

test("same-query replacement waits for the active card interaction without presenting held content as current", async () => {
  const response = deferred<PlanningWorkspaceRead>();
  const { planning } = createPlanningState({ userId: "reader", initialData: data, adapter: {
    saveTask: async () => ({ task }), readWorkspace: () => response.promise,
  } });
  const finishInteraction = planning.beginBoardInteraction();
  const reading = planning.refreshWorkspace("planning");
  response.resolve({ data: { ...data, tasks: [{ ...task, title: "Updated card" }] } });
  await Promise.resolve(); await Promise.resolve();
  expect(planning.workspace("planning")).toMatchObject({ tasks: [{ title: "Accepted card" }], readStatus: "stale" });
  finishInteraction();
  await expect(reading).resolves.toBe(true);
  expect(planning.workspace("planning")).toMatchObject({ tasks: [{ title: "Updated card" }], readStatus: "current" });
});

test("confirmed Item changes leave other loaded Item scopes stale without loading hidden views or independent Events", async () => {
  const reads: string[] = [];
  const { planning } = createPlanningState({ userId: "reader", initialData: data, adapter: {
    saveTask: async (_task, patch) => ({ task: { ...task, ...patch, updatedAt: "r2" } }),
    readWorkspace: async workspace => { reads.push(workspace); return { data }; },
  } });
  await planning.refreshWorkspace("projects");
  await planning.refreshWorkspace("events");
  await planning.saveTask(task, { title: "Confirmed edit" });
  expect(planning.workspace("projects").readStatus).toBe("stale");
  expect(planning.workspace("events").readStatus).toBe("current");
  expect(reads).toEqual(["projects", "events"]);
});

test("queued query demand rejects an older explicit refresh before the search debounce elapses", async () => {
  vi.useFakeTimers();
  const old = deferred<PlanningWorkspaceRead>();
  let reads = 0;
  const { planning } = createPlanningState({ userId: "reader", initialData: data, adapter: {
    saveTask: async () => ({ task }),
    readWorkspace: () => ++reads === 1 ? old.promise : Promise.resolve({ data }),
  } });
  const reading = planning.refreshWorkspace("planning");
  const querying = planning.scheduleBoardQuery({ filters: { query: "next" } });
  old.resolve({ data: { ...data, tasks: [{ ...task, title: "Obsolete refresh", note: "Obsolete fields" }] } });
  await expect(reading).resolves.toBe(false);
  expect(planning.taskDetail(task.id).task?.title).toBe("Accepted card");
  await vi.advanceTimersByTimeAsync(250);
  await querying;
});

test("the final search starts at 250 ms and related filter changes normalize into one next-turn query", async () => {
  vi.useFakeTimers();
  const queries: unknown[] = [];
  const { planning } = createPlanningState({ userId: "reader", initialData: data, adapter: {
    saveTask: async () => ({ task }), readWorkspace: async (_workspace, query) => { queries.push(query); return { data, query }; },
  } });
  const search = planning.scheduleBoardQuery({ filters: { query: " German Ä " } });
  await vi.advanceTimersByTimeAsync(249);
  expect(queries).toEqual([]);
  await vi.advanceTimersByTimeAsync(1);
  await expect(search).resolves.toBe(true);
  expect(queries).toMatchObject([{ filters: { query: "german ä" } }]);
  const intermediate = planning.scheduleBoardQuery({ filters: { query: "german ä", status: "Offen" } });
  const final = planning.scheduleBoardQuery({ filters: { query: "german ä", status: "Offen", quick: ["week", "mine", "week"] } });
  await vi.advanceTimersByTimeAsync(0);
  await expect(Promise.all([intermediate, final])).resolves.toEqual([false, true]);
  expect(queries).toMatchObject([{ filters: { query: "german ä" } }, { filters: { status: "Offen", quick: ["mine", "week"] } }]);
});

test("failed automatic replacement keeps confirmed fields and waits for explicit targeted retry", async () => {
  vi.useFakeTimers();
  let reads = 0;
  const { planning } = createPlanningState({ userId: "reader", initialData: data, adapter: {
    saveTask: async (_task, patch) => ({ task: { ...task, ...patch, updatedAt: "saved" } }),
    readWorkspace: async () => ++reads === 1 ? null : { data: { ...data, tasks: [{ ...task, title: "Current card" }] } },
  } });
  planning.activatePlanningView();
  await planning.saveTask(task, { title: "Confirmed card" });
  await vi.advanceTimersByTimeAsync(500);
  expect(planning.workspace("planning")).toMatchObject({ readStatus: "unavailable", tasks: [{ title: "Confirmed card" }] });
  await vi.advanceTimersByTimeAsync(10_000);
  expect(reads).toBe(1);
  await expect(planning.refreshWorkspace("planning")).resolves.toBe(true);
  expect(reads).toBe(2);
});

test("leaving cancels only unnecessary reads while a pending write can still confirm", async () => {
  const write = deferred<{ task: Task }>(), read = deferred<PlanningWorkspaceRead>();
  const { planning } = createPlanningState({ userId: "reader", initialData: data, adapter: {
    saveTask: () => write.promise, readWorkspace: () => read.promise,
  } });
  const leave = planning.activatePlanningView();
  const reading = planning.refreshWorkspace("planning");
  const saving = planning.saveTask(task, { title: "Saved after leaving" });
  leave();
  write.resolve({ task: { ...task, title: "Saved after leaving", updatedAt: "saved" } });
  await expect(saving).resolves.toMatchObject({ ok: true });
  read.resolve({ data });
  await expect(reading).resolves.toBe(false);
  expect(planning.taskDetail(task.id).task?.title).toBe("Saved after leaving");
});

test("old-session denials cannot hide a replacement session or restore its previous selection", async () => {
  const denied = deferred<PlanningWorkspaceRead>();
  const session = { userId: "reader", revision: "old", expiresAt: Date.now() / 1000 + 3600, user: { id: "reader" } };
  let reads = 0;
  const owner = createPlanningState({ userId: "reader", initialData: data, initialSession: session, adapter: {
    saveTask: async () => ({ task }), readWorkspace: async () => ++reads === 1 ? denied.promise : { data },
  } });
  owner.planning.rememberPlanningInteraction({ selectedTaskId: task.id, position: { queryKey: "old", top: 100, left: 50 } });
  const reading = owner.planning.refreshWorkspace("planning");
  owner.internal.bindSession({ ...session, revision: "replacement" });
  expect(owner.planning.planningInteraction()).toEqual({ selectedTaskId: null });
  await owner.planning.refreshWorkspace("planning");
  denied.reject({ status: 403 });
  await expect(reading).resolves.toBe(false);
  expect(owner.planning.workspace("planning")).toMatchObject({ readStatus: "current", tasks: [task] });
});

test("expired read authority rejects every field and leaves an explicit retryable failure", async () => {
  const { planning } = createPlanningState({ userId: "reader", initialData: data, adapter: {
    now: () => 2000, saveTask: async () => ({ task }),
    readWorkspace: async () => ({ data: { ...data, tasks: [{ ...task, title: "Expired response", note: "Rejected detail" }] }, taskCoverage: "complete", readAuthority: { userId: "reader", deadline: 1000 } }),
  } });
  await expect(planning.refreshWorkspace("planning")).resolves.toBe(false);
  expect(planning.workspace("planning")).toMatchObject({ readStatus: "unavailable", tasks: [task] });
  expect(planning.taskDetail(task.id).task?.note).not.toBe("Rejected detail");
});

test("explicit refresh prioritizes the latest queued query and consumes the automatic quiet refresh", async () => {
  vi.useFakeTimers();
  const queries: unknown[] = [];
  const { planning } = createPlanningState({ userId: "reader", initialData: data, adapter: {
    saveTask: async (_task, patch) => ({ task: { ...task, ...patch, updatedAt: "saved" } }),
    readWorkspace: async (_workspace, query) => { queries.push(query); return { data, query }; },
  } });
  planning.activatePlanningView();
  await planning.saveTask(task, { title: "Confirmed card" });
  const queued = planning.scheduleBoardQuery({ filters: { query: "latest query" } });
  await expect(planning.refreshWorkspace("planning")).resolves.toBe(true);
  expect(queries).toMatchObject([{ filters: { query: "latest query" } }]);
  await expect(queued).resolves.toBe(false);
  await vi.advanceTimersByTimeAsync(1000);
  expect(queries).toHaveLength(1);
});
