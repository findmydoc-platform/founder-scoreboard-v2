import assert from "node:assert/strict";
import test from "node:test";
import { readSupabaseSchemaContract } from "../scripts/lib/supabase-migrations.mjs";

const schema = await readSupabaseSchemaContract();

test("Issue comment webhook projection uses service-role-only ordered projection RPCs", () => {
  assert.match(
    schema,
    /alter table public\.github_webhook_deliveries[\s\S]*add column if not exists status_reason text/,
  );
  assert.match(
    schema,
    /create or replace function public\.claim_github_issue_comment_webhook_delivery\([\s\S]*returns table \([\s\S]*action text[\s\S]*comment_updated_at timestamptz[\s\S]*security definer[\s\S]*event_name = 'issue_comment'[\s\S]*status in \('received', 'retry_scheduled', 'failed'\)/,
  );
  assert.match(
    schema,
    /create or replace function public\.resolve_github_issue_comment_webhook_tasks\([\s\S]*security definer[\s\S]*normalize_planning_github_issue_reference\([\s\S]*issue_reference\.normalized_repo = v_repository_full_name[\s\S]*limit 2/,
  );
  assert.match(
    schema,
    /create or replace function public\.apply_github_issue_comment_webhook_projection\([\s\S]*security definer[\s\S]*only the matching deleted event can remove a GitHub comment projection[\s\S]*pg_advisory_xact_lock\(v_delivery\.comment_id\)[\s\S]*newer\.comment_updated_at > p_comment_updated_at[\s\S]*newer\.action = 'deleted'[\s\S]*return 'stale'[\s\S]*on conflict \(source, external_id\) do update/,
  );
  assert.match(
    schema,
    /create or replace function public\.finalize_github_issue_comment_webhook_delivery\([\s\S]*security definer[\s\S]*delivery\.lock_token = p_lock_token/,
  );
  assert.match(
    schema,
    /revoke all on function public\.claim_github_issue_comment_webhook_delivery\(text, uuid, integer\)[\s\S]*from public, anon, authenticated/,
  );
  assert.match(
    schema,
    /grant execute on function public\.claim_github_issue_comment_webhook_delivery\(text, uuid, integer\)[\s\S]*to service_role/,
  );
  assert.match(
    schema,
    /revoke all on function public\.resolve_github_issue_comment_webhook_tasks\(text, integer\)[\s\S]*from public, anon, authenticated[\s\S]*grant execute on function public\.resolve_github_issue_comment_webhook_tasks\(text, integer\)[\s\S]*to service_role/,
  );
  assert.match(
    schema,
    /revoke all on function public\.apply_github_issue_comment_webhook_projection\(text, uuid, text, text, timestamptz, text, text, text, text, timestamptz, timestamptz\)[\s\S]*from public, anon, authenticated[\s\S]*grant execute on function public\.apply_github_issue_comment_webhook_projection\(text, uuid, text, text, timestamptz, text, text, text, text, timestamptz, timestamptz\)[\s\S]*to service_role/,
  );
  assert.match(
    schema,
    /grant execute on function public\.finalize_github_issue_comment_webhook_delivery\(text, uuid, text, text, text, timestamptz\)[\s\S]*to service_role/,
  );
  assert.doesNotMatch(
    schema,
    /grant update on table public\.github_webhook_deliveries to service_role/,
  );
});
