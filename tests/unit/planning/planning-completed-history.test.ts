import { expect, test, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hasOpenWaitingRelation } from "@/lib/platform";
import { createPlanningState } from "@/features/planning/model/internal/planning-state-owner";
import { planningWorkspaceHydration } from "@/features/planning/model/planning-workspace-hydration";
import { planningWorkspaceModelToPlanningShellState } from "@/features/planning-items/model/planning-shell-projection";
import { createSupabasePlanningBoardReadModel } from "@/features/planning/server/planning-board-read-model-supabase";

vi.mock("server-only", () => ({}));

function fixture(history = 45, cap = 7) {
  const rows = Array.from({ length: history }, (_, index) => ({ id: `done-${String(index).padStart(4, "0")}`, title: `History ${index}`, description: index === history - 1 ? "Unloaded search needle" : "", task_type: "deliverable", approval_status: "approved", status: "Erledigt", updated_at: "2026-11-01T00:00:00Z", sort_order: index, parent_task_id: "initiative" }));
  const data: Record<string, unknown> = {
    projects: { id: "findmydoc-founder-execution", name: "Planning" }, profiles: [],
    active_tasks: [{ id: "initiative", task_type: "initiative", title: "Parent", approval_status: "approved" }, { id: "active", title: "Current work", task_type: "deliverable", approval_status: "approved", status: "Offen", parent_task_id: "initiative" }, ...rows],
    planning_item_strategy: [], planning_item_raci_assignments: [], task_links: [], task_blockers: [], sprints: [], task_relationship_edges: [], profile_ui_preferences: [],
  };
  return { data, client: { from(table: string) {
    let from = 0, to = Infinity;
    const query = { select() { return query; }, eq() { return query; }, order() { return query; }, limit(value: number) { to = value - 1; return query; }, single() { return query; }, range(start: number, end: number) { from = start; to = end; return query; }, then(resolve: (value: unknown) => unknown) { const value = data[table]; return Promise.resolve({ data: Array.isArray(value) ? value.slice(from, Math.min(to + 1, from + cap)) : value, count: Array.isArray(value) ? value.length : null, error: null }).then(resolve); } };
    return query;
  } } as unknown as SupabaseClient };
}
const context = { authorized: true, actorProfileId: "reader", authorityKey: "reader-session" };

test("completed history starts with 20 cards and completely enumerates beyond an upstream cap", async () => {
  const { client, data } = fixture();
  (data.active_tasks as Array<Record<string, unknown>>).forEach(row => { row.sort_order = 0; });
  const reader = createSupabasePlanningBoardReadModel(client);
  const first = await reader.load({ ...context, query: { view: "board", level: "deliverable" } });
  expect(first.status).toBe("ready");
  if (first.status !== "ready") throw new Error("Expected ready Board");
  expect(first.model.board?.columns.Erledigt).toMatchObject({ total: 45, loaded: 20, completeness: "partial" });
  expect(first.model.items.filter(item => item.taskType === "deliverable" && item.status === "Erledigt")).toHaveLength(20);
  expect(first.model.items.some(item => item.id === "done-0044")).toBe(false);
  const ids = [...first.model.board!.cardIds];
  let continuation = first.model.board!.columns.Erledigt.continuation;
  while (continuation) {
    const next = await reader.load({ ...context, query: { view: "board", level: "deliverable", continuation } });
    if (next.status !== "ready") throw new Error("Expected ready continuation");
    ids.push(...next.model.board!.cardIds);
    continuation = next.model.board!.columns.Erledigt.continuation;
  }
  expect(new Set(ids).size).toBe(46);
  expect(ids).toHaveLength(46);
});

test("the shared owner appends a completed page, retains active cards and retries only failed history", async () => {
  const reader = createSupabasePlanningBoardReadModel(fixture().client);
  const initial = await reader.load({ ...context, query: { view: "board" } });
  if (initial.status !== "ready") throw new Error("Expected initial Board");
  const session = { userId: "reader", user: { id: "reader" }, revision: "session", expiresAt: Math.floor(Date.now() / 1000) + 3600 };
  let fail = true;
  const owner = createPlanningState({ userId: session.userId, initialData: planningWorkspaceModelToPlanningShellState(initial.model), initialSession: session, initialWorkspaceRead: planningWorkspaceHydration("planning", initial.model, session), adapter: {
    saveTask: async task => ({ task }),
    readWorkspace: async (_, query) => {
      if (fail) throw new Error("Page unavailable");
      const result = await reader.load({ ...context, query });
      if (result.status !== "ready") throw new Error("Expected history");
      return { data: planningWorkspaceModelToPlanningShellState(result.model), board: result.model.board, query: result.model.query, taskCoverage: "partial", coverage: { tasks: "partial" } };
    },
  } });
  await expect(owner.planning.loadCompletedHistory()).resolves.toBe(false);
  expect(owner.planning.board().pageStatus).toBe("unavailable");
  expect(owner.planning.board().tasks).toHaveLength(21);
  fail = false;
  await expect(owner.planning.loadCompletedHistory()).resolves.toBe(true);
  expect(owner.planning.board().result?.columns.Erledigt).toMatchObject({ total: 45, loaded: 40, completeness: "partial" });
  expect(owner.planning.board().tasks).toHaveLength(41);
  expect(owner.planning.board().tasks.some(task => task.id === "active")).toBe(true);
});

test("full-scope search reaches an old completed match and unrelated history does not enlarge the initial response", async () => {
  const small = await createSupabasePlanningBoardReadModel(fixture(45).client).load({ ...context, query: { view: "board" } });
  const large = await createSupabasePlanningBoardReadModel(fixture(2045, 173).client).load({ ...context, query: { view: "board" } });
  if (small.status !== "ready" || large.status !== "ready") throw new Error("Expected complete scope counts");
  expect(large.model.board?.columns.Erledigt.total).toBe(2045);
  expect(large.model.items).toHaveLength(small.model.items.length);
  expect(Math.abs(JSON.stringify(large.model).length - JSON.stringify(small.model).length)).toBeLessThan(100);
  const searched = await createSupabasePlanningBoardReadModel(fixture(2045, 173).client).load({ ...context, query: { view: "board", filters: { query: "  UNLOADED search NEEDLE  ", status: "Erledigt" } } });
  if (searched.status !== "ready") throw new Error("Expected completed search result");
  expect(searched.model.board?.cardIds).toEqual(["done-2044"]);
  expect(searched.model.board?.columns.Erledigt).toMatchObject({ total: 1, loaded: 1, completeness: "complete", continuation: null });
});

test("continuation rejects a different query, authority and intervening data change", async () => {
  const source = fixture();
  const reader = createSupabasePlanningBoardReadModel(source.client);
  const first = await reader.load({ ...context, query: {} });
  if (first.status !== "ready") throw new Error("Expected first page");
  const continuation = first.model.board!.columns.Erledigt.continuation!;
  const tampered = JSON.parse(Buffer.from(continuation, "base64url").toString("utf8"));
  tampered.offset = 44;
  await expect(reader.load({ ...context, query: { continuation: Buffer.from(JSON.stringify(tampered)).toString("base64url") } })).resolves.toEqual({ status: "staleContinuation" });
  await expect(reader.load({ ...context, query: { continuation, filters: { query: "other" } } })).resolves.toEqual({ status: "staleContinuation" });
  await expect(reader.load({ ...context, authorityKey: "another-session", query: { continuation } })).resolves.toEqual({ status: "staleContinuation" });
  (source.data.active_tasks as Array<Record<string, unknown>>)[2].title = "A changed historical card";
  await expect(reader.load({ ...context, query: { continuation } })).resolves.toEqual({ status: "staleContinuation" });
});

test("personal history includes a foreign completed parent through open assigned children and filters the parent", async () => {
  const source = fixture();
  source.data.profiles = [{ id: "reader", name: "Reader", platform_role: "founder" }, { id: "other", name: "Other", platform_role: "founder" }];
  const rows = source.data.active_tasks as Array<Record<string, unknown>>;
  rows.forEach(row => { row.assignee = "other"; row.priority = "P1"; });
  rows.push({ id: "assigned-child", title: "Assigned child", task_type: "sub_issue", parent_task_id: "done-0044", status: "Offen", assignee: "reader", priority: "P0" });
  rows.push(...Array.from({ length: 1007 }, (_, index) => ({ id: `closed-child-${index}`, title: "Closed child", task_type: "sub_issue", parent_task_id: "done-0044", status: "Erledigt", assignee: "other" })));
  const reader = createSupabasePlanningBoardReadModel(source.client);
  const result = await reader.load({ ...context, query: { filters: { quick: ["mine"], priority: "P1" } } });
  if (result.status !== "ready") throw new Error("Expected personal parent");
  expect(result.model.board?.cardIds).toEqual(["done-0044"]);
  expect(result.model.board?.viewerOpenSubIssueIdsByDeliverableId).toEqual({ "done-0044": ["assigned-child"] });
  expect(result.model.items.filter(row => row.parentTaskId === "done-0044")).toHaveLength(0);
  expect(result.model.board?.childProgressById["done-0044"]).toEqual({ completed: 1007, total: 1008, unfinished: 1, percentage: 100 });
  const parentFilter = await reader.load({ ...context, query: { filters: { quick: ["mine"], priority: "P0" } } });
  if (parentFilter.status !== "ready") throw new Error("Expected empty parent-filter result");
  expect(parentFilter.model.board?.cardIds).toEqual([]);
  rows.find(row => row.id === "assigned-child")!.status = "Erledigt";
  const closed = await reader.load({ ...context, query: { filters: { quick: ["mine"] } } });
  if (closed.status !== "ready") throw new Error("Expected complete personal result");
  expect(closed.model.board?.cardIds).toEqual([]);
});

test("supported searchable fields find complete history and quick filters keep OR with additional AND", async () => {
  const source = fixture();
  source.data.profiles = [{ id: "reader", name: "Reader", platform_role: "founder" }, { id: "reviewer", name: "Unique review owner", platform_role: "founder" }];
  source.data.sprints = [{ id: "sprint", name: "Unique historical Sprint" }];
  const rows = source.data.active_tasks as Array<Record<string, unknown>>;
  const old = rows.find(row => row.id === "done-0044")!;
  Object.assign(old, { assignee: "reader", definition_of_done: "Unique completion checklist", workstream: "Unique workstream", priority: "P0", sprint_id: "sprint", review_owner_profile_id: "reviewer", github_issue_number: 9827, issue_number: "9827", github_repo: "synthetic/unique-repository", fixed_date: "2026-01-02" });
  const reader = createSupabasePlanningBoardReadModel(source.client);
  for (const query of ["Unloaded search needle", "Unique completion checklist", "Unique historical Sprint", "Unique review owner", "#9827", "unique-repository", "2026-01-02", "Unique workstream"]) {
    const result = await reader.load({ ...context, query: { filters: { query } } });
    if (result.status !== "ready") throw new Error("Expected searchable history");
    expect(result.model.board?.cardIds, query).toEqual(["done-0044"]);
  }
  const combined = await reader.load({ ...context, query: { filters: { quick: ["mine", "open"], priority: "P0" } } });
  if (combined.status !== "ready") throw new Error("Expected combined filters");
  expect(combined.model.board?.cardIds).toEqual(["done-0044"]);
});

test("waiting and Blocker context and exact child progress do not depend on filtered card membership", async () => {
  const source = fixture();
  source.data.profiles = [{ id: "reader", name: "Reader", platform_role: "founder" }];
  const rows = source.data.active_tasks as Array<Record<string, unknown>>;
  Object.assign(rows.find(row => row.id === "active")!, { assignee: "reader", priority: "P1" });
  rows.push({ id: "outside", task_type: "deliverable", title: "Unloaded dependency", approval_status: "approved", status: "Offen", priority: "P2" });
  rows.push({ id: "child-open", task_type: "sub_issue", parent_task_id: "active", title: "Open child", status: "Offen" }, { id: "child-done", task_type: "sub_issue", parent_task_id: "active", title: "Done child", status: "Erledigt" });
  source.data.task_relationship_edges = [{ id: 1, task_id: "active", related_task_id: "outside", relation_type: "blocked_by" }];
  source.data.task_blockers = [{ id: 1, task_id: "active", status: "open", reason: "Synthetic Blocker" }];
  const result = await createSupabasePlanningBoardReadModel(source.client).load({ ...context, query: { filters: { assignee: "reader" } } });
  if (result.status !== "ready") throw new Error("Expected contextual Board");
  expect(result.model.board?.cardIds).toEqual(["active"]);
  expect(result.model.board?.childProgressById.active).toEqual({ total: 2, completed: 1, unfinished: 1, percentage: 50 });
  expect(result.model.items.some(item => item.id === "child-open" || item.id === "child-done")).toBe(false);
  expect(result.model.blockers).toMatchObject([{ taskId: "active", status: "open" }]);
  expect(hasOpenWaitingRelation("active", [...result.model.items], [...result.model.relationships])).toBe(true);
});

test("history beyond the default upstream cap enumerates with stable ties and bounded clamped pages", async () => {
  const reader = createSupabasePlanningBoardReadModel(fixture(1027, 173).client);
  const ids: string[] = [];
  let continuation: string | undefined;
  do {
    const result = await reader.load({ ...context, query: { limit: 5000, continuation } });
    if (result.status !== "ready") throw new Error("Expected complete history enumeration");
    expect(result.model.items.filter(task => result.model.board!.cardIds.includes(task.id) && task.status === "Erledigt").length).toBeLessThanOrEqual(20);
    ids.push(...result.model.board!.cardIds);
    continuation = result.model.board!.columns.Erledigt.continuation || undefined;
  } while (continuation);
  expect(ids).toHaveLength(1028);
  expect(new Set(ids).size).toBe(1028);
  expect(ids.slice(-2)).toEqual(["done-1025", "done-1026"]);
  const incomplete = await createSupabasePlanningBoardReadModel(fixture(1027, 0).client).load(context);
  expect(incomplete).toEqual({ status: "unavailable" });
});

test("a late response from a previous filter cannot replace the current bounded scope", async () => {
  const reader = createSupabasePlanningBoardReadModel(fixture().client);
  const firstPage = await reader.load({ ...context, query: {} });
  if (firstPage.status !== "ready") throw new Error("Expected initial page");
  const session = { userId: "reader", user: { id: "reader" }, revision: "session", expiresAt: Math.floor(Date.now() / 1000) + 3600 };
  const pending: Array<() => Promise<void>> = [];
  const owner = createPlanningState({ userId: session.userId, initialData: planningWorkspaceModelToPlanningShellState(firstPage.model), initialSession: session, initialWorkspaceRead: planningWorkspaceHydration("planning", firstPage.model, session), adapter: {
    saveTask: async task => ({ task }),
    readWorkspace: (_, query) => new Promise(resolve => { pending.push(async () => {
      const result = await reader.load({ ...context, query });
      if (result.status !== "ready") throw new Error("Expected filtered result");
      resolve({ data: planningWorkspaceModelToPlanningShellState(result.model), board: result.model.board, query: result.model.query, coverage: { tasks: "partial" } });
    }); }),
  } });
  const older = owner.planning.ensureBoardQuery({ filters: { query: "History 1" } });
  const current = owner.planning.ensureBoardQuery({ filters: { query: "Unloaded search needle" } });
  const same = owner.planning.ensureBoardQuery({ filters: { query: "Unloaded search needle" } });
  expect(pending).toHaveLength(2);
  await pending[1]();
  await expect(Promise.all([current, same])).resolves.toEqual([true, true]);
  expect(owner.planning.board().tasks.map(task => task.id)).toEqual(["done-0044"]);
  await pending[0]();
  await expect(older).resolves.toBe(false);
  expect(owner.planning.board().tasks.map(task => task.id)).toEqual(["done-0044"]);
});
