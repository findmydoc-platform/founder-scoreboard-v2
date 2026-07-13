import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const root = new URL("../", import.meta.url);
const read = (path) => readFile(new URL(path, root), "utf8");

test("skill requires semantic Initiative placement and sequential hierarchy creation", async () => {
  const [skill, authoring] = await Promise.all([
    read("SKILL.md"),
    read("references/intake-authoring.md"),
  ]);

  for (const field of ["approvalStatus", "goal", "scopeConstraints", "successCriteria"]) {
    assert.match(`${skill}\n${authoring}`, new RegExp(field));
  }
  assert.match(authoring, /Exclude every Initiative with `approvalStatus = rejected`/);
  assert.match(authoring, /multiple Initiatives are equally plausible/);
  assert.match(authoring, /If none fits/);
  assert.match(skill, /Create Initiative before Deliverable and Deliverable before Sub-Issue/);
});

test("skill keeps all credential tooling inside the skill and uses one generic entry point", async () => {
  const [skill, client, wrapper] = await Promise.all([
    read("SKILL.md"),
    read("scripts/founderops-intake.mjs"),
    read("scripts/configure-token.sh"),
  ]);

  assert.match(skill, /node scripts\/configure-token\.mjs status/);
  assert.match(client, /createCredentialStore\(\)\.readToken\(\)/);
  assert.doesNotMatch(client, /\/usr\/bin\/security/);
  assert.match(wrapper, /configure-token\.mjs/);
});

test("skill uses only the personal Team Task Intake v2 API", async () => {
  const [skill, client] = await Promise.all([
    read("SKILL.md"),
    read("scripts/founderops-intake.mjs"),
  ]);

  assert.match(skill, /never the separate Agent API/);
  assert.match(client, /\/api\/team\/task-context/);
  assert.match(client, /\/api\/team\/task-intake\/v2/);
  assert.doesNotMatch(client, /\/api\/agent\//);
});

