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

test.each([403, 409] as const)("a fatal %s stream outcome invalidates the whole accepted query basis", async status => {
  let emit: ((event: Progress) => void) | undefined, signal: AbortSignal | undefined;
  const transport = deferred<PlanningWorkspaceRead | null>();
  const state = createPlanningState({ userId: "reader", initialData: emptyPlanningShellState, adapter: { saveTask: async task => ({ task }), readWorkspace: async (_workspace, _query, options) => {
    emit = options?.onBoardStream as typeof emit; signal = options?.signal; return transport.promise;
  } } }).planning;
  const pending = state.ensureBoardQuery(query);
  try {
    emit!({ kind: "basis", readId: "fatal", read: read(query) });
    emit!({ kind: "column", readId: "fatal", column: "Review", read: read(query, "Review") });
    expect(state.board().tasks.map(task => task.id)).toEqual(["first-Review"]);
    emit!({ kind: "failure", readId: "fatal", column: "Offen", error: { status, ...(status === 409 ? { code: "stale_continuation" } : {}) } });
    expect(signal?.aborted).toBe(true);
    if (status === 403) {
      expect(state.board().tasks).toEqual([]); expect(state.workspace("planning").tasks).toEqual([]);
      expect(state.board().readStatus).toBe("forbidden");
    } else {
      expect(state.board().freshness).toBe("stale"); expect(state.board().sourceStatus).toBe("changed");
      for (const column of statuses) {
        expect(state.board().columnReadStatus?.[column]).toBe("stale");
        expect(state.board().result?.columns[column].continuation).toBeNull();
      }
    }
  } finally { transport.resolve(null); await pending; }
});

test("a targeted retry supersedes its initial stream token without cancelling or overwriting a ready sibling", async () => {
  let emit: ((event: Progress) => void) | undefined, signal: AbortSignal | undefined, calls = 0;
  const transport = deferred<PlanningWorkspaceRead | null>();
  const state = createPlanningState({ userId: "reader", initialData: emptyPlanningShellState, adapter: { saveTask: async task => ({ task }), readWorkspace: async (_workspace, input, options) => {
    calls++;
    if (input?.column) {
      const current = read(query, input.column);
      return { ...current, data: { ...current.data, tasks: current.data.tasks.map(task => ({ ...task, title: "Current authorized retry" })) } };
    }
    emit = options?.onBoardStream as typeof emit; signal = options?.signal; return transport.promise;
  } } }).planning;
  const pending = state.ensureBoardQuery(query);
  try {
    emit!({ kind: "basis", readId: "retry", read: read(query) });
    emit!({ kind: "column", readId: "retry", column: "Review", read: read(query, "Review") });
    expect(await state.refreshBoardColumn("Offen")).toBe(true);
    expect(signal?.aborted).toBe(false);
    const obsolete = read(query, "Offen");
    emit!({ kind: "column", readId: "retry", column: "Offen", read: { ...obsolete, data: { ...obsolete.data, tasks: obsolete.data.tasks.map(task => ({ ...task, title: "Obsolete initial stream", updatedAt: "2099-01-01T00:00:00Z" })) } } });
    expect(state.board().tasks.find(task => task.id === "first-Offen")?.title).toBe("Current authorized retry");
    expect(state.board().tasks.some(task => task.id === "first-Review")).toBe(true);
    expect(calls).toBe(2);
  } finally { transport.resolve(null); await pending; }
});

test("native column receipts cannot reserve an unsolicited read or reenter a replaced query", async () => {
  const epoch = Date.parse("2026-11-13T12:00:00Z"), basis = read(query);
  const session = { userId: "reader", user: { id: "reader" }, revision: "native-session", expiresAt: (epoch + 3_600_000) / 1000 };
  const initial = { workspace: "planning" as const, queryKey: planningBoardQueryKey(query), query, scopeRevision: "42", queryRevision: "same-source", revision: "same-source",
    board: { ...basis.board!, delivery: { id: "native", columns: ["Offen", "Review"] as TaskStatus[] } }, session,
    readAuthority: { userId: "reader", deadline: epoch + 10_000 }, coverage: { tasks: "partial" as const }, taskOmittedFields: [] };
  const state = createPlanningState({ userId: "reader", initialData: emptyPlanningShellState, initialWorkspaceRead: initial, initialSession: session,
    adapter: { now: () => epoch, saveTask: async task => ({ task }), readWorkspace: async (_workspace, input) => read(normalizePlanningBoardQuery(input), "Review", epoch + 10_000) },
  }).planning;
  const column = read(query, "Offen");
  const packet = { kind: "column" as const, readId: "native", column: "Offen" as const, scopeRevision: "42", queryRevision: "same-source", observedAt: "2026-11-13T12:00:00Z", validUntil: null,
    cardIds: column.board!.cardIds, items: column.data.tasks, relationships: [], columnState: column.board!.columns.Offen, personalChildren: {}, taskOmittedFields: [] };
  expect(await state.acceptServerBoardColumn("unsolicited", { ...packet, readId: "unsolicited" })).toBe(false);
  expect(state.board().tasks).toEqual([]);
  const next = normalizePlanningBoardQuery({ view: "board", filters: { query: "replacement" } });
  expect(await state.ensureBoardQuery(next)).toBe(true);
  expect(await state.acceptServerBoardColumn("native", packet)).toBe(false);
  expect(state.board().tasks.map(task => task.id)).toEqual(["replacement-Review"]);
});

test("a same-query streamed refresh retains an operated card until the interaction ends", async () => {
  let emit: ((event: Progress) => void) | undefined, calls = 0;
  const transport = deferred<PlanningWorkspaceRead | null>();
  const initial = read(query, "Review");
  const state = createPlanningState({ userId: "reader", initialData: emptyPlanningShellState, adapter: {
    saveTask: async task => ({ task }), readWorkspace: async (_workspace, _query, options) => {
      calls++;
      if (calls === 1) return initial;
      emit = options?.onBoardStream as typeof emit;
      return transport.promise;
    },
  } }).planning;
  expect(await state.ensureBoardQuery(query)).toBe(true);
  const original = state.board().tasks[0];
  expect(original.id).toBe("first-Review");
  const release = state.beginBoardInteraction();
  const refreshed = state.refreshWorkspace("planning");
  try {
    expect(emit).toBeTypeOf("function");
    emit!({ kind: "basis", readId: "same-query-refresh", read: read(query) });
    expect(state.board().freshness).toBe("stale");
    expect(state.board().tasks).toEqual([original]);
    const replacement = read(query, "Review");
    emit!({ kind: "column", readId: "same-query-refresh", column: "Review", read: {
      ...replacement, data: { ...replacement.data, tasks: replacement.data.tasks.map(task => ({ ...task, title: "Authorized replacement" })) },
    } });
    transport.resolve(null);
    expect(state.board().tasks).toEqual([original]);
    release();
    await refreshed;
    expect(state.board().tasks.map(task => task.title)).toEqual(["Authorized replacement"]);
    expect(calls).toBe(2);
  } finally { release(); transport.resolve(null); await refreshed; }
});

test.each([403, 409] as const)("a fatal %s frame invalidates a same-query refresh before its interaction hold ends", async status => {
  let emit: ((event: Progress) => void) | undefined, signal: AbortSignal | undefined, calls = 0;
  const transport = deferred<PlanningWorkspaceRead | null>();
  const state = createPlanningState({ userId: "reader", initialData: emptyPlanningShellState, adapter: {
    saveTask: async task => ({ task }), readWorkspace: async (_workspace, _query, options) => {
      if (++calls === 1) return read(query, "Review");
      emit = options?.onBoardStream as typeof emit; signal = options?.signal;
      return transport.promise;
    },
  } }).planning;
  expect(await state.ensureBoardQuery(query)).toBe(true);
  const release = state.beginBoardInteraction();
  const refreshed = state.refreshWorkspace("planning");
  try {
    emit!({ kind: "basis", readId: "held-fatal", read: read(query) });
    expect(state.board().freshness).toBe("stale");
    emit!({ kind: "failure", readId: "held-fatal", column: "Offen", error: { status, ...(status === 409 ? { code: "stale_continuation" } : {}) } });
    expect(signal?.aborted).toBe(true);
    if (status === 403) {
      expect(state.board().tasks).toEqual([]);
      expect(state.workspace("planning").tasks).toEqual([]);
      expect(state.board().readStatus).toBe("forbidden");
    } else {
      expect(state.board().sourceStatus).toBe("changed");
      expect(state.board().freshness).toBe("stale");
    }
    emit!({ kind: "column", readId: "held-fatal", column: "Offen", read: read(query, "Offen") });
    release(); transport.resolve(null); await refreshed;
    expect(state.board().tasks.some(task => task.id === "first-Offen")).toBe(false);
  } finally { release(); transport.resolve(null); await refreshed; }
});
