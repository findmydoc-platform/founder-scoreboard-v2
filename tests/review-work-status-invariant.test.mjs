import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const migrationPath = "supabase/migrations/20260721135448_normalize_review_work_status.sql";
const approvalRepairMigrationPath = "supabase/migrations/20260721141313_restore_founder_intake_approval.sql";
const repairedTaskId = "sebastian-team-intake-f913a6437be042019ba8d3f5a95737e3-bb71383e2eaf4cd4b282b27ceaacc3fc-1";

test("invalid deliverable review states normalize to active work", async () => {
  const migration = await readFile(migrationPath, "utf8");

  assert.match(migration, /create or replace function public\.normalize_task_approval_state/);
  assert.match(migration, /new\.status = 'Review'/);
  assert.match(migration, /new\.approval_status is distinct from 'approved'/);
  assert.match(migration, /new\.review_status is distinct from 'requested'/);
  assert.match(migration, /new\.status := 'In Arbeit'/);
  assert.match(migration, /'task\.status_changed'/);
  assert.match(migration, /'Status geändert: Review → In Arbeit'/);
});

test("the affected production item receives a narrowly guarded repair", async () => {
  const migration = await readFile(migrationPath, "utf8");

  assert.match(migration, new RegExp(`where id = '${repairedTaskId}'`));
  assert.match(migration, /and task_type = 'deliverable'/);
  assert.match(migration, /and status = 'Review'/);
  assert.match(migration, /approval_status is distinct from 'approved'/);
  assert.match(migration, /review_status is distinct from 'requested'/);
  assert.doesNotMatch(migration, /delete\s+from|truncate|drop\s+(?:table|schema)/i);
});

test("the affected production item is restored to an approved working state", async () => {
  const migration = await readFile(approvalRepairMigrationPath, "utf8");

  assert.match(migration, new RegExp(`where id = '${repairedTaskId}'`));
  assert.match(migration, /v_task\.task_type <> 'deliverable'/);
  assert.match(migration, /v_task\.status <> 'In Arbeit'/);
  assert.match(migration, /v_task\.approval_status <> 'draft'/);
  assert.match(migration, /v_task\.approval_revision <> 3/);
  assert.match(migration, /v_task\.review_status <> 'not_requested'/);
  assert.match(migration, /approval_status = 'approved'/);
  assert.match(migration, /approval_revision = approval_revision \+ 1/);
  assert.match(migration, /'task\.approval_approve'/);
  assert.match(migration, /'invalid_review_workflow_state_repaired'/);
  assert.doesNotMatch(migration, /delete\s+from|truncate|drop\s+(?:table|schema)/i);
});

test("an approved task can request review through the status control", async () => {
  const [taskSurface, mutationContract] = await Promise.all([
    readFile("src/features/tasks/organisms/task-detail-surface.tsx", "utf8"),
    readFile("src/features/tasks/model/task-mutation-contract.ts", "utf8"),
  ]);

  assert.match(taskSurface, /canChangeStatus=\{controller\.permissions\.canUpdateStatus && effectivelyApproved && canSelectNextStatus\}/);
  assert.match(mutationContract, /normalizedPatch\.status === "Review"/);
  assert.match(mutationContract, /status: "Review",\s*reviewStatus: "requested"/);
});
