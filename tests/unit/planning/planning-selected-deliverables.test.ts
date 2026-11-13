import { expect, test, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabasePlanningBoardReadModel } from "@/features/planning/server/planning-board-read-model-supabase";

vi.mock("server-only", () => ({}));

function source() {
  const calls: Array<{ name: string; args: Record<string, unknown> | undefined }> = [];
  let revision = "42";
  const client = { from() { throw new Error("A selected Deliverable read must not enumerate tables."); }, rpc(name: string, args?: Record<string, unknown>) {
    calls.push({ name, args });
    const data = name === "planning_source_version" ? revision : name === "workspace_access_contexts" ? [] : {
      status: "ready", source_revision: revision, evaluated_at: "2026-11-13T12:00:00Z", temporal_key: "stable", valid_until: null,
      project: { id: "findmydoc-founder-execution", name: "Synthetic Planning" }, rows: [{ id: "selected", title: "Selected", task_type: "deliverable", approval_status: "approved", status: args?.p_column || "Offen" }],
      card_ids: ["selected"], context_ids: ["selected"], profiles: [], sprints: [], preferences: [], relationships: [], blockers: [], strategies: [], raci: [], links: [],
      columns: Object.fromEntries(["Offen", "In Arbeit", "Review", "Nacharbeit", "Blockiert", "Erledigt", "Pausiert"].map(status => [status, { total: status === (args?.p_column || "Offen") ? 25 : 0 }])),
      metrics: { total: 25, open: 25, done: 0, blocked: 0 }, level_totals: { epic: 0, initiative: 0, deliverable: 25 }, child_progress: {}, personal_children: {}, workspace_revision: { activeTaskCount: 25, latestUpdatedAt: "2026-11-01T00:00:00Z" },
    };
    return { abortSignal() { return this; }, then(resolve: (value: unknown) => unknown) { return Promise.resolve({ data, error: null }).then(resolve); } };
  } } as unknown as SupabaseClient;
  return { client, calls, changeRevision() { revision = "43"; } };
}
const context = { authorized: true, actorProfileId: "reader", authorityKey: "session" };

test("an initial Deliverable column is selected in the database and marks independent columns as not loaded", async () => {
  const fixture = source();
  const result = await createSupabasePlanningBoardReadModel(fixture.client).load({ ...context, query: { view: "board" } });
  expect(result.status).toBe("ready");
  if (result.status !== "ready") throw new Error("Expected selected cards");
  expect(fixture.calls[0]).toMatchObject({ name: "planning_deliverable_selection", args: { p_column: "Offen", p_offset: 0, p_limit: 20 } });
  expect(result.model.board?.columns.Offen).toMatchObject({ availability: "ready", loaded: 1, completeness: "partial" });
  expect(result.model.board?.columns.Erledigt).toMatchObject({ availability: "not-loaded", loaded: 0 });
  expect(result.model.items.map(item => item.id)).toEqual(["selected"]);
  expect(result.model.coverage?.items).toBe("partial");
});

test("continuations bind source, normalized query, column and original authority before dispatch", async () => {
  const fixture = source(), reader = createSupabasePlanningBoardReadModel(fixture.client);
  const initial = await reader.load({ ...context, query: { column: "Erledigt" } });
  if (initial.status !== "ready") throw new Error("Expected selected history");
  const continuation = initial.model.board!.columns.Erledigt.continuation!;
  const count = fixture.calls.length;
  for (const next of [{ ...context, authorityKey: "replacement", query: { column: "Erledigt" as const, continuation } }, { ...context, query: { column: "Erledigt" as const, continuation, filters: { query: "changed" } } }, { ...context, query: { column: "Offen" as const, continuation } }]) {
    expect(await reader.load(next)).toEqual({ status: "staleContinuation" });
  }
  expect(fixture.calls).toHaveLength(count);
  fixture.changeRevision();
  expect(await reader.load({ ...context, query: { column: "Erledigt", continuation } })).toEqual({ status: "staleContinuation" });
});
