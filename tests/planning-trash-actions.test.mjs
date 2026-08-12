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

test("paper-bin routes share the PlanningItems command and fail-closed permission contracts", async () => {
  const trashApi = await readFile("src/lib/planning-trash-api.ts", "utf8");
  const trashModule = await readFile("src/features/planning-items/model/planning-items-trash.ts", "utf8");
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
  assert.match(trashApi, /createPlanningTrashPlanningItems/);
  assert.match(trashApi, /actorContextFromSessionAuth/);
  assert.match(trashModule, /task\.proposed_by !== actorProfileId/);
  assert.match(trashModule, /task\.task_type !== rootType/);
  assert.match(trashModule, /subIssueRootUnsupported/);
  assert.match(trashModule, /mutate_planning_trash_command_transaction/);
  assert.match(trashApi, /getServerServiceRoleSupabase/);
  assert.doesNotMatch(trashApi, /\.from\(|\.rpc\(/);
  assert.match(serviceRoleClient, /SUPABASE_SERVICE_ROLE_KEY/);
  assert.match(serviceRoleClient, /SUPABASE_SECRET_KEY/);
  assert.doesNotMatch(serviceRoleClient, /ANON|PUBLISHABLE/);
  assert.match(trashApi, /requestMetadata: requestMetadata\(request\)/);
  assert.match(trashModule, /runPlanningTrashLifecycle/);
  for (const field of ["rootType", "rootId", "affectedTaskIds", "trashRevision", "item", "eventIds"]) {
    assert.match(trashModule, new RegExp(`${field}:`));
  }
  assert.equal(routes.every((route) => /export async function POST/.test(route)), true);
  assert.equal(routes.filter((route) => /"deliverable"/.test(route)).length, 2);
  assert.equal(routes.filter((route) => /"initiative"/.test(route)).length, 2);
});

test("paper-bin UI replaces hard-delete controls with an accessible reason dialog", async () => {
  const dialog = await readFile("src/features/planning/molecules/planning-trash-action-dialog.tsx", "utf8");
  const headerActions = await readFile("src/features/tasks/molecules/task-detail-header-actions.tsx", "utf8");
  const projects = await readFile("src/features/projects/organisms/projects-overview.tsx", "utf8");
  const taskClient = await readFile("src/features/tasks/model/task-api-client.ts", "utf8");

  assert.match(dialog, /useModalDialog/);
  assert.match(dialog, /role="dialog"/);
  assert.match(dialog, /PLANNING_TRASH_REASON_MAX_LENGTH/);
  assert.match(dialog, /In den Papierkorb verschieben/);
  assert.match(dialog, /Aus dem Papierkorb wiederherstellen/);
  assert.match(headerActions, /PlanningTrashActionDialog/);
  assert.match(headerActions, /Deliverable zurückziehen/);
  assert.match(projects, /onWithdrawInitiative/);
  assert.match(projects, /Zurückziehen/);
  assert.match(taskClient, /method: "POST"/);
  assert.doesNotMatch(taskClient, /deleteTaskRequest/);
  assert.doesNotMatch(`${headerActions}\n${projects}`, /window\.confirm/);
});

test("approval decisions drain lifecycle jobs and rejected roots leave active UI state", async () => {
  const [trigger, taskRoute, initiativeRoute, approvalModule, taskCommands, initiativeCommands] = await Promise.all([
    readFile("src/lib/planning-github-lifecycle-trigger.ts", "utf8"),
    readFile("src/app/api/tasks/[id]/approval/route.ts", "utf8"),
    readFile("src/app/api/initiatives/[id]/approval/route.ts", "utf8"),
    readFile("src/features/planning-items/model/planning-items-approval.ts", "utf8"),
    readFile("src/features/tasks/hooks/use-task-mutation-commands.ts", "utf8"),
    readFile("src/features/projects/hooks/use-initiative-commands.ts", "utf8"),
  ]);

  assert.match(trigger, /drainPlanningGitHubLifecycleJobs/);
  assert.match(trigger, /taskIds/);
  assert.match(trigger, /scope:/);
  assert.doesNotMatch(trigger, /limit: 100/);
  assert.doesNotMatch(trigger, /registeredDrain|registerPlanningGitHubLifecycleDrain/);
  for (const route of [taskRoute]) {
    assert.match(route, /getServerServiceRoleSupabase/);
    assert.match(route, /runPlanningApprovalLifecycle/);
    assert.match(route, /lifecycle/);
  }
  assert.match(approvalModule, /attemptPlanningGitHubLifecycleDrain/);
  assert.match(approvalModule, /loadOutstandingPlanningGitHubLifecycleTaskIds/);
  assert.match(initiativeRoute, /createPlanningApprovalPlanningItems/);
  assert.match(initiativeRoute, /lifecycle: null/);
  assert.doesNotMatch(initiativeRoute, /attemptPlanningGitHubLifecycleDrain|loadOutstandingPlanningGitHubLifecycleTaskIds/);
  assert.match(taskCommands, /action === "reject"[^]*removePlanningRootFromData\(current, "deliverable", task\.id\)/);
  assert.match(initiativeCommands, /action === "reject"[^]*removePlanningRootFromData\(current, "initiative", initiative\.id\)/);
});
