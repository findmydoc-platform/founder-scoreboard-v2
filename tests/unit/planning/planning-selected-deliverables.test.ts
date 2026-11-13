import { expect, test, vi } from "vitest";
import type { SupabaseClient } from "@supabase/supabase-js";
import { createSupabasePlanningBoardReadModel } from "@/features/planning/server/planning-board-read-model-supabase";

vi.mock("server-only", () => ({}));

function source() {
  const calls: Array<{ name: string; args: Record<string, unknown> | undefined }> = [];
  let revision = "42";
  let preference: Record<string, unknown> | null = null;
  let validUntil: string | null = null, failure = false;
  const signals: AbortSignal[] = [];
  const client = { from(table: string) {
    if (table !== "profile_ui_preferences") throw new Error("A selected Deliverable read must not enumerate tables.");
    const read = { select() { return read; }, eq() { return read; }, abortSignal() { return read; }, maybeSingle() { return Promise.resolve({ data: preference, error: null }); } };
    return read;
  }, rpc(name: string, args?: Record<string, unknown>) {
    calls.push({ name, args });
    const data = name === "planning_source_version" ? revision : name === "workspace_access_contexts" ? [] : {
      status: "ready", source_revision: revision, evaluated_at: "2026-11-13T12:00:00Z", temporal_key: "stable", valid_until: validUntil,
      project: { id: "findmydoc-founder-execution", name: "Synthetic Planning" }, rows: [{ id: "selected", title: "Selected", task_type: "deliverable", approval_status: "approved", status: args?.p_column || "Offen" }],
      card_ids: ["selected"], context_ids: ["selected"], profiles: [], sprints: [], preferences: [], relationships: [], blockers: [], strategies: [], raci: [], links: [],
      columns: Object.fromEntries(["Offen", "In Arbeit", "Review", "Nacharbeit", "Blockiert", "Erledigt", "Pausiert"].map(status => [status, { total: status === (args?.p_column || "Offen") ? 25 : 0 }])),
      metrics: { total: 25, open: 25, done: 0, blocked: 0 }, level_totals: { epic: 0, initiative: 0, deliverable: 25 }, child_progress: {}, personal_children: {}, workspace_revision: { activeTaskCount: 25, latestUpdatedAt: "2026-11-01T00:00:00Z" },
    };
    return { abortSignal(signal: AbortSignal) { signals.push(signal); return this; }, then(resolve: (value: unknown) => unknown) { return Promise.resolve({ data, error: failure ? { message: "Synthetic source unavailable" } : null }).then(resolve); } };
  } } as unknown as SupabaseClient;
  return { client, calls, signals, changeRevision() { revision = "43"; }, expires(value: string) { validUntil = value; }, fail() { failure = true; }, preferMine() { preference = { profile_id: "reader", default_workspace: "mine", default_task_view: "board", planning_filters: { query: "saved", assignee: "other", quick: ["high"] } }; } };
}
const context = { authorized: true, actorProfileId: "reader", authorityKey: "session" };

test("an initial Deliverable column is selected in the database and marks independent columns as not loaded", async () => {
  const fixture = source();
  const result = await createSupabasePlanningBoardReadModel(fixture.client).load({ ...context, query: { view: "board", filters: {} } });
  expect(result.status).toBe("ready");
  if (result.status !== "ready") throw new Error("Expected selected cards");
  expect(fixture.calls[0]).toMatchObject({ name: "planning_deliverable_selection", args: { p_column: "Offen", p_offset: 0, p_limit: 20 } });
  expect(result.model.board?.columns.Offen).toMatchObject({ availability: "ready", loaded: 1, completeness: "partial" });
  expect(result.model.board?.columns.Erledigt).toMatchObject({ availability: "not-loaded", loaded: 0 });
  expect(result.model.items.map(item => item.id)).toEqual(["selected"]);
  expect(result.model.coverage?.items).toBe("partial");
});

test("the initial selected query preserves stored personal defaults on one fenced source basis", async () => {
  const fixture = source(); fixture.preferMine();
  const result = await createSupabasePlanningBoardReadModel(fixture.client).load({ ...context, query: { view: "board" } });
  expect(result.status).toBe("ready");
  expect(fixture.calls.find(call => call.name === "planning_deliverable_selection")?.args?.p_query).toMatchObject({ filters: { query: "saved", assignee: "Alle", quick: ["high", "mine"] } });
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

test("a forged or temporally expired continuation is rejected without a source dispatch", async () => {
  vi.useFakeTimers({ toFake: ["Date"] }); vi.setSystemTime(new Date("2026-11-13T12:00:00Z"));
  try {
    const fixture = source(); fixture.expires("2026-11-13T12:00:10Z");
    const reader = createSupabasePlanningBoardReadModel(fixture.client);
    const input = { view: "board" as const, column: "Offen" as const, filters: {} };
    const first = await reader.load({ ...context, query: input });
    if (first.status !== "ready") throw new Error("Expected a valid temporal page");
    const continuation = first.model.board!.columns.Offen.continuation!;
    const count = fixture.calls.length, forged = JSON.parse(Buffer.from(continuation, "base64url").toString("utf8"));
    forged.evaluatedAt = "2026-11-13T12:00:09Z";
    expect(await reader.load({ ...context, query: { ...input, continuation: Buffer.from(JSON.stringify(forged)).toString("base64url") } })).toEqual({ status: "staleContinuation" });
    vi.setSystemTime(new Date("2026-11-13T12:00:10Z"));
    expect(await reader.load({ ...context, query: { ...input, continuation } })).toEqual({ status: "staleContinuation" });
    expect(fixture.calls).toHaveLength(count);
  } finally { vi.useRealTimers(); }
});

test("source failure, denied admission and invalid temporal evidence never expose cards", async () => {
  const fixture = source(), reader = createSupabasePlanningBoardReadModel(fixture.client);
  const query = { view: "board" as const, filters: {} };
  expect(await reader.load({ ...context, authorized: false, query })).toEqual({ status: "forbidden" });
  expect(fixture.calls).toEqual([]);
  fixture.expires("invalid-time");
  expect(await reader.load({ ...context, query })).toEqual({ status: "unavailable" });
  fixture.fail();
  expect(await reader.load({ ...context, query })).toEqual({ status: "unavailable" });
});

test("selected and source-fence reads propagate the caller cancellation signal and preserve unknown summaries", async () => {
  const fixture = source(), signal = new AbortController().signal;
  const result = await createSupabasePlanningBoardReadModel(fixture.client).load({ ...context, signal, query: { view: "board", filters: {} } });
  if (result.status !== "ready") throw new Error("Expected selected cards");
  expect(fixture.signals).toEqual([signal, signal]);
  expect(result.model.board?.childProgressById.selected).toBeNull();
  expect(result.model.board?.attentionById?.selected).toBeNull();
  expect(result.model.board?.metrics.blocked).toBeNull();
  expect(result.model.board?.columns.Review.total).toBeNull();
  expect(result.model.taskOmittedFields).toContain("description");
  expect(result.model.taskOmittedFields).toContain("dependsOn");
  expect(result.model.taskOmittedFields).toContain("evidenceLink");
  expect(result.model.items[0]).not.toHaveProperty("dependsOn");
  expect(result.model.items[0]).not.toHaveProperty("evidenceLink");
});

test.each([{ view: "complete" as const }, { view: "board" as const, level: "epic" as const }])("the established complete and unmigrated strategic request stays on its compatible source: %j", async query => {
  const calls: string[] = [];
  const client = { rpc(name: string) { calls.push(name); return Promise.resolve({ data: { id: "findmydoc-founder-execution", name: "Synthetic", scope_revision: "42" }, error: null }); }, from(table: string) {
    calls.push(table);
    const read = { select() { return read; }, eq() { return read; }, is() { return read; }, order() { return read; }, limit() { return read; }, range() { return read; }, then(resolve: (value: unknown) => unknown) { return Promise.resolve({ data: [], count: 0, error: null }).then(resolve); } };
    return read;
  } } as unknown as SupabaseClient;
  const result = await createSupabasePlanningBoardReadModel(client).load({ ...context, query });
  expect(result.status).toBe("ready");
  expect(calls).toContain("active_tasks");
  expect(calls).not.toContain("planning_deliverable_selection");
});
