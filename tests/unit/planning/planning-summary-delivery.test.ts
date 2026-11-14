import { expect, test } from "vitest";
import { createPlanningState, type PlanningStateAdapter, type PlanningWorkspaceRead } from "@/features/planning/model/internal/planning-state-owner";
import { normalizePlanningBoardQuery, planningBoardQueryKey, type PlanningBoardColumn } from "@/features/planning/model/planning-board-query";
import type { PlanningBoardSummaryFrame } from "@/features/planning/model/planning-board-summaries";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { taskDetailStoryTask } from "@/features/tasks/molecules/task-detail-story-fixtures";
import type { TaskStatus } from "@/lib/types";

const query = normalizePlanningBoardQuery({ view: "board", filters: {} });
const cardIds = ["summary-open", "summary-review"];
const authority = { userId: "reader", deadline: 9_000_000_000_000 };
const progress = { completed: 1, total: 2, unfinished: 1, percentage: 50 };

function read(column?: "Offen" | "Review"): PlanningWorkspaceRead {
  const cards = column ? [taskDetailStoryTask({ id: column === "Offen" ? cardIds[0] : cardIds[1], status: column })] : [];
  const columns = Object.fromEntries((["Offen", "In Arbeit", "Review", "Nacharbeit", "Blockiert", "Erledigt", "Pausiert"] as TaskStatus[]).map(status => {
    const total = status === "Offen" || status === "Review" ? 1 : 0;
    return [status, { total, loaded: status === column ? 1 : 0, availability: total && status !== column ? "not-loaded" : "ready",
      completeness: total && status !== column ? "partial" : "complete", continuation: null } satisfies PlanningBoardColumn];
  })) as Record<TaskStatus, PlanningBoardColumn>;
  return { data: { ...emptyPlanningShellState, tasks: cards }, readAuthority: authority, scopeRevision: "42", query,
    taskCoverage: "partial", coverage: { tasks: "partial" }, board: {
      query, queryKey: planningBoardQueryKey(query), revision: "same-source", observedAt: "2026-11-13T12:00:00Z", validUntil: null,
      column, cardIds: cards.map(task => task.id), columns, metrics: { total: 2, open: 2, blocked: null, done: 0 },
      childProgressById: Object.fromEntries(cards.map(task => [task.id, null])), attentionById: Object.fromEntries(cards.map(task => [task.id, null])),
      viewerOpenSubIssueIdsByDeliverableId: {}, workspaceRevision: { activeTaskCount: 2, latestUpdatedAt: "same-source" },
      summaryRequests: [{ token: "original-summary-batch", cardIds, status: "loading" }],
    } };
}

function summaries(): PlanningBoardSummaryFrame {
  return { kind: "summaries", readId: "independent-summary", token: "original-summary-batch", cardIds,
    scopeRevision: "42", queryRevision: "same-source", observedAt: "2026-11-13T12:00:00Z", validUntil: null,
    childProgressById: Object.fromEntries(cardIds.map(id => [id, progress])) };
}

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

function nativeOwner(adapter: Partial<PlanningStateAdapter> = {}) {
  const open = read("Offen"), review = read("Review"), data = { ...open.data, tasks: [...open.data.tasks, ...review.data.tasks] };
  const session = { userId: "reader", user: { id: "reader" }, revision: "original-session", expiresAt: authority.deadline / 1000 };
  const board = { ...open.board!, column: undefined, cardIds,
    columns: { ...open.board!.columns, Review: review.board!.columns.Review },
    childProgressById: Object.fromEntries(cardIds.map(id => [id, null])), attentionById: Object.fromEntries(cardIds.map(id => [id, null])),
    delivery: { id: "independent-summary", columns: [] as TaskStatus[] } };
  return createPlanningState({ userId: "reader", initialData: data, initialSession: session,
    initialWorkspaceRead: { workspace: "planning", session, readAuthority: authority, coverage: { tasks: "partial" }, taskOmittedFields: [],
      query, queryKey: planningBoardQueryKey(query), scopeRevision: "42", revision: "same-source", queryRevision: "same-source", board },
    adapter: { saveTask: async (task, patch) => ({ task: { ...task, ...patch, updatedAt: "confirmed" } }),
      readWorkspace: async (_workspace, input) => {
        const result = read("Offen"), nextQuery = normalizePlanningBoardQuery(input);
        return { ...result, query: nextQuery, board: { ...result.board!, query: nextQuery, queryKey: planningBoardQueryKey(nextQuery) } };
      }, ...adapter },
  });
}

test("an unsolicited summary cannot reserve authority and malformed or incompatible native summaries remain unknown", async () => {
  const changes: Array<(frame: PlanningBoardSummaryFrame) => PlanningBoardSummaryFrame> = [
    frame => ({ ...frame, scopeRevision: "another-source" }),
    frame => ({ ...frame, queryRevision: "another-query" }),
    frame => ({ ...frame, observedAt: "2026-11-13T12:00:01Z" }),
    frame => ({ ...frame, validUntil: "2099-01-01T00:00:00Z" }),
    frame => ({ ...frame, cardIds: [cardIds[0]] }),
    frame => ({ ...frame, childProgressById: { [cardIds[0]]: progress } }),
    frame => ({ ...frame, childProgressById: { ...frame.childProgressById, [cardIds[1]]: { ...progress, percentage: 49 } } }),
    frame => ({ ...frame, attentionById: { [cardIds[0]]: [] } }),
  ];
  for (const change of changes) {
    const owner = nativeOwner(), state = owner.planning;
    expect(await state.acceptServerBoardSummary("unsolicited", { ...summaries(), readId: "unsolicited" })).toBe(false);
    expect(await state.acceptServerBoardSummary("independent-summary", change(summaries()))).toBe(false);
    expect(state.board().tasks.map(task => task.id)).toEqual(cardIds);
    expect(state.board().result!.summaryRequests?.[0].status).toBe("unavailable");
    expect(state.board().result!.childProgressById).toEqual(Object.fromEntries(cardIds.map(id => [id, null])));
    owner.internal.dispose();
  }
});

test("an explicit pending summary retry supersedes the delayed initial receipt", async () => {
  const response = deferred<{ summaries: PlanningBoardSummaryFrame; readAuthority: typeof authority }>();
  let calls = 0;
  const owner = nativeOwner({ readBoardSummaries: async () => { calls++; return response.promise; } });
  const retry = owner.planning.refreshBoardSummaries();
  expect(await owner.planning.acceptServerBoardSummary("independent-summary", summaries())).toBe(false);
  expect(owner.planning.board().result!.childProgressById[cardIds[0]]).toBeNull();
  response.resolve({ summaries: summaries(), readAuthority: authority });
  expect(await retry).toBe(true);
  expect(calls).toBe(1);
  expect(owner.planning.board().result!.childProgressById[cardIds[0]]).toEqual(progress);
  owner.internal.dispose();
});

test("a confirmed card write invalidates the original summary evidence before a delayed receipt can publish", async () => {
  const response = deferred<{ summaries: PlanningBoardSummaryFrame; readAuthority: typeof authority }>();
  const owner = nativeOwner({ readBoardSummaries: async () => response.promise });
  const retry = owner.planning.refreshBoardSummaries(), task = owner.planning.board().tasks[0];
  expect(await owner.planning.saveTask(task, { title: "Confirmed while summary pending" })).toMatchObject({ ok: true });
  expect(owner.planning.board().freshness).toBe("stale");
  response.resolve({ summaries: summaries(), readAuthority: authority });
  expect(await retry).toBe(false);
  expect(owner.planning.board().tasks[0].title).toBe("Confirmed while summary pending");
  expect(owner.planning.board().result!.childProgressById[cardIds[0]]).toBeNull();
  owner.internal.dispose();
});

test("query and session replacement reject old summary success while only a current-session denial remains effective", async () => {
  for (const replacement of ["query", "session"] as const) {
    const response = deferred<{ summaries: PlanningBoardSummaryFrame; readAuthority: typeof authority }>();
    const owner = nativeOwner({ readBoardSummaries: async () => response.promise });
    const retry = owner.planning.refreshBoardSummaries();
    if (replacement === "session") owner.internal.bindSession({ userId: "reader", user: { id: "reader" }, revision: "replacement-session", expiresAt: authority.deadline / 1000 });
    const next = normalizePlanningBoardQuery({ view: "board", filters: { query: "replacement" } });
    expect(await owner.planning.ensureBoardQuery(next)).toBe(true);
    response.resolve({ summaries: summaries(), readAuthority: authority });
    expect(await retry).toBe(false);
    expect(owner.planning.board().readStatus).toBe("current");
    expect(owner.planning.board().result!.queryKey).toBe(planningBoardQueryKey(next));
    expect(owner.planning.board().result!.childProgressById[cardIds[0]]).toBeNull();
    expect(await owner.planning.acceptServerBoardSummary("independent-summary", { kind: "failure", readId: "independent-summary", area: "summaries", token: "original-summary-batch", status: 403, error: "Old denial" })).toBe(false);
    if (replacement === "query") {
      expect(owner.planning.board().readStatus).toBe("forbidden");
      expect(owner.planning.board().tasks).toEqual([]);
    } else {
      expect(owner.planning.board().readStatus).toBe("current");
      expect(owner.planning.board().result!.queryKey).toBe(planningBoardQueryKey(next));
      expect(owner.planning.board().result!.childProgressById[cardIds[0]]).toBeNull();
    }
    owner.internal.dispose();
  }
});

test("current summary failures distinguish denied protected scope from changed source", async () => {
  for (const status of [403, 409] as const) {
    const owner = nativeOwner({ readBoardSummaries: async () => { throw { status }; } });
    expect(await owner.planning.refreshBoardSummaries()).toBe(false);
    expect(owner.planning.board().readStatus).toBe(status === 403 ? "forbidden" : "stale");
    if (status === 403) expect(owner.planning.board().tasks).toEqual([]);
    else {
      expect(owner.planning.board().tasks.map(task => task.id)).toEqual(cardIds);
      expect(owner.planning.board().freshness).toBe("stale");
    }
    owner.internal.dispose();
  }
});

test("a complete early summary survives later selected-card columns with unknown summary defaults", async () => {
  let emit: NonNullable<Parameters<PlanningStateAdapter["readWorkspace"]>[2]>["onBoardStream"];
  const transport = deferred<PlanningWorkspaceRead | null>();
  const owner = createPlanningState({ userId: "reader", initialData: emptyPlanningShellState, adapter: {
    saveTask: async task => ({ task }), readWorkspace: async (_workspace, _query, options) => {
      emit = options?.onBoardStream; return transport.promise;
    },
  } });
  const pending = owner.planning.ensureBoardQuery(query);
  try {
    emit!({ kind: "basis", readId: "independent-summary", read: read() });
    emit!({ kind: "outcome", outcome: { ...summaries(), attentionById: Object.fromEntries(cardIds.map(id => [id, []])) } });
    expect(owner.planning.board().result!.summaryRequests?.[0].status).toBe("current");
    for (const column of ["Offen", "Review"] as const) {
      const selected = read(column);
      emit!({ kind: "outcome", outcome: { kind: "column", readId: "independent-summary", column,
        scopeRevision: "42", queryRevision: "same-source", observedAt: summaries().observedAt, validUntil: null,
        cardIds: selected.board!.cardIds, items: selected.data.tasks, relationships: [], personalChildren: {}, taskOmittedFields: [],
        columnState: selected.board!.columns[column] } });
    }
    transport.resolve(null); await pending;
    expect(owner.planning.board().tasks.map(task => task.id)).toEqual(cardIds);
    expect(owner.planning.board().result!.childProgressById).toEqual(Object.fromEntries(cardIds.map(id => [id, progress])));
    expect(owner.planning.board().result!.attentionById).toEqual(Object.fromEntries(cardIds.map(id => [id, []])));
    expect(owner.planning.board().result!.summaryRequests?.[0].status).toBe("current");
  } finally { transport.resolve(null); await pending; owner.internal.dispose(); }
});

test("the existing owner retains ready cards after a summary failure and coalesces aggregate-only recovery", async () => {
  let emit: NonNullable<Parameters<PlanningStateAdapter["readWorkspace"]>[2]>["onBoardStream"];
  let finish!: (read: PlanningWorkspaceRead | null) => void, workspaceReads = 0, summaryReads = 0;
  const transport = new Promise<PlanningWorkspaceRead | null>(resolve => { finish = resolve; });
  const adapter = {
    saveTask: async (task: import("@/lib/types").Task) => ({ task }),
    readWorkspace: async (_workspace: unknown, _query: unknown, options?: Parameters<PlanningStateAdapter["readWorkspace"]>[2]) => {
      workspaceReads++; emit = options?.onBoardStream; return transport;
    },
    readBoardSummaries: async (token: string) => {
      summaryReads++; expect(token).toBe("original-summary-batch");
      return { summaries: summaries(), readAuthority: authority };
    },
  };
  const state = createPlanningState({ userId: "reader", initialData: emptyPlanningShellState, adapter }).planning;
  const pending = state.ensureBoardQuery(query);
  try {
    expect(emit).toBeTypeOf("function");
    emit!({ kind: "basis", readId: "independent-summary", read: read() });
    for (const column of ["Offen", "Review"] as const) emit!({ kind: "column", readId: "independent-summary", column, read: read(column) });
    emit!({ kind: "outcome", outcome: { kind: "failure", readId: "independent-summary", area: "summaries", token: "original-summary-batch", status: 503, error: "Synthetic summary unavailable" } });
    finish(null); await pending;
    expect(state.board().tasks.map(task => task.id)).toEqual(cardIds);
    expect(state.board().result!.childProgressById).toEqual({ [cardIds[0]]: null, [cardIds[1]]: null });
    expect(state.board().result!.summaryRequests?.[0].status).toBe("unavailable");
    const recovered = await Promise.all([state.refreshBoardSummaries(), state.refreshBoardSummaries()]);
    expect(recovered).toEqual([true, true]);
    expect(summaryReads).toBe(1);
    expect(workspaceReads).toBe(1);
    expect(state.board().tasks.map(task => task.id)).toEqual(cardIds);
    expect(state.board().result!.childProgressById).toEqual({ [cardIds[0]]: progress, [cardIds[1]]: progress });
    expect(state.board().result!.summaryRequests?.[0].status).toBe("current");
    expect(state.taskDetail(cardIds[0]).childrenReadStatus).toBe("not-loaded");
  } finally { finish(null); await pending; }
});

test("a successful page batch preserves earlier missing demand and known summaries for its targeted retry", async () => {
  const openRead = read("Offen"), reviewRead = read("Review"), newId = "summary-next-page";
  const knownEmpty = { completed: 0, total: 0, unfinished: 0, percentage: 0 };
  const initial: PlanningWorkspaceRead = { ...reviewRead, data: { ...reviewRead.data, tasks: [...openRead.data.tasks, ...reviewRead.data.tasks] },
    board: { ...reviewRead.board!, column: undefined, cardIds,
      columns: { ...reviewRead.board!.columns, Offen: openRead.board!.columns.Offen,
        Review: { total: 2, loaded: 1, availability: "ready", completeness: "partial", continuation: "next-page" } },
      metrics: { total: 3, open: 3, done: 0, blocked: 0 },
      childProgressById: { [cardIds[0]]: progress, [cardIds[1]]: null }, attentionById: { [cardIds[0]]: [], [cardIds[1]]: null },
      summaryRequests: [{ token: "original-summary-batch", cardIds, status: "unavailable" }],
    } };
  const page: PlanningWorkspaceRead = { ...reviewRead, data: { ...reviewRead.data, tasks: [taskDetailStoryTask({ id: newId, status: "Review" })] },
    board: { ...reviewRead.board!, cardIds: [newId], columns: { ...reviewRead.board!.columns,
      Review: { total: 2, loaded: 1, availability: "ready", completeness: "complete", continuation: null } },
      metrics: { total: 3, open: 3, done: 0, blocked: 0 },
      childProgressById: { [newId]: knownEmpty }, attentionById: { [newId]: [] },
      summaryRequests: [{ token: "page-summary-batch", cardIds: [newId], status: "current" }],
    } };
  let workspaceReads = 0, summaryReads = 0;
  const state = createPlanningState({ userId: "reader", initialData: emptyPlanningShellState, adapter: {
    saveTask: async task => ({ task }),
    readWorkspace: async (_workspace, input) => {
      workspaceReads++;
      if (input?.column) { expect(input.continuation).toBe("next-page"); return page; }
      return initial;
    },
    readBoardSummaries: async token => {
      summaryReads++; expect(token).toBe("original-summary-batch");
      return { summaries: summaries(), readAuthority: authority };
    },
  } }).planning;
  expect(await state.ensureBoardQuery(query)).toBe(true);
  expect(state.board().result!.childProgressById[cardIds[0]]).toEqual(progress);
  expect(await state.loadBoardColumn("Review")).toBe(true);
  expect(state.board().tasks.map(task => task.id)).toEqual([...cardIds, newId]);
  expect(state.board().result!.summaryRequests?.map(request => [request.token, request.status])).toEqual([
    ["original-summary-batch", "unavailable"], ["page-summary-batch", "current"],
  ]);
  expect(state.board().result!.childProgressById).toEqual({ [cardIds[0]]: progress, [cardIds[1]]: null, [newId]: knownEmpty });
  expect(await state.refreshBoardSummaries()).toBe(true);
  expect(summaryReads).toBe(1);
  expect(workspaceReads).toBe(2);
  expect(state.board().result!.childProgressById).toEqual({ [cardIds[0]]: progress, [cardIds[1]]: progress, [newId]: knownEmpty });
  expect(state.board().result!.summaryRequests?.every(request => request.status === "current")).toBe(true);
});
