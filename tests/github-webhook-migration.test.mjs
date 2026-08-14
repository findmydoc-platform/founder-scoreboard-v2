import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { serviceRoleOnlyTablePrivileges } from "../scripts/lib/database-security/contracts.mjs";
import { readSupabaseSchemaContract } from "../scripts/lib/supabase-migrations.mjs";

const migrationPath = "supabase/migrations/20260814180126_github_issue_webhook_delivery_journal.sql";

test("the webhook migration creates a service-role-only delivery journal", async () => {
  const [migration, schemaContract] = await Promise.all([
    readFile(migrationPath, "utf8"),
    readSupabaseSchemaContract(),
  ]);

  assert.match(migration, /create table if not exists public\.github_webhook_deliveries/i);
  assert.match(migration, /delivery_id text primary key/i);
  assert.match(migration, /repository_id bigint not null/i);
  assert.match(migration, /issue_id bigint not null/i);
  assert.match(migration, /issue_node_id text not null/i);
  assert.match(migration, /issue_updated_at timestamptz not null/i);
  assert.match(migration, /payload_sha256 text not null/i);
  assert.doesNotMatch(migration, /\bpayload jsonb\b/i);
  assert.match(migration, /status text not null default 'received'/i);
  assert.match(migration, /primary key[\s\S]*delivery_id|delivery_id text primary key/i);
  assert.match(migration, /enable row level security/i);
  assert.match(
    migration,
    /revoke all on table public\.github_webhook_deliveries from public, anon, authenticated, service_role/i,
  );
  assert.match(
    migration,
    /grant select, insert on table public\.github_webhook_deliveries to service_role/i,
  );
  assert.doesNotMatch(migration, /grant[^;]*\bupdate\b[^;]*github_webhook_deliveries/i);
  assert.doesNotMatch(migration, /grant[^;]*github_webhook_deliveries[^;]*to (?:public|anon|authenticated)/i);
  assert.doesNotMatch(migration, /\b(?:insert into|update|delete from)\s+public\.(?:tasks|deliverables|initiatives|epics)\b/i);
  assert.match(schemaContract, /github_webhook_deliveries/);
  assert.deepEqual(serviceRoleOnlyTablePrivileges, [
    ["github_webhook_deliveries", ["SELECT", "INSERT"]],
  ]);
});

test("runtime configuration and operations docs expose the Issue-only intake boundary", async () => {
  const [envExample, deployment, idempotency, intakeDoc, schemaChecks, verifier] = await Promise.all([
    readFile(".env.example", "utf8"),
    readFile("docs/vercel-deployment.md", "utf8"),
    readFile("docs/github-api-idempotency.md", "utf8"),
    readFile("docs/github-webhook-intake.md", "utf8"),
    readFile("src/lib/planning-schema-checks.json", "utf8"),
    readFile("scripts/verify-supabase.mjs", "utf8"),
  ]);

  assert.match(envExample, /^GITHUB_APP_WEBHOOK_SECRET=$/m);
  assert.match(deployment, /\/api\/github\/webhooks/);
  assert.match(deployment, /Issue events/i);
  assert.match(idempotency, /github-webhook-intake\.md/);
  assert.match(intakeDoc, /FounderOps remains the source of truth/i);
  assert.match(intakeDoc, /does not mutate planning items/i);
  assert.match(intakeDoc, /sub_issues/);
  assert.match(intakeDoc, /issue_dependencies/);
  assert.match(intakeDoc, /issue_comment/);
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
  assert.equal(deliveryCheck.select.split(",").includes("payload"), false);
  assert.match(verifier, /githubWebhookDeliveries: await count\("github_webhook_deliveries"\)/);
});
