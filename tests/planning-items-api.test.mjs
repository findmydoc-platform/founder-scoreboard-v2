import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const read = (path) => readFile(path, "utf8");

test("Planning Items API exposes only the canonical v2 transport", async () => {
  const [contextRoute, createRoute, updateRoute, tokenRoute, documentation, openapi] = await Promise.all([
    read("src/app/api/team/planning-items/v2/context/route.ts"),
    read("src/app/api/team/planning-items/v2/items/route.ts"),
    read("src/app/api/team/planning-items/v2/items/[id]/route.ts"),
    read("src/app/api/team/planning-items/v2/tokens/route.ts"),
    read("docs/team-planning-items-api.md"),
    read("public/founderops-team-planning-items-v2-openapi.json"),
  ]);

  for (const route of [contextRoute, createRoute, updateRoute]) {
    assert.doesNotMatch(route, /teamPlanningItemsV2Contract|TeamPlanningItemsApiContract/);
    assert.doesNotMatch(route, /\.rpc\(|\.from\(/);
  }
  assert.match(tokenRoute, /allowEmptyEpicDeletes/);
  assert.match(documentation, /\/v2\//);
  const document = JSON.parse(openapi);
  assert.equal(document.info.version, "2.0.0");
  assert.deepEqual(document.components.schemas.PlanningItemCreate.properties.itemType.enum,
    ["epic", "initiative", "deliverable", "sub_issue"]);
  assert.ok(document.components.schemas.PlanningItemCreate.properties.parentTaskId);
  assert.equal(document.components.schemas.EpicNotEmptyResponse.properties.code.const, "EPIC_NOT_EMPTY");
});
