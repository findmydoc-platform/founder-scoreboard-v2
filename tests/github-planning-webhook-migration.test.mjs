import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { serviceRoleOnlyTablePrivileges } from "../scripts/lib/database-security/contracts.mjs";

const migrationPath = "supabase/migrations/20260816203140_github_planning_webhook_write_contract.sql";

test("planning webhook deliveries are content-free, leased, and service-role-only", async () => {
  const migration = await readFile(migrationPath, "utf8");
  assert.match(migration, /create table if not exists public\.github_planning_webhook_deliveries/i);
  assert.match(migration, /event_name in \('issues', 'sub_issues', 'issue_dependencies', 'projects_v2_item'\)/i);
  assert.match(migration, /changed_fields text\[\] not null default '\{\}'/i);
  assert.match(migration, /organization_id bigint/i);
  assert.match(migration, /related_issue_updated_at timestamptz/i);
  assert.match(migration, /project_item_updated_at timestamptz/i);
  assert.match(migration, /event_name = 'projects_v2_item'[\s\S]*organization_id is not null and organization_login is not null/i);
  assert.match(migration, /payload_sha256 text not null/i);
  assert.doesNotMatch(migration, /\b(?:issue_body|issue_title|payload jsonb)\b/i);
  assert.match(migration, /create or replace function public\.claim_github_planning_webhook_delivery/i);
  assert.match(migration, /create or replace function public\.finalize_github_planning_webhook_delivery/i);
  assert.match(migration, /revoke all on table public\.github_planning_webhook_deliveries from public, anon, authenticated, service_role/i);
  assert.match(migration, /grant select, insert on table public\.github_planning_webhook_deliveries to service_role/i);
  assert.doesNotMatch(migration, /grant[^;]*\bupdate\b[^;]*github_planning_webhook_deliveries/i);
  assert.deepEqual(serviceRoleOnlyTablePrivileges, [
    ["google_workspace_connections", ["SELECT", "INSERT", "UPDATE", "DELETE"]],
    ["github_planning_webhook_deliveries", ["SELECT", "INSERT"]],
    ["github_webhook_deliveries", ["SELECT", "INSERT"]],
  ]);
});

test("stable GitHub user ids authorize humans while projections may be actuator-only", async () => {
  const migration = await readFile(migrationPath, "utf8");
  assert.match(migration, /unique index if not exists github_app_user_tokens_active_user_id_uidx[\s\S]*github_user_id[\s\S]*revoked_at is null/i);
  assert.match(migration, /resolve_github_planning_webhook_actor\([\s\S]*token\.github_user_id = p_github_user_id[\s\S]*profile\.auth_user_id is not null/i);
  assert.match(migration, /alter column actor_profile_id drop not null/i);
  assert.match(migration, /source_kind = 'github_webhook' and source_delivery_id is not null/i);
  assert.match(migration, /enqueue_github_webhook_planning_projection[\s\S]*create_if_missing[\s\S]*false/i);
  assert.match(migration, /planning_github_projection_source_delivery_idx/i);
  assert.match(migration, /predecessor\.status in \('pending', 'processing', 'retry_scheduled'\)/i);
  assert.match(migration, /claim_planning_github_lifecycle_jobs_transaction[\s\S]*planning_github_projection_outbox predecessor[\s\S]*predecessor\.status in \('pending', 'processing', 'retry_scheduled'\)/i);
});

test("closed task guards cover content, parent, reparent, and relationship commands", async () => {
  const migration = await readFile(migrationPath, "utf8");
  assert.match(migration, /update_browser_planning_task_transaction_without_completed_guard/i);
  assert.match(migration, /update_team_planning_item_transaction_without_completed_guard/i);
  assert.match(migration, /mutate_planning_review_command_transaction_without_completed_guard/i);
  assert.match(migration, /v_task\.status = 'Erledigt'[\s\S]*v_patch->>'status' = 'Offen'/i);
  assert.match(migration, /completed parent planning item is locked/i);
  assert.match(migration, /mutate_planning_reparent_command_transaction_without_completed_guard/i);
  assert.match(migration, /mutate_planning_relationship_transaction_without_completed_guard/i);
  assert.match(migration, /create trigger tasks_guard_locked_sub_issue_parent/i);
  assert.match(migration, /errcode = 'P0016'/i);
});
