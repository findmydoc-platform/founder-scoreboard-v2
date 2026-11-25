import { expect, test } from "vitest";
import { createPlanningState, type PlanningWorkspaceRead } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { taskDetailStoryTask } from "@/features/tasks/molecules/task-detail-story-fixtures";
import { normalizeBacklogSelection } from "@/features/backlog/model/backlog-selection";
import { DEFAULT_BACKLOG_FILTERS } from "@/features/backlog/model/backlog-view-model";
import type { BacklogRankQuery, BacklogRankTarget } from "@/features/backlog/model/backlog-rank-target";
import type { BacklogOrderPatch, BacklogOrderResult, BacklogMoveAction } from "@/features/backlog/model/backlog-ordering";
import type { Task } from "@/lib/types";
const userId = "relative-backlog-user";
const actor = { id: "relative-backlog-ceo", name: "Synthetic CEO", platformRole: "ceo" as const, orgRole: "CEO", githubLogin: "", weeklyCapacity: 40 };
const originalVersion = "2026-11-01T12:00:00.000Z", savedVersion = "2026-11-01T12:00:01.000Z", newerVersion = "2026-11-01T12:00:02.000Z";
const source = taskDetailStoryTask({ id: "rank-source", title: "Source at rank 1000", order: 10000, note: "Retained source note", updatedAt: originalVersion });
const target = taskDetailStoryTask({ id: "rank-offpage-target", title: "Off-page first target", order: 10, updatedAt: originalVersion });
const unrelated = taskDetailStoryTask({ id: "rank-unrelated", title: "Unrelated current row", order: 500, note: "Original unrelated note", updatedAt: originalVersion });
const pageQuery = normalizeBacklogSelection({ view: "backlog", filters: DEFAULT_BACKLOG_FILTERS, limit: 1, continuation: "original-source-page" })!;
const restartedQuery = { ...pageQuery, continuation: undefined };
type RankRead = PlanningWorkspaceRead & { backlogRankTarget: BacklogRankTarget };
type RelativePort = { moveBacklogRelative?(shown: Task, action: BacklogMoveAction, options?: { signal?: AbortSignal }): Promise<BacklogOrderResult> };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function envelope(): PlanningWorkspaceRead {
  return { data: emptyPlanningShellState, readAuthority: { userId, deadline: Date.now() + 60_000 }, readActor: { profileId: actor.id, platformRole: actor.platformRole },
    coverage: { tasks: "partial" }, taskCoverage: "partial", taskOmittedFields: ["note", "evidenceLinks"], backlogCoverage: { items: "partial", people: "partial", sprints: "partial", commitments: "partial" } };
}
function selectedRead(saved = false): PlanningWorkspaceRead {
  const base = envelope(), revision = saved ? "rank-source-two" : "rank-source-one";
  return { ...base, data: { ...emptyPlanningShellState, tasks: [{ ...source, order: saved ? 10 : source.order, updatedAt: saved ? savedVersion : originalVersion }] },
    backlogSelection: { query: saved ? restartedQuery : pageQuery, itemIds: [source.id], contextIds: [], rankById: { [source.id]: saved ? 1 : 1000 },
      total: 1008, coverage: "partial", continuation: "next-page", sourceRevision: revision, scopeRevision: revision,
      observedAt: new Date().toISOString(), validUntil: new Date(base.readAuthority!.deadline).toISOString() } };
}
function rankRead(query: BacklogRankQuery): RankRead {
  const base = envelope();
  return { ...base, data: { ...emptyPlanningShellState, tasks: [{ ...target, detailAvailability: "summary" }] },
    backlogRankTarget: { sourceId: query.sourceId, sourceUpdatedAt: query.sourceUpdatedAt, action: query.action, targetId: target.id, placement: "before", noop: false,
      sourceRevision: query.sourceRevision, scopeRevision: "relative-scope", observedAt: new Date().toISOString(), validUntil: new Date(base.readAuthority!.deadline).toISOString() } };
}
function session() { return { userId, user: { id: userId }, revision: "relative-session", expiresAt: (Date.now() + 3_600_000) / 1000 }; }
function canonicalUpdates(): BacklogOrderPatch[] {
  return Array.from({ length: 1008 }, (_, index) => {
    const originalRank = index + 1;
    const id = originalRank === 1 ? target.id : originalRank === 50 ? unrelated.id : originalRank === 1000 ? source.id : `unloaded-rank-${originalRank}`;
    return { id, sortOrder: (originalRank === 1000 ? 1 : originalRank < 1000 ? originalRank + 1 : originalRank) * 10, updatedAt: savedVersion };
  });
}

test("an explicit relative rank action resolves its off-page target once without optimistic full renumbering and refreshes the selected scope after canonical success", async () => {
  const write = deferred<{ updates: BacklogOrderPatch[]; completeness: "complete" }>(), dispatched = deferred<void>();
  const rankQueries: BacklogRankQuery[] = [], selectionQueries: unknown[] = []; let moves = 0;
  const owner = createPlanningState({ userId, initialData: { ...emptyPlanningShellState, tasks: [source, unrelated] }, initialCurrentProfile: actor, initialSession: session(), adapter: {
    saveTask: async () => ({ task: source }), readWorkspace: async workspace => {
      if (workspace !== "planning") throw new Error("A scoped outcome cannot fall back to a workspace read");
      return { data: { ...emptyPlanningShellState, tasks: [{ ...unrelated, order: 510, note: "Newer unrelated note", updatedAt: newerVersion }] }, taskCoverage: "partial" };
    },
    readBacklogSelection: async query => { selectionQueries.push(query); return selectedRead(selectionQueries.length > 1); },
    ...{ readBacklogRankTarget: async (query: BacklogRankQuery) => { rankQueries.push(query); return rankRead(query); } },
    moveBacklog: async (shownSource, shownTarget, placement) => {
      moves++; expect(shownSource.updatedAt).toBe(originalVersion); expect(shownTarget.updatedAt).toBe(originalVersion); expect(placement).toBe("before");
      dispatched.resolve(); return write.promise;
    },
  } });
  try {
    await owner.planning.loadBacklogSelection(pageQuery); expect(rankQueries).toEqual([]);
    const port = owner.planning as typeof owner.planning & RelativePort;
    const pending = port.moveBacklogRelative?.(source, "top");
    expect(rankQueries).toEqual([{ view: "backlog-rank", sourceId: source.id, sourceUpdatedAt: originalVersion, sourceRevision: "rank-source-one", action: "top" }]);
    await dispatched.promise;
    expect(owner.planning.taskDetail(source.id).task?.order).toBe(10000); expect(owner.planning.taskDetail(target.id).task?.order).toBe(10);
    await owner.planning.refreshWorkspace("planning");
    write.resolve({ updates: canonicalUpdates(), completeness: "complete" });
    expect(await pending).toMatchObject({ phase: "saved" });
    expect(selectionQueries).toHaveLength(2); expect(selectionQueries[1]).toEqual(restartedQuery);
    await owner.planning.loadBacklogSelection(restartedQuery); expect(selectionQueries).toHaveLength(2);
    expect(owner.planning.backlog().model.selection?.rankById[source.id]).toBe(1);
    expect(owner.planning.taskDetail(source.id).task?.order).toBe(10); expect(owner.planning.taskDetail(target.id).task?.order).toBe(20);
    expect(owner.planning.taskDetail(unrelated.id).task).toMatchObject({ order: 510, note: "Newer unrelated note", updatedAt: newerVersion });
    expect(moves).toBe(1); expect(rankQueries).toHaveLength(1);
  } finally { owner.internal.dispose(); }
});

test("a rejected relative rank mutation preserves the displayed source and newer foreign data without replay", async () => {
  const write = deferred<{ updates: BacklogOrderPatch[]; completeness: "complete" }>(), dispatched = deferred<void>(); let reads = 0, moves = 0;
  const owner = createPlanningState({ userId, initialData: { ...emptyPlanningShellState, tasks: [source, unrelated] }, initialCurrentProfile: actor, initialSession: session(), adapter: {
    saveTask: async () => ({ task: source }), readWorkspace: async () => ({ data: { ...emptyPlanningShellState, tasks: [{ ...unrelated, note: "Newer independent note", updatedAt: newerVersion }] }, taskCoverage: "partial" }),
    readBacklogSelection: async () => selectedRead(), ...{ readBacklogRankTarget: async (query: BacklogRankQuery) => { reads++; return rankRead(query); } },
    moveBacklog: async () => { moves++; dispatched.resolve(); await write.promise; throw Object.assign(new Error("Synthetic rejection"), { status: 403 }); },
  } });
  try {
    await owner.planning.loadBacklogSelection(pageQuery);
    const pending = (owner.planning as typeof owner.planning & RelativePort).moveBacklogRelative?.(source, "top");
    expect(reads).toBe(1); await dispatched.promise;
    await owner.planning.refreshWorkspace("planning"); write.resolve({ updates: [], completeness: "complete" });
    expect(await pending).toMatchObject({ phase: "rejected" });
    expect(owner.planning.taskDetail(source.id).task).toMatchObject({ order: 10000, note: source.note, updatedAt: originalVersion });
    expect(owner.planning.taskDetail(unrelated.id).task).toMatchObject({ note: "Newer independent note", updatedAt: newerVersion });
    expect(moves).toBe(1); expect(reads).toBe(1);
  } finally { owner.internal.dispose(); }
});
