import { createPlanningState } from "@/features/planning/model/internal/planning-state-owner";
import { planningWorkspaceHydration } from "@/features/planning/model/planning-workspace-hydration";
import { hierarchyOmittedFields, hierarchyReadCoverage } from "@/features/planning/model/internal/hierarchy-read-coverage";
import { expect, test, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabasePlanningBoardReadModel } from "@/features/planning/server/planning-board-read-model-supabase";
import { buildPlanningTaskTableViewModel } from "@/features/planning/model/planning-task-table-view-model";
import { planningWorkspaceModelToPlanningShellState } from "@/features/planning-items/model/planning-shell-projection";
import { DEFAULT_PLANNING_FILTERS } from "@/features/planning/model/planning-board-query";

vi.mock("server-only", () => ({}));

function fixture() {
  const rows: Array<Record<string, unknown>> = [
    { id: "epic", title: "Parent Epic", task_type: "epic", status: "Offen" },
    { id: "initiative", title: "Parent Initiative", task_type: "initiative", parent_task_id: "epic", status: "Offen", approval_status: "approved" },
    ...Array.from({ length: 45 }, (_, index) => ({ id: `item-${index.toString().padStart(2, "0")}`, title: `Item ${index}`, task_type: "deliverable", parent_task_id: "initiative", status: "Erledigt", priority: "P2", approval_status: "approved", sort_order: index, description: index === 44 ? "Unloaded description needle" : "Long brief ".repeat(100), acceptance_criteria: "Existing acceptance criteria", definition_of_done: index === 44 ? "Unloaded DoD needle" : "Existing DoD", updated_at: "2026-11-01T00:00:00Z" })),
  ];
  const data: Record<string, unknown> = { projects: { id: "findmydoc-founder-execution", name: "Planning" }, profiles: [], active_tasks: rows, planning_item_strategy: [], planning_item_raci_assignments: [], task_links: [], task_blockers: [], sprints: [], task_relationship_edges: [], profile_ui_preferences: [] };
  const denied = new Set<string>();
  const client = { from(table: string) {
    let start = 0, end = Infinity;
    const query = { select() { return query; }, eq() { return query; }, order() { return query; }, limit(value: number) { end = value - 1; return query; }, single() { return query; }, range(from: number, to: number) { start = from; end = to; return query; }, then(resolve: (result: unknown) => unknown) {
      const value = data[table];
      return Promise.resolve({ data: Array.isArray(value) ? value.slice(start, Math.min(end + 1, start + 7)) : value, count: Array.isArray(value) ? value.length : null, error: denied.has(table) ? new Error("Unavailable source") : null }).then(resolve);
    } }; return query;
  } } as unknown as SupabaseClient;
  return { rows, data, denied, reader: createSupabasePlanningBoardReadModel(client) };
}
const context = { authorized: true, actorProfileId: "reader", authorityKey: "compact-session" };

test("bounded Board cards and parent context omit briefs while complete coverage retains searchable content", async () => {
  const { reader } = fixture();
  const board = await reader.load({ ...context, query: { view: "board" } });
  const complete = await reader.load({ ...context, query: { view: "complete" } });
  if (board.status !== "ready" || complete.status !== "ready") throw new Error("Expected authorized coverage");
  expect(board.model.board?.columns.Erledigt).toMatchObject({ total: 45, loaded: 20 });
  expect(board.model.items.find(item => item.id === "initiative")?.title).toBe("Parent Initiative");
  expect(board.model.items.every(item => !("description" in item) && !("acceptanceCriteria" in item) && !("definitionOfDone" in item))).toBe(true);
  expect(board.model.taskOmittedFields).toEqual(expect.arrayContaining(["description", "acceptanceCriteria", "definitionOfDone"]));
  expect(board.model.board?.attentionById?.["item-00"]).toEqual([]);
  expect(complete.model.items.find(item => item.id === "item-44")).toMatchObject({ description: "Unloaded description needle", definitionOfDone: "Unloaded DoD needle", acceptanceCriteria: "Existing acceptance criteria" });
});


test.each(["epic", "initiative", "deliverable"] as const)("%s complete supported search and mixed filters match the authorized complete projection", async level => {
  const { reader, rows, data } = fixture();
  for (const row of rows.filter(item => String(item.id).startsWith("item-"))) { row.task_type = level; row.parent_task_id = level === "epic" ? null : level === "initiative" ? "epic" : "initiative"; }
  data.planning_item_strategy = [{ task_id: "initiative", goal: "Parent strategy needle" }];
  for (const filters of [
    { query: "Unloaded description needle" }, { query: "Unloaded DoD needle" }, { query: "Parent strategy needle" },
    { quick: ["open", "high"], status: "Erledigt" }, { quick: ["open", "evidence"], priority: "P0" },
  ]) {
    const complete = await reader.load({ ...context, query: { view: "complete" } });
    const board = await reader.load({ ...context, query: { level, filters } });
    if (complete.status !== "ready" || board.status !== "ready") throw new Error("Expected authorized search");
    const expected = buildPlanningTaskTableViewModel({ currentProfile: null, data: planningWorkspaceModelToPlanningShellState(complete.model), filters: { ...DEFAULT_PLANNING_FILTERS, ...filters }, includeAssignedSubIssueParents: true }).visibleTasks.filter(task => task.taskType === level).map(task => task.id);
    expect(board.model.board?.metrics.total).toBe(expected.length);
    const matched = [...board.model.board!.cardIds];
    for (const [status, column] of Object.entries(board.model.board!.columns)) {
      let continuation = column.continuation;
      while (continuation) {
        const next = await reader.load({ ...context, query: { level, filters, column: status as import("@/lib/types").TaskStatus, continuation } });
        if (next.status !== "ready") throw new Error("Expected all matching pages");
        matched.push(...next.model.board!.cardIds);
        continuation = next.model.board!.columns[status as import("@/lib/types").TaskStatus].continuation;
      }
    }
    expect(matched).toEqual(expected);
  }
});

test("compact cards preserve complete quality, waiting and Blocker signals outside loaded membership", async () => {
  const { reader, rows, data } = fixture();
  rows.push({ id: "waiting", title: "Waiting card", task_type: "deliverable", approval_status: "approved", status: "Blockiert", acceptance_criteria: "Known AC", definition_of_done: "Known DoD" });
  data.task_relationship_edges = [{ id: 1, task_id: "waiting", related_task_id: "item-44", relation_type: "blocked_by" }];
  data.task_blockers = [{ id: 1, task_id: "waiting", profile_id: "reader", reason: "Known blocker", status: "open" }];
  rows.find(row => row.id === "item-44")!.status = "Offen";
  const result = await reader.load({ ...context, query: { filters: { status: "Blockiert", quick: ["critical", "evidence"] } } });
  if (result.status !== "ready") throw new Error("Expected authoritative signals");
  expect(result.model.board?.cardIds).toEqual(["waiting"]);
  expect(result.model.board?.attentionById?.waiting).toEqual([{ id: "waiting", label: "Wartet", kind: "critical" }]);
  expect(result.model.items.find(item => item.id === "item-44")?.status).toBe("Offen");
  expect(result.model.items.some(item => item.description || item.acceptanceCriteria || item.definitionOfDone)).toBe(false);
  expect(result.model.board?.metrics.blocked).toBe(1);
});

test.each(["task_blockers", "task_relationship_edges", "active_tasks"])("an unavailable %s aggregate cannot return an exact healthy Board", async table => {
  const { reader, denied } = fixture(); denied.add(table);
  await expect(reader.load({ ...context, query: { view: "board" } })).resolves.toEqual({ status: "unavailable" });
});

test("personal Deliverable inclusion still uses open legacy Sub-Issues while extra filters evaluate the parent", async () => {
  const { reader, rows, data } = fixture();
  data.profiles = [{ id: "reader", name: "Reader", platform_role: "founder" }];
  rows.push({ id: "assigned-child", title: "Legacy child", task_type: "sub_issue", parent_task_id: "item-44", assignee: "reader", status: "Offen", problem_statement: "Legacy child content", priority: "P0" });
  const query = { view: "board", filters: { quick: ["mine"], status: "Erledigt", priority: "P2" } } as const;
  const result = await reader.load({ ...context, query: { ...query, filters: { ...query.filters, quick: [...query.filters.quick] } } });
  if (result.status !== "ready") throw new Error("Expected personal parent");
  expect(result.model.board?.cardIds).toEqual(["item-44"]);
  expect(result.model.board?.viewerOpenSubIssueIdsByDeliverableId).toEqual({ "item-44": ["assigned-child"] });
  expect(result.model.items.some(item => item.id === "assigned-child")).toBe(false);
  rows.find(row => row.id === "assigned-child")!.status = "Erledigt";
  const finished = await reader.load({ ...context, query: { filters: { quick: ["mine"] } } });
  if (finished.status !== "ready") throw new Error("Expected complete personal scope");
  expect(finished.model.board?.cardIds).toEqual([]);
});


test("an established no-query reader remains complete while explicit Board intent stays bounded", async () => {
  const { reader } = fixture();
  const complete = await reader.load(context);
  const board = await reader.load({ ...context, query: {} });
  if (complete.status !== "ready" || board.status !== "ready") throw new Error("Expected compatible authorized reads");
  expect(complete.model.items.filter(item => item.taskType === "deliverable")).toHaveLength(45);
  expect(complete.model.board).toBeUndefined();
  expect(complete.model.query?.view).toBe("complete");
  expect(board.model.board?.cardIds).toHaveLength(20);
  const matching = buildPlanningTaskTableViewModel({ currentProfile: null, data: planningWorkspaceModelToPlanningShellState(complete.model), filters: { ...DEFAULT_PLANNING_FILTERS, query: "Unloaded description needle" } });
  expect(matching.visibleTasks.map(task => task.id)).toEqual(["item-44"]);
});


test("a later compact Board read retains opened full content and complete alternative coverage", async () => {
  const { reader } = fixture();
  const first = await reader.load({ ...context, query: {} });
  const complete = await reader.load({ ...context, query: { view: "complete" } });
  if (first.status !== "ready" || complete.status !== "ready") throw new Error("Expected initial scopes");
  const full = { ...complete.model.items.find(item => item.id === "item-00")!, detailAvailability: undefined, problemStatement: "Full problem", intendedOutcome: "Full outcome" };
  const session = { userId: "reader", user: { id: "reader" }, revision: "compact-session", expiresAt: Math.floor(Date.now() / 1000) + 3600 };
  const owner = createPlanningState({ userId: session.userId, initialData: planningWorkspaceModelToPlanningShellState(first.model), initialSession: session, initialWorkspaceRead: planningWorkspaceHydration("planning", first.model, session), adapter: {
    saveTask: async task => ({ task }),
    readTaskDetail: async () => ({ model: { revision: full.updatedAt || "full", project: complete.model.project, item: full, ancestors: [], children: [], relatedItems: [], people: [], sprints: [], discussion: { comments: [], externalComments: [] }, blockers: [], relationships: [], activity: [], reviews: [] } }),
    readWorkspace: async (_, query) => {
      const result = await reader.load({ ...context, query });
      if (result.status !== "ready") throw new Error("Expected compact response");
      return { data: planningWorkspaceModelToPlanningShellState(result.model), query: result.model.query, board: result.model.board, queryRevision: result.model.queryRevision, coverage: hierarchyReadCoverage(result.model), taskOmittedFields: hierarchyOmittedFields(result.model) };
    },
  } });
  await expect(owner.planning.loadTaskDetail(full.id)).resolves.toMatchObject({ ok: true });
  await expect(owner.planning.ensureBoardQuery({ filters: { query: "Item 0" } })).resolves.toBe(true);
  expect(owner.planning.taskDetail(full.id).task).toMatchObject({ description: "Long brief ".repeat(100), acceptanceCriteria: "Existing acceptance criteria", definitionOfDone: "Existing DoD", problemStatement: "Full problem", intendedOutcome: "Full outcome" });
  await expect(owner.planning.ensureBoardQuery({ view: "complete" })).resolves.toBe(true);
  expect(owner.planning.workspace("planning").tasks.filter(task => task.taskType === "deliverable")).toHaveLength(45);
  expect(owner.planning.taskDetail(full.id).task?.problemStatement).toBe("Full problem");
});


test("quick filters combine with OR while additional filters narrow that union", async () => {
  const { reader, rows } = fixture();
  rows.find(row => row.id === "item-43")!.status = "Offen";
  rows.find(row => row.id === "item-44")!.priority = "P0";
  rows.push({ id: "excluded-child", task_type: "sub_issue", title: "Standalone child", status: "Offen", priority: "P0", parent_task_id: "item-44" });
  const union = await reader.load({ ...context, query: { filters: { quick: ["open", "high"] } } });
  if (union.status !== "ready") throw new Error("Expected quick-filter union");
  expect(union.model.board?.cardIds).toEqual(["item-43", "item-44"]);
  const narrowed = await reader.load({ ...context, query: { filters: { quick: ["open", "high"], status: "Erledigt", priority: "P0" } } });
  if (narrowed.status !== "ready") throw new Error("Expected narrowed union");
  expect(narrowed.model.board?.cardIds).toEqual(["item-44"]);
  expect(narrowed.model.board?.childProgressById["item-44"]).toMatchObject({ total: 1, unfinished: 1 });
});


test("initial compact coverage cannot submit a missing brief as an authoritative edit", async () => {
  const { reader } = fixture();
  const initial = await reader.load({ ...context, query: {} });
  if (initial.status !== "ready") throw new Error("Expected compact hydration");
  const session = { userId: "reader", user: { id: "reader" }, revision: "compact-session", expiresAt: Math.floor(Date.now() / 1000) + 3600 };
  let writes = 0;
  const owner = createPlanningState({ userId: session.userId, initialData: planningWorkspaceModelToPlanningShellState(initial.model), initialSession: session, initialWorkspaceRead: planningWorkspaceHydration("planning", initial.model, session), adapter: { saveTask: async task => { writes++; return { task }; }, readWorkspace: async () => null } });
  const result = await owner.planning.saveTask(owner.planning.board().tasks[0], { description: "Overwrite omitted content" });
  expect(result).toMatchObject({ ok: false, kind: "versionConflict" });
  expect(writes).toBe(0);
});
