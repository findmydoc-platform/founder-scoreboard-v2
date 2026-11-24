import { expect, test, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { hasOpenWaitingRelation } from "@/lib/platform";
import { createPlanningState } from "@/features/planning/model/internal/planning-state-owner";
import { planningWorkspaceHydration } from "@/features/planning/model/planning-workspace-hydration";
import { planningWorkspaceModelToPlanningShellState } from "@/features/planning-items/model/planning-shell-projection";
import { createCompletePlanningReference } from "../../helpers/complete-planning-reference";

// Complete TypeScript/provider reference and owner acceptance. Actual selected
// SQL traversal is verified in integration/planning-deliverable-selection.test.ts.

vi.mock("server-only", () => ({}));

function fixture(history = 45, cap = 7) {
  const rows = Array.from({ length: history }, (_, index) => ({ id: `done-${String(index).padStart(4, "0")}`, title: `History ${index}`, description: index === history - 1 ? "Unloaded search needle" : "", task_type: "deliverable", approval_status: "approved", status: "Erledigt", updated_at: "2026-11-01T00:00:00Z", sort_order: index, parent_task_id: "initiative" }));
  const data: Record<string, unknown> = {
    projects: { id: "findmydoc-founder-execution", name: "Planning" }, profiles: [],
    active_tasks: [{ id: "initiative", task_type: "initiative", title: "Parent", approval_status: "approved" }, { id: "active", title: "Current work", task_type: "deliverable", approval_status: "approved", status: "Offen", parent_task_id: "initiative" }, ...rows],
    planning_item_strategy: [], planning_item_raci_assignments: [], task_links: [], task_blockers: [], sprints: [], task_relationship_edges: [], profile_ui_preferences: [],
  };
  return { data, client: { rpc() { return Promise.resolve({ data: { ...(data.projects as object), scope_revision: "42" }, error: null }); }, from(table: string) {
    let from = 0, to = Infinity;
    const query = { select() { return query; }, eq() { return query; }, is() { return query; }, order() { return query; }, limit(value: number) { to = value - 1; return query; }, single() { return query; }, range(start: number, end: number) { from = start; to = end; return query; }, then(resolve: (value: unknown) => unknown) { const value = data[table]; return Promise.resolve({ data: Array.isArray(value) ? value.slice(from, Math.min(to + 1, from + cap)) : value, count: Array.isArray(value) ? value.length : null, error: null }).then(resolve); } };
    return query;
  } } as unknown as SupabaseClient };
}
const context = { authorized: true, actorProfileId: "reader", authorityKey: "reader-session" };

test("completed history starts with 20 cards and completely enumerates beyond an upstream cap", async () => {
  const { client, data } = fixture();
  (data.active_tasks as Array<Record<string, unknown>>).forEach(row => { row.sort_order = 0; });
  const reader = createCompletePlanningReference(client);
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
  const reader = createCompletePlanningReference(fixture().client);
  const initial = await reader.load({ ...context, query: { view: "board" } });
  if (initial.status !== "ready") throw new Error("Expected initial Board");
  const session = { userId: "reader", user: { id: "reader" }, revision: "session", expiresAt: Math.floor(Date.now() / 1000) + 3600 };
  let fail = true;
  const owner = createPlanningState({ userId: session.userId, initialData: planningWorkspaceModelToPlanningShellState(initial.model), initialSession: session, initialWorkspaceRead: planningWorkspaceHydration("planning", initial.model, session, { userId: session.userId, deadline: session.expiresAt * 1000 }), adapter: {
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
  const small = await createCompletePlanningReference(fixture(45).client).load({ ...context, query: { view: "board" } });
  const large = await createCompletePlanningReference(fixture(2045, 173).client).load({ ...context, query: { view: "board" } });
  if (small.status !== "ready" || large.status !== "ready") throw new Error("Expected complete scope counts");
  expect(large.model.board?.columns.Erledigt.total).toBe(2045);
  expect(large.model.items).toHaveLength(small.model.items.length);
  expect(Math.abs(JSON.stringify(large.model).length - JSON.stringify(small.model).length)).toBeLessThan(100);
  const searched = await createCompletePlanningReference(fixture(2045, 173).client).load({ ...context, query: { view: "board", filters: { query: "  UNLOADED search NEEDLE  ", status: "Erledigt" } } });
  if (searched.status !== "ready") throw new Error("Expected completed search result");
  expect(searched.model.board?.cardIds).toEqual(["done-2044"]);
  expect(searched.model.board?.columns.Erledigt).toMatchObject({ total: 1, loaded: 1, completeness: "complete", continuation: null });
});

test("continuation rejects a different query, authority and intervening data change", async () => {
  const source = fixture();
  const reader = createCompletePlanningReference(source.client);
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
  const reader = createCompletePlanningReference(source.client);
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
  const reader = createCompletePlanningReference(source.client);
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
  const result = await createCompletePlanningReference(source.client).load({ ...context, query: { filters: { assignee: "reader" } } });
  if (result.status !== "ready") throw new Error("Expected contextual Board");
  expect(result.model.board?.cardIds).toEqual(["active"]);
  expect(result.model.board?.childProgressById.active).toEqual({ total: 2, completed: 1, unfinished: 1, percentage: 50 });
  expect(result.model.items.some(item => item.id === "child-open" || item.id === "child-done")).toBe(false);
  expect(result.model.blockers).toMatchObject([{ taskId: "active", status: "open" }]);
  expect(hasOpenWaitingRelation("active", [...result.model.items], [...result.model.relationships])).toBe(true);
});

test("history beyond the default upstream cap enumerates with stable ties and bounded clamped pages", async () => {
  const reader = createCompletePlanningReference(fixture(1027, 173).client);
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
  const incomplete = await createCompletePlanningReference(fixture(1027, 0).client).load(context);
  expect(incomplete).toEqual({ status: "unavailable" });
});

test("a late response from a previous filter cannot replace the current bounded scope", async () => {
  const reader = createCompletePlanningReference(fixture().client);
  const firstPage = await reader.load({ ...context, query: {} });
  if (firstPage.status !== "ready") throw new Error("Expected initial page");
  const session = { userId: "reader", user: { id: "reader" }, revision: "session", expiresAt: Math.floor(Date.now() / 1000) + 3600 };
  const pending: Array<() => Promise<void>> = [];
  const owner = createPlanningState({ userId: session.userId, initialData: planningWorkspaceModelToPlanningShellState(firstPage.model), initialSession: session, initialWorkspaceRead: planningWorkspaceHydration("planning", firstPage.model, session, { userId: session.userId, deadline: session.expiresAt * 1000 }), adapter: {
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

test("complete views retain required history, parents, Sprints and relationships beyond an upstream cap", async () => {
  const source = fixture(1027, 173);
  const rows = source.data.active_tasks as Array<Record<string, unknown>>;
  rows.find(row => row.id === "done-1026")!.sprint_id = "historical-sprint";
  source.data.sprints = [{ id: "historical-sprint", name: "Historical Sprint", start_date: "2026-01-01", end_date: "2026-01-14" }];
  source.data.task_relationship_edges = [{ id: 1, task_id: "done-1026", related_task_id: "active", relation_type: "blocked_by" }];
  const reader = createCompletePlanningReference(source.client);
  const board = await reader.load({ ...context, query: { view: "board" } });
  const complete = await reader.load({ ...context, query: { view: "complete" } });
  if (board.status !== "ready" || complete.status !== "ready") throw new Error("Expected complete alternative coverage");
  expect(board.model.board?.cardIds).not.toContain("done-1026");
  expect(complete.model.items.filter(task => task.taskType === "deliverable")).toHaveLength(1028);
  expect(complete.model.items.find(task => task.id === "done-1026")).toMatchObject({ parentTaskId: "initiative", sprintId: "historical-sprint" });
  expect(complete.model.items.find(task => task.id === "initiative")?.title).toBe("Parent");
  expect(complete.model.sprints[0]).toMatchObject({ id: "historical-sprint", startDate: "2026-01-01", endDate: "2026-01-14" });
  expect(hasOpenWaitingRelation("done-1026", [...complete.model.items], [...complete.model.relationships])).toBe(true);
  expect(complete.model.board).toBeUndefined();
  expect(complete.model.queryRevision).toBe(board.model.board?.revision);
});

test("persisted view defaults do not invalidate unchanged Board coverage but planning data does", async () => {
  const source = fixture();
  source.data.profile_ui_preferences = [{ profile_id: "reader", default_workspace: "planning", default_task_view: "board", planning_filters: {}, expanded_item_ids: [], updated_at: "r1" }];
  const reader = createCompletePlanningReference(source.client);
  const board = await reader.load({ ...context, query: { view: "board" } });
  Object.assign((source.data.profile_ui_preferences as Array<Record<string, unknown>>)[0], { default_task_view: "table", expanded_item_ids: ["initiative"], updated_at: "r2" });
  const complete = await reader.load({ ...context, query: { view: "complete" } });
  if (board.status !== "ready" || complete.status !== "ready") throw new Error("Expected unchanged source coverage");
  expect(complete.model.queryRevision).toBe(board.model.board?.revision);
  (source.data.active_tasks as Array<Record<string, unknown>>).find(row => row.id === "done-0044")!.description = "Changed searchable planning content";
  const changed = await reader.load({ ...context, query: { view: "complete" } });
  if (changed.status !== "ready") throw new Error("Expected changed source coverage");
  expect(changed.model.queryRevision).not.toBe(complete.model.queryRevision);
});

test("active status columns have independent bounded pages and deterministic priority/manual order", async () => {
  const source = fixture(0, 173);
  const rows = source.data.active_tasks as Array<Record<string, unknown>>;
  rows.splice(1);
  for (const status of ["Offen", "In Arbeit", "Review"]) for (let index = 1026; index >= 0; index--) rows.push({ id: `${status}-${String(index).padStart(4, "0")}`, task_type: "deliverable", approval_status: "approved", title: `Active ${status} ${index}`, status, priority: index === 1026 ? "P0" : "P2", sort_order: 0, parent_task_id: "initiative" });
  const reader = createCompletePlanningReference(source.client);
  const first = await reader.load({ ...context, query: { limit: 1000 } });
  if (first.status !== "ready") throw new Error("Expected bounded active Board");
  expect(first.model.board?.cardIds).toHaveLength(60);
  expect(first.model.board?.columns.Offen).toMatchObject({ total: 1027, loaded: 20, completeness: "partial" });
  expect(first.model.board?.columns.Review).toMatchObject({ total: 1027, loaded: 20, completeness: "partial" });
  expect(first.model.board!.cardIds.slice(0, 3)).toEqual(["Offen-1026", "Offen-0000", "Offen-0001"]);
  const ids = first.model.board!.cardIds.filter(id => id.startsWith("Offen-"));
  let continuation = first.model.board!.columns.Offen.continuation;
  const foreignStatus = await reader.load({ ...context, query: { column: "Review", continuation: continuation! } });
  expect(foreignStatus.status).toBe("staleContinuation");
  while (continuation) {
    const result = await reader.load({ ...context, query: { column: "Offen", continuation } });
    if (result.status !== "ready") throw new Error("Expected active continuation");
    expect(result.model.board?.column).toBe("Offen");
    expect(result.model.board!.cardIds.length).toBeLessThanOrEqual(20);
    expect(result.model.board!.cardIds.every(id => id.startsWith("Offen-"))).toBe(true);
    ids.push(...result.model.board!.cardIds);
    continuation = result.model.board!.columns.Offen.continuation;
  }
  expect(ids).toHaveLength(1027);
  expect(new Set(ids).size).toBe(1027);
  expect(ids.slice(-2)).toEqual(["Offen-1024", "Offen-1025"]);
});


test("the owner accepts concurrent independent columns, coalesces identical pages and retries only a failed column", async () => {
  const source = fixture(25);
  const rows = source.data.active_tasks as Array<Record<string, unknown>>;
  rows.push(...Array.from({ length: 44 }, (_, index) => ({ id: `open-${index}`, title: `Open ${index}`, task_type: "deliverable", approval_status: "approved", status: "Offen", parent_task_id: "initiative" })));
  const reader = createCompletePlanningReference(source.client);
  const initial = await reader.load({ ...context, query: {} });
  if (initial.status !== "ready") throw new Error("Expected bounded Board");
  const session = { userId: "reader", user: { id: "reader" }, revision: "session", expiresAt: Math.floor(Date.now() / 1000) + 3600 };
  const pending: Array<{ query: import("@/features/planning/model/planning-board-query").PlanningBoardQueryInput; finish(fail?: boolean): Promise<void> }> = [];
  const owner = createPlanningState({ userId: session.userId, initialData: planningWorkspaceModelToPlanningShellState(initial.model), initialSession: session, initialWorkspaceRead: planningWorkspaceHydration("planning", initial.model, session, { userId: session.userId, deadline: session.expiresAt * 1000 }), adapter: {
    saveTask: async task => ({ task }),
    readWorkspace: (_, query) => new Promise((resolve, reject) => pending.push({ query: query!, finish: async fail => {
      if (fail) { reject(new Error("Column unavailable")); return; }
      const result = await reader.load({ ...context, query });
      if (result.status !== "ready") throw new Error("Expected column");
      resolve({ data: planningWorkspaceModelToPlanningShellState(result.model), board: result.model.board, query: result.model.query, coverage: { tasks: "partial" } });
    } })),
  } });
  const open = owner.planning.loadBoardColumn("Offen");
  const same = owner.planning.loadBoardColumn("Offen");
  const done = owner.planning.loadBoardColumn("Erledigt");
  expect(pending).toHaveLength(2);
  await pending[1].finish();
  await expect(done).resolves.toBe(true);
  await pending[0].finish(true);
  await expect(Promise.all([open, same])).resolves.toEqual([false, false]);
  expect(owner.planning.board().columnReadStatus).toMatchObject({ Offen: "unavailable", Erledigt: "current" });
  expect(owner.planning.board().result?.columns.Erledigt).toMatchObject({ total: 25, loaded: 25, completeness: "complete" });
  const retry = owner.planning.loadBoardColumn("Offen");
  expect(pending[2].query.continuation).toBe(pending[0].query.continuation);
  await pending[2].finish();
  await expect(retry).resolves.toBe(true);
  expect(owner.planning.board().result?.columns.Offen).toMatchObject({ total: 45, loaded: 40, completeness: "partial" });
  expect(owner.planning.board().result?.columns.Erledigt).toMatchObject({ total: 25, loaded: 25, completeness: "complete" });
  expect(owner.planning.board().tasks).toHaveLength(65);
});


test("concurrent successful status pages keep both columns current when their context overlaps", async () => {
  const source = fixture(25);
  const rows = source.data.active_tasks as Array<Record<string, unknown>>;
  rows.push(...Array.from({ length: 24 }, (_, index) => ({ id: `open-${index}`, title: `Open ${index}`, task_type: "deliverable", approval_status: "approved", status: "Offen", parent_task_id: "initiative" })));
  const reader = createCompletePlanningReference(source.client);
  const initial = await reader.load({ ...context, query: {} });
  if (initial.status !== "ready") throw new Error("Expected Board");
  const session = { userId: "reader", user: { id: "reader" }, revision: "session", expiresAt: Math.floor(Date.now() / 1000) + 3600 };
  const pending: Array<() => Promise<void>> = [];
  const owner = createPlanningState({ userId: session.userId, initialData: planningWorkspaceModelToPlanningShellState(initial.model), initialSession: session, initialWorkspaceRead: planningWorkspaceHydration("planning", initial.model, session, { userId: session.userId, deadline: session.expiresAt * 1000 }), adapter: {
    saveTask: async task => ({ task }), readWorkspace: (_, query) => new Promise(resolve => pending.push(async () => {
      const result = await reader.load({ ...context, query });
      if (result.status !== "ready") throw new Error("Expected page");
      resolve({ data: planningWorkspaceModelToPlanningShellState(result.model), board: result.model.board, query: result.model.query, coverage: { tasks: "partial" } });
    })),
  } });
  const open = owner.planning.loadBoardColumn("Offen"), done = owner.planning.loadBoardColumn("Erledigt");
  await pending[1](); await done;
  await pending[0](); await open;
  expect(owner.planning.board().columnReadStatus).toMatchObject({ Offen: "current", Erledigt: "current" });
  expect(owner.planning.board().readStatus).toBe("current");
  expect(owner.planning.board().tasks).toHaveLength(50);
});


test.each(["query", "session"])("a late column page cannot re-enter an ended %s context", async boundary => {
  const reader = createCompletePlanningReference(fixture(25).client);
  const initial = await reader.load({ ...context, query: {} });
  if (initial.status !== "ready") throw new Error("Expected Board");
  const session = { userId: "reader", user: { id: "reader" }, revision: "session", expiresAt: Math.floor(Date.now() / 1000) + 3600 };
  let sessionChanged!: (userId: string | null) => void;
  const pending: Array<() => Promise<void>> = [];
  const owner = createPlanningState({ userId: session.userId, initialData: planningWorkspaceModelToPlanningShellState(initial.model), initialSession: session, initialWorkspaceRead: planningWorkspaceHydration("planning", initial.model, session, { userId: session.userId, deadline: session.expiresAt * 1000 }), adapter: {
    subscribeSession: listener => { sessionChanged = listener; return () => {}; },
    saveTask: async task => ({ task }), readWorkspace: (_, query) => new Promise(resolve => pending.push(async () => {
      const result = await reader.load({ ...context, query });
      if (result.status !== "ready") throw new Error("Expected scoped page");
      resolve({ data: planningWorkspaceModelToPlanningShellState(result.model), board: result.model.board, query: result.model.query, coverage: { tasks: "partial" } });
    })),
  } });
  const old = owner.planning.loadBoardColumn("Erledigt");
  if (boundary === "query") {
    const selected = owner.planning.ensureBoardQuery({ parentId: "another-parent" });
    await pending[1](); await selected;
  } else sessionChanged(null);
  await pending[0]();
  await expect(old).resolves.toBe(false);
  expect(owner.planning.board().tasks).toEqual([]);
  if (boundary === "session") {
    expect(owner.planning.board().result).toBeUndefined();
    expect(owner.planning.board().columnReadStatus).toEqual({});
  }
});

test("a stale continuation refreshes only its status membership and marks other snapshots stale", async () => {
  const source = fixture(25);
  const reader = createCompletePlanningReference(source.client);
  const initial = await reader.load({ ...context, query: {} });
  if (initial.status !== "ready") throw new Error("Expected Board");
  const session = { userId: "reader", user: { id: "reader" }, revision: "session", expiresAt: Math.floor(Date.now() / 1000) + 3600 };
  const owner = createPlanningState({ userId: session.userId, initialData: planningWorkspaceModelToPlanningShellState(initial.model), initialSession: session, initialWorkspaceRead: planningWorkspaceHydration("planning", initial.model, session, { userId: session.userId, deadline: session.expiresAt * 1000 }), adapter: {
    saveTask: async task => ({ task }), readWorkspace: async (_, query) => {
      const result = await reader.load({ ...context, query });
      if (result.status === "staleContinuation") throw Object.assign(new Error("Changed result"), { code: "stale_continuation" });
      if (result.status !== "ready") throw new Error("Expected refreshed status");
      return { data: planningWorkspaceModelToPlanningShellState(result.model), board: result.model.board, query: result.model.query, coverage: { tasks: "partial" } };
    },
  } });
  const rows = source.data.active_tasks as Array<Record<string, unknown>>;
  rows.splice(2);
  await expect(owner.planning.loadBoardColumn("Erledigt")).resolves.toBe(false);
  expect(owner.planning.board().columnReadStatus?.Erledigt).toBe("stale");
  expect(owner.planning.board().tasks).toHaveLength(21);
  await expect(owner.planning.refreshBoardColumn("Erledigt")).resolves.toBe(true);
  expect(owner.planning.board().result?.columns.Erledigt).toMatchObject({ total: 0, loaded: 0, completeness: "complete" });
  expect(owner.planning.board().tasks.map(task => task.id)).toEqual(["active"]);
  expect(owner.planning.board().columnReadStatus?.Offen).toBe("stale");
  expect(owner.planning.taskDetail("done-0000").task?.id).toBe("done-0000");
});


test("a column page preserves confirmed edits and pending work in shared dependency context", async () => {
  const source = fixture(25);
  (source.data.active_tasks as Array<Record<string, unknown>>).push({ id: "pending-work", title: "Before pending", task_type: "deliverable", approval_status: "approved", status: "Offen", parent_task_id: "initiative" });
  source.data.task_relationship_edges = [{ id: 1, task_id: "done-0020", related_task_id: "active", relation_type: "blocked_by" }, { id: 2, task_id: "done-0020", related_task_id: "pending-work", relation_type: "blocked_by" }];
  const reader = createCompletePlanningReference(source.client);
  const initial = await reader.load({ ...context, query: {} });
  if (initial.status !== "ready") throw new Error("Expected Board");
  const session = { userId: "reader", user: { id: "reader" }, revision: "session", expiresAt: Math.floor(Date.now() / 1000) + 3600 };
  let finishPage!: () => Promise<void>;
  let finishSave!: (result: { task: Partial<import("@/lib/types").Task> }) => void;
  const owner = createPlanningState({ userId: session.userId, initialData: planningWorkspaceModelToPlanningShellState(initial.model), initialSession: session, initialWorkspaceRead: planningWorkspaceHydration("planning", initial.model, session, { userId: session.userId, deadline: session.expiresAt * 1000 }), adapter: {
    saveTask: task => task.id === "pending-work" ? new Promise(resolve => { finishSave = resolve; }) : Promise.resolve({ task: { id: task.id, title: "Confirmed edit", updatedAt: "confirmed-r2" } }),
    readWorkspace: (_, query) => new Promise(resolve => { finishPage = async () => {
      const result = await reader.load({ ...context, query });
      if (result.status !== "ready") throw new Error("Expected page");
      resolve({ data: planningWorkspaceModelToPlanningShellState(result.model), board: result.model.board, query: result.model.query, coverage: { tasks: "partial" } });
    }; }),
  } });
  const page = owner.planning.loadBoardColumn("Erledigt");
  await owner.planning.saveTask(owner.planning.taskDetail("active").task!, { title: "Confirmed edit" });
  const saving = owner.planning.saveTask(owner.planning.taskDetail("pending-work").task!, { title: "Pending edit" });
  await finishPage(); await page;
  expect(owner.planning.taskDetail("active").task?.title).toBe("Confirmed edit");
  expect(owner.planning.taskDetail("pending-work")).toMatchObject({ task: { title: "Pending edit" }, saveStatus: "saving" });
  expect(owner.planning.protectedCache()?.tasks.find(task => task.id === "active")?.title).toBe("Confirmed edit");
  finishSave({ task: { id: "pending-work", title: "Pending edit", updatedAt: "confirmed-r3" } });
  await saving;
});
