import { expect, test } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";
const { createSupabaseSprintReadModel } = await importTestModule("src/features/sprint/server/sprint-read-model-supabase.ts", { "server-only": {} });
function fixture({ failedTable = "", missingCount = false } = {}) {
  const calls = [];
  const tables = { projects: { id: "project", name: "Planning", range_label: "", review_objection_window_hours: 48 }, sprints: [{ id: "sprint", name: "Shown", status: "planning", start_date: "2026-10-01", end_date: "2026-10-14", review_due_at: "", score_locked: false, updated_at: "opaque/shown" }], meetings: Array.from({ length: 100 }, (_, id) => ({ id, sprint_id: "sprint", title: "Meeting", meeting_at: "2026-10-14T10:00:00Z", status: "planned", agenda: "" })) };
  return { calls, from(table) {
    calls.push(table);
    let countRequested = false;
    const query = { select(_fields, options) { countRequested = options?.count === "exact"; return query; }, eq() { return query; }, order() { return query; }, limit() { return query; }, single() { return query; }, then(resolve, reject) {
      const data = tables[table] ?? [];
      return Promise.resolve(table === failedTable ? { data: null, error: { message: "Provider unavailable" } } : { data, error: null, count: countRequested && !missingCount && Array.isArray(data) ? data.length : undefined }).then(resolve, reject);
    } }; return query;
  } };
}
test("Sprint reads preserve opaque editing versions and distinguish proven empty scopes from capped or unproven membership", async () => {
  const loaded = await createSupabaseSprintReadModel(fixture()).load({ authorized: true, actorProfileId: "person" });
  expect(loaded.status).toBe("ready");
  expect(loaded.model.sprints[0].updatedAt).toBe("opaque/shown");
  expect(loaded.model.coverage).toMatchObject({ sprints: "complete", commitments: "complete", meetings: "partial", people: "complete", items: "complete" });
  expect(loaded.model.readCoverage).toEqual({people:"complete",items:"complete",strategies:"complete",raci:"complete",links:"complete"});
  expect(loaded.model.commitments).toEqual([]);
  expect(loaded.model.meetings).toHaveLength(100);
  const unproven = await createSupabaseSprintReadModel(fixture({ missingCount: true })).load({ authorized: true, actorProfileId: "person" });
  expect(unproven.model.coverage.sprints).toBe("partial");
});
test("Sprint reads deny before provider access and keep dependency failures unavailable", async () => {
  const denied = fixture();
  expect(await createSupabaseSprintReadModel(denied).load({ authorized: false, actorProfileId: null })).toEqual({ status: "forbidden" });
  expect(denied.calls).toEqual([]);
  expect(await createSupabaseSprintReadModel(fixture({ failedTable: "meetings" })).load({ authorized: true, actorProfileId: "person" })).toEqual({ status: "unavailable" });
});
