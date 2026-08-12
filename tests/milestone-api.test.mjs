import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const contract = await loadTranspiledModule("src/features/projects/model/milestone-contract.ts");
const policy = await loadTranspiledModule("src/features/projects/model/milestone-policy.ts");
const server = await loadTranspiledModule(
  "src/features/projects/model/milestone-server.ts",
  {
    "server-only": {},
    "@/lib/planning-profile-mappers": {
      mapMilestone: (row) => ({
        id: row.id,
        title: row.title,
        description: row.description || "",
        targetDate: row.target_date || "",
        status: row.status,
        sortOrder: row.sort_order,
        updatedAt: row.updated_at || "",
      }),
      mapLegacyMilestoneFromEpic: (row) => ({
        id: row.id,
        title: row.title,
        description: row.description || "",
        targetDate: row.target_date || "",
        status: row.status === "In Arbeit" ? "active" : row.status === "Erledigt" ? "done" : "planned",
        sortOrder: row.sort_order || 0,
        updatedAt: row.updated_at || "",
      }),
    },
    "@/lib/planning-task-mappers": { mapTaskRow: (row) => row },
    "@/features/projects/model/planning-legacy-adapters": {
      resolveCanonicalStrategicItemId: async (_supabase, id) => id,
    },
    "@/features/planning-items/model/planning-items-create": {
      browserCreateTransactionFromResult: () => null,
      createBrowserCreatePlanningItems: () => ({ run: async () => ({ ok: false }) }),
      planningItemCreateCommand: () => ({ kind: "createItems", items: [] }),
    },
    "@/features/planning-items/model/planning-item-update": {
      browserReviseTransactionFromResult: (result) => result.transaction,
      createBrowserRevisePlanningItems: ({ supabase, writer }) => ({
        run: async () => {
          const response = await supabase.rpc("update_browser_planning_item_transaction", {
            p_task_id: writer.params.taskId,
            p_expected_updated_at: writer.params.expectedUpdatedAt,
            p_patch: writer.params.patch,
            p_strategy: writer.params.strategy,
            p_raci_assignments: writer.params.raciAssignments,
            p_actor_profile_id: "ceo",
            p_request_ip: null,
            p_user_agent: null,
            p_legacy_audit_action: writer.params.legacyAuditAction,
          });
          return response.error ? { ok: false, error: response.error } : { ok: true, transaction: response.data };
        },
      }),
      planningItemReviseCommand: () => ({ kind: "reviseItem" }),
    },
    "@/lib/slug": {
      slugify: (value) => String(value).trim().toLowerCase().replaceAll(/[^a-z0-9]+/g, "-").replaceAll(/^-|-$/g, ""),
    },
    "./milestone-contract": contract,
    "./milestone-policy": policy,
  },
);

test("Milestone create parsing is strict and normalizes allowed fields", () => {
  assert.deepEqual(server.parseMilestoneCreateRequest({
    title: "  Market readiness  ",
    description: "  Prepare the operating model.  ",
    targetDate: "2026-10-31",
    status: "active",
  }), {
    ok: true,
    value: {
      title: "Market readiness",
      description: "Prepare the operating model.",
      targetDate: "2026-10-31",
      status: "active",
    },
  });

  assert.equal(server.parseMilestoneCreateRequest(null).ok, false);
  assert.equal(server.parseMilestoneCreateRequest({ title: "ab" }).ok, false);
  assert.equal(server.parseMilestoneCreateRequest({ title: "Valid title", targetDate: "2026-02-31" }).ok, false);
  assert.equal(server.parseMilestoneCreateRequest({ title: "Valid title", status: "paused" }).ok, false);
  assert.equal(server.parseMilestoneCreateRequest({ title: "Valid title", sortOrder: 2 }).ok, false);
  assert.equal(server.parseMilestoneCreateRequest({ title: "Valid title", description: "x".repeat(4001) }).ok, false);
});

test("Milestone PATCH requires a real mutable field and compare-and-set version", () => {
  assert.deepEqual(server.parseMilestonePatchRequest({
    expectedUpdatedAt: "2026-07-14T12:00:00.000Z",
    targetDate: null,
    description: "",
  }), {
    ok: true,
    value: {
      expectedUpdatedAt: "2026-07-14T12:00:00.000Z",
      update: { targetDate: null, description: "" },
    },
  });

  assert.equal(server.parseMilestonePatchRequest({ expectedUpdatedAt: "2026-07-14T12:00:00.000Z" }).ok, false);
  assert.equal(server.parseMilestonePatchRequest({ title: "Missing version" }).ok, false);
  assert.equal(server.parseMilestonePatchRequest({ expectedUpdatedAt: "yesterday", title: "Valid title" }).ok, false);
  assert.equal(server.parseMilestonePatchRequest({ expectedUpdatedAt: "2026-02-31T12:00:00.000Z", title: "Valid title" }).ok, false);
  assert.equal(server.parseMilestonePatchRequest({ expectedUpdatedAt: "2026-07-14T24:00:00.000Z", title: "Valid title" }).ok, false);
  assert.equal(server.parseMilestonePatchRequest({
    expectedUpdatedAt: "2026-07-14T12:00:00.000Z",
    sortOrder: 4,
  }).ok, false);
  assert.equal(server.parseMilestonePatchRequest({
    expectedUpdatedAt: "2026-07-14T12:00:00.000Z",
    moveTo: "another",
  }).ok, false);
});

test("Milestone DELETE accepts only the expected version", () => {
  assert.deepEqual(server.parseMilestoneDeleteRequest({
    expectedUpdatedAt: "2026-07-14T12:00:00+00:00",
  }), {
    ok: true,
    value: { expectedUpdatedAt: "2026-07-14T12:00:00+00:00" },
  });
  assert.equal(server.parseMilestoneDeleteRequest({}).ok, false);
  assert.equal(server.parseMilestoneDeleteRequest({
    expectedUpdatedAt: "2026-07-14T12:00:00.000Z",
    cascade: true,
  }).ok, false);
});

test("Milestone inserts own project and ID while leaving sort allocation to the database", () => {
  const insert = server.buildMilestoneInsert({
    title: "Market readiness",
    description: "",
    targetDate: null,
    status: "planned",
  }, "milestone-market-readiness-fixed");

  assert.deepEqual(insert, {
    id: "milestone-market-readiness-fixed",
    project_id: "findmydoc-founder-execution",
    title: "Market readiness",
    description: null,
    target_date: null,
    status: "planned",
  });
  assert.equal(Object.hasOwn(insert, "sort_order"), false);
  assert.match(server.createMilestoneId("Market readiness"), /^epic-market-readiness-[0-9a-f-]{36}$/);
});

test("Legacy Milestone update helper delegates writes to the canonical Revise RPC", async () => {
  const calls = [];
  const supabase = {
    rpc(name, input) {
      calls.push(["rpc", name, input]);
      return Promise.resolve({ data: { task: { id: input.p_task_id } }, error: null });
    },
  };

  await server.updateProjectMilestone(
    supabase,
    "milestone-one",
    "2026-07-14T12:00:00.000Z",
    { title: "Updated title" },
    { profileId: "ceo", platformRole: "ceo", credential: { kind: "session" } },
  );
  assert.deepEqual(calls, [
    ["rpc", "update_browser_planning_item_transaction", {
      p_task_id: "milestone-one",
      p_expected_updated_at: "2026-07-14T12:00:00.000Z",
      p_patch: { title: "Updated title" },
      p_strategy: null,
      p_raci_assignments: null,
      p_actor_profile_id: "ceo",
      p_request_ip: null,
      p_user_agent: null,
      p_legacy_audit_action: "milestone.update",
    }],
  ]);
});

test("Session routes use the narrow role guards and never return raw database errors", async () => {
  const [collectionRoute, itemRoute, serverSource] = await Promise.all([
    readFile("src/features/planning-items/model/planning-items-browser-milestone-route.ts", "utf8"),
    readFile("src/features/planning-items/model/planning-items-browser-milestone-update.ts", "utf8"),
    readFile("src/features/projects/model/milestone-server.ts", "utf8"),
  ]);

  assert.match(collectionRoute, /requireApiContext\(request, requireTeamMember\)/);
  assert.match(collectionRoute, /requireJsonApiContext<unknown>\(request, requireOperationalLead, null\)/);
  assert.equal((itemRoute.match(/requireJsonApiContext<unknown>\(request, requireOperationalLead, null\)/g) || []).length, 2);
  assert.doesNotMatch(collectionRoute, /error\.message/);
  assert.doesNotMatch(itemRoute, /error\.message/);
  assert.match(itemRoute, /createEmptyEpicDeletePlanningItems/);
  assert.match(itemRoute, /emptyEpicDeleteCommand/);
  assert.doesNotMatch(itemRoute, /freshTarget|freshChildren|loadMilestoneChildCounts|buildMilestoneDeletePolicy/);
  assert.match(serverSource, /import "server-only"/);
  assert.match(serverSource, /\.eq\("project_id", MILESTONE_PROJECT_ID\)/);
  assert.match(serverSource, /createBrowserRevisePlanningItems/);
  assert.doesNotMatch(serverSource, /delete_empty_epic_transaction|loadMilestoneChildCounts/);
});
