import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";





test("runtime configuration and operations docs expose the Issue and comment intake boundary", async () => {
  const [envExample, deployment, idempotency, intakeDoc, schemaChecks] = await Promise.all([
    readFile(".env.example", "utf8"),
    readFile("docs/vercel-deployment.md", "utf8"),
    readFile("docs/github-api-idempotency.md", "utf8"),
    readFile("docs/github-webhook-intake.md", "utf8"),
    readFile("src/lib/planning-schema-checks.json", "utf8"),
  ]);

  assert.match(envExample, /^GITHUB_APP_WEBHOOK_SECRET=$/m);
  assert.match(envExample, /^GITHUB_WEBHOOK_ORGANIZATION_ID=$/m);
  assert.match(deployment, /\/api\/github\/webhooks/);
  assert.match(idempotency, /github-webhook-intake\.md/);
  assert.match(intakeDoc, /FounderOps remains the source of truth/i);
  assert.match(intakeDoc, /sub_issues/);
  assert.match(intakeDoc, /issue_dependencies/);
  assert.match(intakeDoc, /issue_comment/);
  assert.match(intakeDoc, /pull-request comments are ignored/i);
  assert.match(intakeDoc, /Recent deliveries/);
  assert.match(intakeDoc, /Redeliver/);
  assert.match(intakeDoc, /Preview must not receive the production webhook secret/);
  assert.match(deployment, /GITHUB_APP_WEBHOOK_SECRET.*Vercel Production/);
  assert.match(deployment, /rerun the protected production workflow/);

  const checks = JSON.parse(schemaChecks);
  const deliveryCheck = checks.find((check) => check.table === "github_webhook_deliveries");
  assert.ok(deliveryCheck);
  assert.equal(deliveryCheck.health, false);
  assert.match(deliveryCheck.select, /delivery_id/);
  assert.match(deliveryCheck.select, /payload_sha256/);
  assert.match(deliveryCheck.select, /comment_id/);
  assert.match(deliveryCheck.select, /comment_node_id/);
  assert.match(deliveryCheck.select, /comment_updated_at/);
  assert.equal(deliveryCheck.select.split(",").includes("payload"), false);
});
