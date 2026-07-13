import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const trashPolicy = await loadTranspiledModule(
  "src/features/planning/model/planning-trash-contract.ts",
  {
    "@/lib/platform": {
      isOperationalLeadRole: (role) => role === "ceo" || role === "deputy",
    },
  },
);

test("planning trash policy requires a bounded reason and positive revisions", () => {
  assert.equal(trashPolicy.PLANNING_TRASH_REASON_MAX_LENGTH, 2000);
  assert.deepEqual(trashPolicy.validatePlanningTrashReason("  Nicht mehr relevant.  "), {
    ok: true,
    reason: "Nicht mehr relevant.",
  });
  assert.deepEqual(trashPolicy.validatePlanningTrashReason("   "), { ok: false, reason: "required" });
  assert.deepEqual(trashPolicy.validatePlanningTrashReason("x".repeat(2001)), { ok: false, reason: "too_long" });
  assert.equal(trashPolicy.validatePlanningTrashRevision(1), true);
  assert.equal(trashPolicy.validatePlanningTrashRevision(0), false);
  assert.equal(trashPolicy.validatePlanningTrashRevision(1.5), false);
});

test("only proposer or operational lead may withdraw draft and proposed roots", () => {
  const proposed = { rootType: "deliverable", approvalStatus: "proposed", proposedById: "founder-1" };
  assert.equal(trashPolicy.canWithdrawPlanningRoot(proposed, { id: "founder-1", platformRole: "founder" }), true);
  assert.equal(trashPolicy.canWithdrawPlanningRoot(proposed, { id: "founder-2", platformRole: "founder" }), false);
  assert.equal(trashPolicy.canWithdrawPlanningRoot(proposed, { id: "deputy", platformRole: "deputy" }), true);
  assert.equal(trashPolicy.canWithdrawPlanningRoot({ ...proposed, approvalStatus: "approved" }, { id: "ceo", platformRole: "ceo" }), false);
  assert.equal(trashPolicy.canRestorePlanningRoot({ id: "deputy", platformRole: "deputy" }), true);
  assert.equal(trashPolicy.canRestorePlanningRoot({ id: "founder-1", platformRole: "founder" }), false);
});

test("paper-bin routes share centralized RPC and fail-closed permission contracts", async () => {
  const trashApi = await readFile("src/lib/planning-trash-api.ts", "utf8");
  const serviceRoleClient = await readFile("src/lib/supabase-service-role.ts", "utf8");
  const routePaths = [
    "src/app/api/tasks/[id]/withdraw/route.ts",
    "src/app/api/tasks/[id]/restore/route.ts",
    "src/app/api/initiatives/[id]/withdraw/route.ts",
    "src/app/api/initiatives/[id]/restore/route.ts",
  ];
  const routes = await Promise.all(routePaths.map((path) => readFile(path, "utf8")));

  assert.match(trashApi, /requirePlanningContributor/);
  assert.match(trashApi, /requireOperationalLead/);
  assert.match(trashApi, /root\.proposed_by !== profile\.id/);
  assert.match(trashApi, /root\.task_type !== "deliverable"/);
  assert.match(trashApi, /Sub-Issues können nicht unabhängig zurückgezogen werden/);
  assert.match(trashApi, /isWithdrawableApprovalStatus/);
  assert.match(trashApi, /withdraw_planning_item_transaction/);
  assert.match(trashApi, /restore_planning_item_transaction/);
  assert.match(trashApi, /getServerServiceRoleSupabase/);
  assert.match(trashApi, /serviceSupabase\.rpc\("withdraw_planning_item_transaction"/);
  assert.match(trashApi, /serviceSupabase\.rpc\("restore_planning_item_transaction"/);
  assert.doesNotMatch(trashApi, /context\.supabase\.rpc\("(?:withdraw|restore)_planning_item_transaction"/);
  assert.match(serviceRoleClient, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(serviceRoleClient, /SUPABASE_SECRET_KEY/);
  assert.doesNotMatch(serviceRoleClient, /ANON|PUBLISHABLE/);
  assert.match(trashApi, /p_root_type: rootType/);
  assert.match(trashApi, /p_expected_revision/);
  assert.match(trashApi, /p_expected_trash_revision/);
  assert.match(trashApi, /p_request_ip/);
  assert.match(trashApi, /attemptPlanningGitHubLifecycleDrain/);
  for (const field of ["rootType", "rootId", "affectedTaskIds", "trashRevision", "item", "eventIds"]) {
    assert.match(trashApi, new RegExp(`${field}:`));
  }
  assert.equal(routes.every((route) => /export async function POST/.test(route)), true);
  assert.equal(routes.filter((route) => /"deliverable"/.test(route)).length, 2);
  assert.equal(routes.filter((route) => /"initiative"/.test(route)).length, 2);
});

test("paper-bin UI replaces hard-delete controls with an accessible reason dialog", async () => {
  const dialog = await readFile("src/features/planning/molecules/planning-trash-action-dialog.tsx", "utf8");
  const sidebar = await readFile("src/features/tasks/organisms/task-detail-panel-sidebar.tsx", "utf8");
  const projects = await readFile("src/features/projects/organisms/projects-overview.tsx", "utf8");
  const taskClient = await readFile("src/features/tasks/model/task-api-client.ts", "utf8");

  assert.match(dialog, /useModalDialog/);
  assert.match(dialog, /role="dialog"/);
  assert.match(dialog, /PLANNING_TRASH_REASON_MAX_LENGTH/);
  assert.match(dialog, /In den Papierkorb verschieben/);
  assert.match(dialog, /Aus dem Papierkorb wiederherstellen/);
  assert.match(sidebar, /PlanningTrashActionDialog/);
  assert.match(sidebar, /Deliverable zurückziehen/);
  assert.match(projects, /onWithdrawInitiative/);
  assert.match(projects, /Zurückziehen/);
  assert.match(taskClient, /method: "POST"/);
  assert.doesNotMatch(taskClient, /deleteTaskRequest/);
  assert.doesNotMatch(`${sidebar}\n${projects}`, /window\.confirm/);
});
