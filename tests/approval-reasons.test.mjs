import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { loadTranspiledModule } from "./helpers/transpile-module.mjs";

const decisionPolicy = await loadTranspiledModule("src/lib/approval-decision-policy.ts");
const approvalDomain = await loadTranspiledModule("src/features/planning/model/approval-domain.ts");
const notificationCatalog = await loadTranspiledModule("src/lib/notification-catalog.ts");

test("approval decision notes are trimmed, conditionally required, and bounded", () => {
  assert.deepEqual(decisionPolicy.validateApprovalDecisionNote("approve", undefined), { ok: true, note: null });
  assert.deepEqual(decisionPolicy.validateApprovalDecisionNote("approve", " optional "), { ok: true, note: "optional" });
  assert.deepEqual(decisionPolicy.validateApprovalDecisionNote("reject", "   "), { ok: false, reason: "required" });
  assert.deepEqual(decisionPolicy.validateApprovalDecisionNote("return_to_draft", " Bitte schärfen. "), {
    ok: true,
    note: "Bitte schärfen.",
  });
  assert.deepEqual(
    decisionPolicy.validateApprovalDecisionNote("reject", "x".repeat(decisionPolicy.APPROVAL_DECISION_NOTE_MAX_LENGTH + 1)),
    { ok: false, reason: "too_long" },
  );
});

test("return affordances match the server role and state contract", () => {
  const proposedInitiative = { approvalStatus: "proposed" };
  assert.equal(approvalDomain.canReturnInitiativeForRevision(proposedInitiative, { platformRole: "ceo" }), true);
  assert.equal(approvalDomain.canReturnInitiativeForRevision(proposedInitiative, { platformRole: "deputy" }), true);
  assert.equal(approvalDomain.canReturnInitiativeForRevision(proposedInitiative, { platformRole: "founder" }), false);
  assert.equal(approvalDomain.canReturnInitiativeForRevision({ approvalStatus: "approved" }, { platformRole: "ceo" }), false);

  const proposedDeliverable = { taskType: "deliverable", approvalStatus: "proposed" };
  assert.equal(approvalDomain.canReturnDeliverableForRevision(proposedDeliverable, undefined, { id: "deputy-1", platformRole: "deputy" }), true);
  assert.equal(approvalDomain.canReturnDeliverableForRevision(proposedDeliverable, { accountableProfileId: "founder-1" }, { id: "founder-1", platformRole: "founder" }), true);
  assert.equal(approvalDomain.canReturnDeliverableForRevision({ ...proposedDeliverable, approvalStatus: "rejected" }, { accountableProfileId: "founder-1" }, { id: "founder-1", platformRole: "founder" }), false);
});

test("deliverable decision affordances apply the parent approval gate only to approval", () => {
  const proposedDeliverable = { taskType: "deliverable", approvalStatus: "proposed" };
  const accountable = { id: "founder-1", platformRole: "founder" };
  const approvedInitiative = { accountableProfileId: "founder-1", approvalStatus: "approved" };
  const proposedInitiative = { accountableProfileId: "founder-1", approvalStatus: "proposed" };

  assert.equal(approvalDomain.canApproveDeliverableApproval(proposedDeliverable, approvedInitiative, accountable), true);
  assert.equal(approvalDomain.canApproveDeliverableApproval(proposedDeliverable, proposedInitiative, accountable), false);
  assert.equal(approvalDomain.canRejectDeliverableApproval(proposedDeliverable, proposedInitiative, accountable), true);
  assert.equal(approvalDomain.canRejectDeliverableApproval(proposedDeliverable, undefined, { id: "ceo-1", platformRole: "ceo" }), false);
  assert.equal(approvalDomain.canRejectDeliverableApproval(proposedDeliverable, proposedInitiative, { id: "deputy-1", platformRole: "deputy" }), false);
});

test("only the current rejection or return reason is exposed by the approval view model", () => {
  assert.equal(approvalDomain.currentApprovalDecisionReason({ approvalStatus: "draft", decisionNote: "Bitte überarbeiten." }), "Bitte überarbeiten.");
  assert.equal(approvalDomain.currentApprovalDecisionReason({ approvalStatus: "rejected", decisionNote: "Passt nicht zum Ziel." }), "Passt nicht zum Ziel.");
  assert.equal(approvalDomain.currentApprovalDecisionReason({ approvalStatus: "approved", decisionNote: "Freigegeben." }), "");
  assert.equal(approvalDomain.currentApprovalDecisionReason({ approvalStatus: "proposed", decisionNote: "Alt" }), "");
});

test("approval routes and UI share the reason contract", async () => {
  const [api, initiativeRoute, taskRoute, dialog, projects, taskSidebar] = await Promise.all([
    readFile("src/lib/approval-api.ts", "utf8"),
    readFile("src/app/api/initiatives/[id]/approval/route.ts", "utf8"),
    readFile("src/app/api/tasks/[id]/approval/route.ts", "utf8"),
    readFile("src/features/planning/molecules/approval-decision-dialog.tsx", "utf8"),
    readFile("src/features/projects/organisms/projects-overview.tsx", "utf8"),
    readFile("src/features/tasks/organisms/task-detail-panel-sidebar.tsx", "utf8"),
  ]);

  assert.match(api, /validateApprovalDecisionNote/);
  assert.match(initiativeRoute, /requirePlanningContributor/);
  assert.match(initiativeRoute, /decide_initiative_approval_transaction/);
  assert.match(taskRoute, /requirePlanningContributor/);
  assert.match(taskRoute, /decide_deliverable_approval_transaction/);
  assert.match(dialog, /maxLength=\{APPROVAL_DECISION_NOTE_MAX_LENGTH\}/);
  assert.match(dialog, /required/);
  assert.match(projects, /canReturnInitiativeForRevision/);
  assert.match(projects, /action: "return_to_draft"/);
  assert.match(taskSidebar, /<ApprovalDecisionDialog/);
  assert.doesNotMatch(taskSidebar, /onDecideApproval\("reject"\)/);
  assert.doesNotMatch(taskSidebar, /onDecideApproval\("return_to_draft"\)/);
});

test("approval RPCs enforce proposed state, roles, CAS, notes, and atomic return notifications", async () => {
  const [migration, schema, verification] = await Promise.all([
    readFile("supabase/0061_approval_reasons_and_return.sql", "utf8"),
    readFile("supabase/schema.sql", "utf8"),
    readFile("scripts/verify-supabase.mjs", "utf8"),
  ]);

  for (const sql of [migration, schema]) {
    assert.match(sql, /approval_revision <> p_expected_revision/);
    assert.match(sql, /p_action in \('reject', 'return_to_draft'\) and v_note is null/);
    assert.match(sql, /char_length\(v_note\) > 2000/);
    assert.match(sql, /v_initiative\.approval_status <> 'proposed'/);
    assert.match(sql, /v_task\.approval_status <> 'proposed'/);
    assert.match(sql, /v_actor_role not in \('ceo', 'deputy'\)/);
    assert.match(sql, /v_initiative\.accountable_profile_id/);
    assert.match(sql, /v_notification_recipient_id := v_initiative\.proposed_by/);
    assert.match(sql, /v_notification_recipient_id := v_task\.proposed_by/);
    assert.match(sql, /'planning_item\.returned'/);
    assert.match(sql, /insert into public\.notification_events/);
    assert.match(sql, /planning-item-returned:initiative/);
    assert.match(sql, /planning-item-returned:task/);
    assert.match(sql, /'note', v_note/);
    assert.doesNotMatch(sql, /proposed_by = case when p_action = 'return_to_draft'/);
    assert.doesNotMatch(sql, /v_notification_recipient_id\s*<>\s*p_actor_profile_id/);
  }

  assert.match(migration, /revoke all on function public\.decide_initiative_approval_transaction[\s\S]*from public, anon, authenticated/);
  assert.match(migration, /grant execute on function public\.decide_deliverable_approval_transaction[\s\S]*to service_role/);
  assert.match(verification, /verifyApprovalDecisionRpcs/);
  assert.match(verification, /RPC did not require an approval decision note/);
});

test("returned planning items use the existing personal Google Chat delivery pipeline", () => {
  const definition = notificationCatalog.notificationDefinition("planning_item.returned");
  assert.equal(definition.lifecycle, "actionable");
  assert.equal(notificationCatalog.shouldSendToGoogleChatDigest("planning_item.returned"), true);
  assert.equal(notificationCatalog.shouldSendToGoogleChatDm("planning_item.returned"), true);
});
