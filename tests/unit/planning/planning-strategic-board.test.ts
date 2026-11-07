import { expect, test, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabasePlanningBoardReadModel } from "@/features/planning/server/planning-board-read-model-supabase";
import type { PlanningBoardQueryInput } from "@/features/planning/model/planning-board-query";
import { createPlanningState } from "@/features/planning/model/internal/planning-state-owner";
import { planningWorkspaceHydration } from "@/features/planning/model/planning-workspace-hydration";
import { planningWorkspaceModelToPlanningShellState } from "@/features/planning-items/model/planning-shell-projection";

vi.mock("server-only", () => ({}));

function fixture(level: "epic" | "initiative", count = 47) {
  const rows: Array<Record<string, unknown>> = [
    { id: "parent-epic", task_type: "epic", title: "Parent Epic", status: "Offen" },
    ...["Offen", "Pausiert", "Erledigt"].flatMap(status => Array.from({ length: count }, (_, index) => ({
      id: `${level}-${status}-${String(index).padStart(4, "0")}`, title: `Strategic ${index}`, description: index === count - 1 ? "Unloaded strategic needle" : "",
      task_type: level, approval_status: "approved", status, priority: "P2", updated_at: "2026-11-01T00:00:00Z", sort_order: 0,
      parent_task_id: level === "initiative" ? "parent-epic" : null,
    }))),
  ];
  const data: Record<string, unknown> = {
    projects: { id: "findmydoc-founder-execution", name: "Planning" }, profiles: [], active_tasks: rows,
    planning_item_strategy: [], planning_item_raci_assignments: [], task_links: [], task_blockers: [], sprints: [], task_relationship_edges: [], profile_ui_preferences: [],
  };
  const client = { rpc() { return Promise.resolve({ data: { ...(data.projects as object), scope_revision: "42" }, error: null }); }, from(table: string) {
    let from = 0, to = Infinity;
    const query = { select() { return query; }, eq() { return query; }, is() { return query; }, order() { return query; }, limit(value: number) { to = value - 1; return query; }, single() { return query; }, range(start: number, end: number) { from = start; to = end; return query; }, then(resolve: (value: unknown) => unknown) {
      const value = data[table];
      return Promise.resolve({ data: Array.isArray(value) ? value.slice(from, Math.min(to + 1, from + 7)) : value, count: Array.isArray(value) ? value.length : null, error: null }).then(resolve);
    } };
    return query;
  } } as unknown as SupabaseClient;
  return { rows, data, reader: createSupabasePlanningBoardReadModel(client) };
}
const context = { authorized: true, actorProfileId: "reader", authorityKey: "strategic-session" };

test.each(["epic", "initiative"] as const)("%s Board pages each strategic status independently with complete totals and stable ties", async level => {
  const { reader } = fixture(level);
  const query: PlanningBoardQueryInput = { level, filters: { query: "Strategic" }, limit: 1000 };
  const first = await reader.load({ ...context, query });
  if (first.status !== "ready") throw new Error("Expected strategic Board");
  expect(first.model.board?.cardIds).toHaveLength(60);
  expect(first.model.board?.levelTotals).toEqual({ epic: level === "epic" ? 142 : 1, initiative: level === "initiative" ? 141 : 0, deliverable: 0 });
  for (const status of ["Offen", "Pausiert", "Erledigt"] as const) {
    expect(first.model.board?.columns[status]).toMatchObject({ total: 47, loaded: 20, completeness: "partial" });
    const ids = first.model.board!.cardIds.filter(id => id.includes(status));
    let continuation = first.model.board!.columns[status].continuation;
    while (continuation) {
      const next = await reader.load({ ...context, query: { ...query, column: status, continuation } });
      if (next.status !== "ready") throw new Error("Expected strategic continuation");
      expect(next.model.board?.column).toBe(status);
      ids.push(...next.model.board!.cardIds);
      continuation = next.model.board!.columns[status].continuation;
    }
    expect(ids).toEqual(Array.from({ length: 47 }, (_, index) => `${level}-${status}-${String(index).padStart(4, "0")}`));
  }
});

test.each(["epic", "initiative"] as const)("%s page keeps direct-child aggregates and required old parent context without serializing unrelated cards", async level => {
  const { reader, rows } = fixture(level);
  const parentId = `${level}-Erledigt-0046`;
  const childType = level === "epic" ? "initiative" : "deliverable";
  rows.push(
    { id: "open-child", title: "Open child", task_type: childType, approval_status: "approved", status: "Offen", parent_task_id: parentId },
    { id: "done-child", title: "Done child", task_type: childType, approval_status: "approved", status: "Erledigt", parent_task_id: parentId },
    { id: "grandchild", title: "Open grandchild", task_type: level === "epic" ? "deliverable" : "sub_issue", approval_status: "approved", status: "Offen", parent_task_id: "open-child" },
  );
  const first = await reader.load({ ...context, query: { level, filters: { query: "Strategic" } } });
  if (first.status !== "ready") throw new Error("Expected strategic page");
  expect(first.model.items.filter(task => task.taskType === level)).toHaveLength(60);
  expect(first.model.items.some(task => task.id === parentId)).toBe(false);
  const searched = await reader.load({ ...context, query: { level, filters: { query: "Unloaded strategic needle", status: "Erledigt" } } });
  if (searched.status !== "ready") throw new Error("Expected full-scope strategic search");
  expect(searched.model.board?.cardIds).toEqual([parentId]);
  expect(searched.model.board?.childProgressById[parentId]).toEqual({ completed: 1, total: 2, unfinished: 1, percentage: 50 });
  expect(searched.model.items.some(task => task.id === "open-child" || task.id === "done-child" || task.id === "grandchild")).toBe(false);
  const children = await reader.load({ ...context, query: { level: childType, parentId, filters: { status: "Offen" } } });
  if (children.status !== "ready") throw new Error("Expected child Board");
  expect(children.model.board?.cardIds).toEqual(["open-child"]);
  expect(children.model.items.find(task => task.id === parentId)).toMatchObject({ status: "Erledigt" });
});

test("Initiative parent and complete filters bind continuations and preserve empty and denied scopes", async () => {
  const { reader, rows } = fixture("initiative");
  rows.push({ id: "other-epic", title: "Other Epic", task_type: "epic" }, { id: "outside-parent", task_type: "initiative", title: "Strategic outside", parent_task_id: "other-epic", status: "Offen" });
  const query = { level: "initiative", parentId: "parent-epic", filters: { priority: "P2" } } as const;
  const first = await reader.load({ ...context, query });
  if (first.status !== "ready") throw new Error("Expected selected Epic scope");
  expect(first.model.board?.metrics.total).toBe(141);
  expect(first.model.board?.cardIds).not.toContain("outside-parent");
  const continuation = first.model.board!.columns.Offen.continuation!;
  await expect(reader.load({ ...context, query: { ...query, parentId: "other-epic", column: "Offen", continuation } })).resolves.toEqual({ status: "staleContinuation" });
  await expect(reader.load({ ...context, query: { ...query, level: "epic", column: "Offen", continuation } })).resolves.toEqual({ status: "staleContinuation" });
  const empty = await reader.load({ ...context, query: { ...query, parentId: "missing-epic" } });
  if (empty.status !== "ready") throw new Error("Expected complete empty scope");
  expect(empty.model.board?.columns.Offen).toEqual({ total: 0, loaded: 0, completeness: "complete", continuation: null });
  await expect(reader.load({ ...context, authorized: false, query })).resolves.toEqual({ status: "forbidden" });
});

test.each(["epic", "initiative"] as const)("%s cannot request a Deliverable-only status page", async level => {
  const { reader } = fixture(level);
  await expect(reader.load({ ...context, query: { level, column: "Review" } })).resolves.toEqual({ status: "staleContinuation" });
});

test("a late Epic page cannot populate a newly selected Initiative scope", async () => {
  const { reader } = fixture("epic");
  const first = await reader.load({ ...context, query: { level: "epic" } });
  if (first.status !== "ready") throw new Error("Expected Epic Board");
  const session = { userId: "reader", user: { id: "reader" }, revision: "strategic-session", expiresAt: Math.floor(Date.now() / 1000) + 3600 };
  let release: (() => void) | undefined;
  const owner = createPlanningState({ userId: session.userId, initialData: planningWorkspaceModelToPlanningShellState(first.model), initialSession: session, initialWorkspaceRead: planningWorkspaceHydration("planning", first.model, session), adapter: {
    saveTask: async task => ({ task }),
    readWorkspace: async (_, query) => {
      const result = await reader.load({ ...context, query });
      if (result.status !== "ready") throw new Error("Expected selected strategic query");
      if (query?.continuation) await new Promise<void>(resolve => { release = resolve; });
      return { data: planningWorkspaceModelToPlanningShellState(result.model), query: result.model.query, board: result.model.board, taskCoverage: "partial", coverage: { tasks: "partial" } };
    },
  } });
  const late = owner.planning.loadBoardColumn("Offen");
  await vi.waitFor(() => expect(release).toBeTypeOf("function"));
  await expect(owner.planning.ensureBoardQuery({ level: "initiative" })).resolves.toBe(true);
  release!();
  await expect(late).resolves.toBe(false);
  expect(owner.planning.board().result?.query.level).toBe("initiative");
  expect(owner.planning.board().tasks).toEqual([]);
});
