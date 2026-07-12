import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("Team Task Intake exposes only the approval-aware v2 contract", async () => {
  const [contract, context, v2Preview, v2Commit, openapi] = await Promise.all([
    read("src/features/intake/model/team-task-intake-contract.ts"),
    read("src/features/intake/model/team-task-context.ts"),
    read("src/app/api/team/task-intake/v2/preview/route.ts"),
    read("src/app/api/team/task-intake/v2/commit/route.ts"),
    read("public/founderops-team-intake-openapi.json"),
  ]);

  assert.match(contract, /TEAM_TASK_INTAKE_ALLOWED_ITEM_TYPES = \["initiative", "deliverable", "sub_issue"\]/);
  assert.match(context, /allowedItemTypes: TEAM_TASK_INTAKE_ALLOWED_ITEM_TYPES/);
  assert.match(context, /subIssuePolicy: "any-deliverable"/);
  assert.match(v2Preview, /buildTeamTaskIntakeV2Preview/);
  assert.match(v2Commit, /create_team_task_intake_v2_transaction/);

  const document = JSON.parse(openapi);
  assert.ok(document.paths["/api/team/task-intake/v2/preview"]);
  assert.ok(document.paths["/api/team/task-intake/v2/commit"]);
  assert.equal(document.paths["/api/team/task-intake/preview"], undefined);
  assert.equal(document.paths["/api/team/task-intake/commit"], undefined);
  assert.deepEqual(document.components.schemas.TeamTaskIntakeV2Item.properties.itemType.enum, ["initiative", "deliverable", "sub_issue"]);
});

test("legacy Team Task Intake routes and parsers are absent", async () => {
  for (const path of [
    "src/app/api/team/task-intake/preview/route.ts",
    "src/app/api/team/task-intake/commit/route.ts",
    "src/features/intake/model/team-task-intake.ts",
    "src/features/intake/model/team-task-intake-policy.ts",
    "src/features/intake/model/team-task-intake-commit.ts",
  ]) {
    await assert.rejects(access(new URL(path, root)));
  }
});

test("CEO and Agent intake reject the removed proposal task type", async () => {
  const [intake, agentOpenApi, genericContract] = await Promise.all([
    read("src/features/intake/model/task-intake.ts"),
    read("public/founderops-agent-openapi.json"),
    read("src/features/intake/model/team-task-intake-contract.ts"),
  ]);

  assert.doesNotMatch(intake, /"proposal"/);
  assert.doesNotMatch(genericContract, /"proposal"/);
  assert.deepEqual(JSON.parse(agentOpenApi).components.schemas.TaskIntakeInput.properties.taskType.enum, ["deliverable", "sub_issue"]);
});
