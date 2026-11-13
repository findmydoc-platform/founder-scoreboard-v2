import { expect, test } from "vitest";
import { createPlanningState, type PlanningWorkspaceRead } from "@/features/planning/model/internal/planning-state-owner";
import { normalizePlanningBoardQuery, planningBoardQueryKey, type PlanningBoardColumn, type PlanningBoardQuery } from "@/features/planning/model/planning-board-query";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { taskDetailStoryTask } from "@/features/tasks/molecules/task-detail-story-fixtures";
import type { TaskStatus } from "@/lib/types";

type Progress = { kind: "basis"; readId: string; read: PlanningWorkspaceRead } | { kind: "column"; readId: string; column: TaskStatus; read: PlanningWorkspaceRead } | { kind: "failure"; readId: string; column?: TaskStatus; error: { status: number; code?: string } };
const statuses: TaskStatus[] = ["Offen", "In Arbeit", "Review", "Nacharbeit", "Blockiert", "Erledigt", "Pausiert"];
const query = normalizePlanningBoardQuery({ view: "board", filters: {} });
function read(input: PlanningBoardQuery, column?: TaskStatus, deadline?: number): PlanningWorkspaceRead {
  const cards = column ? [taskDetailStoryTask({ id: `${input.filters.query || "first"}-${column}`, status: column })] : [];
  const columns = Object.fromEntries(statuses.map(status => {
    const total = status === "Offen" || status === "Review" ? 1 : 0;
    const ready = total === 0 || status === column;
    return [status, { total: column && status !== column ? null : total, loaded: status === column ? cards.length : 0, availability: ready ? "ready" : "not-loaded", completeness: ready ? "complete" : "partial", continuation: null } satisfies PlanningBoardColumn];
  })) as Record<TaskStatus, PlanningBoardColumn>;
  return { data: { ...emptyPlanningShellState, tasks: cards }, readAuthority: deadline ? { userId: "reader", deadline } : undefined, scopeRevision: "42", query: input, taskCoverage: "partial", coverage: { tasks: "partial" },
    board: { query: input, column, queryKey: planningBoardQueryKey(input), revision: "same-source", observedAt: "2026-11-13T12:00:00Z", columns, cardIds: cards.map(task => task.id), metrics: { total: 2, open: 2, done: 0, blocked: null }, childProgressById: Object.fromEntries(cards.map(task => [task.id, null])), attentionById: Object.fromEntries(cards.map(task => [task.id, null])), viewerOpenSubIssueIdsByDeliverableId: {}, workspaceRevision: { activeTaskCount: 2, latestUpdatedAt: "same-source" } },
  };
}
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }

test("one owner query accepts a later streamed column while the first is pending and retries only a failed column", async () => {
  let emit: ((event: Progress) => void) | undefined, calls = 0;
  const transport = deferred<PlanningWorkspaceRead | null>();
  const state = createPlanningState({ userId: "reader", initialData: emptyPlanningShellState, adapter: {
    saveTask: async task => ({ task }),
    readWorkspace: async (_workspace, input, options) => {
      calls++;
      if (input?.column) return read(query, input.column);
      emit = (options as { onBoardStream?: (event: Progress) => void } | undefined)?.onBoardStream;
      return transport.promise;
    },
  } }).planning;
  const pending = state.ensureBoardQuery(query);
  try {
    expect(emit, "The existing owner must consume progress before the transport completes").toBeTypeOf("function");
    emit!({ kind: "basis", readId: "owned-read", read: read(query) });
    expect(state.board().columnReadStatus?.Offen).toBe("loading");
    emit!({ kind: "column", readId: "owned-read", column: "Review", read: read(query, "Review") });
    expect(state.board().tasks.map(task => task.id)).toEqual(["first-Review"]);
    expect(state.board().columnReadStatus?.Review).toBe("current");
    expect(state.board().columnReadStatus?.Offen).toBe("loading");
    emit!({ kind: "failure", readId: "owned-read", column: "Offen", error: { status: 503 } });
    transport.resolve(null); await pending;
    expect(state.board().columnReadStatus?.Offen).toBe("unavailable");
    expect(state.board().tasks.map(task => task.id)).toEqual(["first-Review"]);
    expect(calls).toBe(1);
    expect(await state.refreshBoardColumn("Offen")).toBe(true);
    expect(calls).toBe(2);
    expect(state.board().tasks.map(task => task.id)).toEqual(["first-Review", "first-Offen"]);
  } finally { transport.resolve(null); await pending; }
});

test("a new query cancels shared delivery and rejects obsolete column frames without clearing the new scope", async () => {
  const deliveries: Array<{ emit?: (event: Progress) => void; signal?: AbortSignal; gate: ReturnType<typeof deferred<PlanningWorkspaceRead | null>> }> = [];
  const state = createPlanningState({ userId: "reader", initialData: emptyPlanningShellState, adapter: { saveTask: async task => ({ task }), readWorkspace: async (_workspace, _query, options) => {
    const gate = deferred<PlanningWorkspaceRead | null>();
    deliveries.push({ emit: (options as { onBoardStream?: (event: Progress) => void } | undefined)?.onBoardStream, signal: options?.signal, gate }); return gate.promise;
  } } }).planning;
  const first = state.ensureBoardQuery(query);
  const nextQuery = normalizePlanningBoardQuery({ view: "board", filters: { query: "replacement" } });
  let second: Promise<boolean> | undefined;
  try {
    expect(deliveries[0].emit).toBeTypeOf("function");
    deliveries[0].emit!({ kind: "basis", readId: "first", read: read(query) });
    second = state.ensureBoardQuery(nextQuery);
    expect(deliveries[0].signal?.aborted).toBe(true);
    expect(deliveries[1].emit).toBeTypeOf("function");
    deliveries[1].emit!({ kind: "basis", readId: "replacement", read: read(nextQuery) });
    deliveries[1].emit!({ kind: "column", readId: "replacement", column: "Review", read: read(nextQuery, "Review") });
    deliveries[0].emit!({ kind: "column", readId: "first", column: "Offen", read: read(query, "Offen") });
    expect(state.board().tasks.map(task => task.id)).toEqual(["replacement-Review"]);
    expect(state.board().query?.filters.query).toBe("replacement");
  } finally { for (const delivery of deliveries) delivery.gate.resolve(null); await first; await second; }
});

test("streamed later evidence never extends the original query authority deadline", async () => {
  const epoch = Date.parse("2026-11-13T12:00:00Z"); let now = epoch;
  let emit: ((event: Progress) => void) | undefined;
  const transport = deferred<PlanningWorkspaceRead | null>();
  const state = createPlanningState({ userId: "reader", initialData: emptyPlanningShellState,
    initialSession: { userId: "reader", user: { id: "reader" }, revision: "same-session", expiresAt: (epoch + 3_600_000) / 1000 },
    adapter: { now: () => now, saveTask: async task => ({ task }), readWorkspace: async (_workspace, _query, options) => {
      emit = (options as { onBoardStream?: (event: Progress) => void } | undefined)?.onBoardStream; return transport.promise;
    } },
  }).planning;
  const pending = state.ensureBoardQuery(query);
  try {
    expect(emit).toBeTypeOf("function");
    emit!({ kind: "basis", readId: "deadline", read: read(query, undefined, epoch + 1000) });
    now = epoch + 100;
    emit!({ kind: "column", readId: "deadline", column: "Review", read: read(query, "Review", epoch + 1000) });
    expect(state.board().tasks.map(task => task.id)).toEqual(["first-Review"]);
    now = epoch + 1000;
    emit!({ kind: "column", readId: "deadline", column: "Offen", read: read(query, "Offen", epoch + 5000) });
    expect(state.board().tasks).toEqual([]);
    expect(state.workspace("planning").tasks).toEqual([]);
  } finally { transport.resolve(null); await pending; }
});
