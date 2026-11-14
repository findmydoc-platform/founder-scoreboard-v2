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
