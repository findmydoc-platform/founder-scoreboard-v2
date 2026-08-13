import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(path, "utf8");

test("ReviseItem owns the four canonical field matrices and excludes workflow parent fields", async () => {
  const [contract, update] = await Promise.all([
    read("src/features/planning-items/model/planning-items.ts"),
    read("src/features/planning-items/model/planning-item-update.ts"),
  ]);

  assert.match(contract, /type EpicChanges[^]*itemKind: "epic"[^]*targetDate\?: string \| null/);
  assert.match(contract, /type InitiativeChanges[^]*strategy\?: Partial<PlanningStrategy>[^]*raciAssignments\?: readonly PlanningRaciAssignment\[\][^]*priority\?: string/);
  assert.match(contract, /type DeliverableChanges[^]*brief\?: Partial<PlanningBrief>[^]*workstream\?: string[^]*hours\?: number/);
  assert.match(contract, /type SubIssueChanges[^]*brief\?: Partial<PlanningBrief>[^]*githubRepository\?: string/);
  assert.doesNotMatch(contract.slice(contract.indexOf("export type PlanningItemChanges"), contract.indexOf("export type ReviseItem")), /parentId|sprintId|approvalStatus|reviewStatus/);

  assert.match(update, /const fieldsByType: Record<TeamPlanningItemType/);
  assert.match(update, /epic: new Set\(\["title", "description", "ownerId", "targetDate", "status"\]\)/);
  assert.match(update, /initiative: new Set\(\[[^]*"accountableProfileId"[^]*"informedProfileIds"/);
  assert.match(update, /deliverable: new Set\(\[[^]*"problemStatement"[^]*"definitionOfDone"/);
  assert.match(update, /sub_issue: new Set\(\[[^]*"githubRepo"/);
  assert.match(update, /reason: "useChangeParentAction"/);
});

test("Browser and Team transports delegate Revise writes to one deep module", async () => {
  const [taskAdapter, teamAdapter, teamPreviewAdapter, update, appTask, appTeam, appTeamPreview] = await Promise.all([
    read("src/features/planning-items/model/planning-items-browser-task-update.ts"),
    read("src/features/planning-items/model/planning-items-team-update-route.ts"),
    read("src/features/planning-items/model/planning-items-team-update-preview.ts"),
    read("src/features/planning-items/model/planning-item-update.ts"),
    read("src/app/api/tasks/[id]/route.ts"),
    read("src/app/api/team/planning-items/v2/items/[id]/route.ts"),
    read("src/app/api/team/planning-items/v2/items/[id]/preview/route.ts"),
  ]);

  assert.match(taskAdapter, /createBrowserRevisePlanningItems/);
  assert.match(teamAdapter, /createTeamRevisePlanningItems/);
  assert.match(teamPreviewAdapter, /createTeamRevisePlanningItems/);
  assert.match(update, /update_browser_planning_item_transaction/);
  assert.match(update, /update_browser_planning_task_transaction/);
  assert.match(update, /update_team_planning_item_with_projection_transaction/);
  for (const route of [appTask, appTeam, appTeamPreview]) {
    assert.doesNotMatch(route, /\.rpc\(|\.from\(/);
  }
  for (const adapter of [taskAdapter, teamAdapter, teamPreviewAdapter]) {
    assert.doesNotMatch(adapter, /\.rpc\("update_(?:browser|team|planning)/);
  }
});

test("Revise persistence is service-only, actor-bound, CAS-protected, and parent-safe", async () => {
  const migration = [
    await read("supabase/migrations/20260812180500_browser_planning_revise_command.sql"),
    await read("supabase/migrations/20260813065427_preserve_planning_cutover_compatibility.sql"),
  ].join("\n");

  assert.match(migration, /update_browser_planning_item_transaction/);
  assert.match(migration, /update_browser_planning_task_transaction/);
  assert.match(migration, /where id = p_task_id for update/);
  assert.match(migration, /v_patch \? 'parent_task_id'/);
  assert.match(migration, /Epic revise requires an operational lead/);
  assert.match(migration, /Initiative revise requires ownership/);
  assert.match(migration, /Parent, owner, and RACI changes require an operational lead/);
  assert.match(migration, /public\.update_planning_item_transaction\([^]*v_patch[^]*p_strategy[^]*p_raci_assignments/);
  assert.match(migration, /Deliverable revise requires ownership/);
  assert.match(migration, /Unowned Sub-Issue revise is limited to status transitions/);
  assert.match(migration, /planning item review is locked/);
  assert.match(migration, /parent planning item review is locked/);
  assert.match(migration, /planning item is not eligible for sprint assignment/);
  assert.match(migration, /from public\.sprints where id = v_target_sprint_id for share/);
  assert.match(migration, /revoke all on function public\.update_browser_planning_item_transaction[^]*from public/);
  assert.match(migration, /grant execute on function public\.update_browser_planning_item_transaction[^]*to service_role/);
  assert.match(migration, /grant execute on function public\.update_browser_planning_task_transaction[^]*to service_role/);
  assert.doesNotMatch(migration, /to authenticated|to anon/);
});
