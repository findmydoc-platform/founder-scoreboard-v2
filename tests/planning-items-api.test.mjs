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
  assert.ok(document.components.schemas.AccessMetadata);
  assert.ok(document.components.schemas.AuthorizedResponse.required.includes("_meta"));
  assert.equal(document.components.schemas.TokenRequiredResponse.properties.code.const, "TOKEN_REQUIRED");
  assert.equal(document.components.schemas.TokenInactiveResponse.properties.code.const, "TOKEN_INACTIVE");
  assert.equal(document.components.schemas.InsufficientScopeResponse.properties.code.const, "INSUFFICIENT_SCOPE");
  assert.equal(
    document.components.schemas.DeniedAccessMetadata.allOf[1].properties.access.properties.decision.const,
    "denied",
  );
  assert.equal("_meta" in document.components.schemas.TokenInactiveResponse.properties, false);
  assert.ok(document.components.schemas.ContextResponse.required.includes("_meta"));
  assert.deepEqual(document.components.schemas.AccessDecision.properties.decision.enum, ["allowed", "denied"]);
  for (const path of Object.values(document.paths)) {
    for (const operation of Object.values(path)) {
      assert.ok(operation.responses["401"], `${operation.operationId} must document 401`);
      assert.ok(operation.responses["403"], `${operation.operationId} must document 403`);
      for (const [status, response] of Object.entries(operation.responses)) {
        if (status === "401" || status === "403") continue;
        const responseRef = response.$ref || response.content?.["application/json"]?.schema?.$ref || "";
        assert.ok(responseRef, `${operation.operationId} ${status} must publish a response schema`);
      }
    }
  }
});
