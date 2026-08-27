import assert from "node:assert/strict";
import { test } from "vitest";
import { loadTranspiledModule } from "../../helpers/transpile-module.mjs";

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
  const deputy = { id: "deputy-1", platformRole: "deputy" };
  const approvedInitiative = { accountableProfileId: "founder-1", approvalStatus: "approved" };
  const proposedInitiative = { accountableProfileId: "founder-1", approvalStatus: "proposed" };

  assert.equal(approvalDomain.canApproveDeliverableApproval(proposedDeliverable, approvedInitiative, accountable), true);
  assert.equal(approvalDomain.canApproveDeliverableApproval(proposedDeliverable, proposedInitiative, accountable), false);
  assert.equal(approvalDomain.canRejectDeliverableApproval(proposedDeliverable, proposedInitiative, accountable), true);
  assert.equal(approvalDomain.canApproveDeliverableApproval(proposedDeliverable, approvedInitiative, deputy), true);
  assert.equal(approvalDomain.canApproveDeliverableApproval(proposedDeliverable, proposedInitiative, deputy), false);
  assert.equal(approvalDomain.canRejectDeliverableApproval(proposedDeliverable, proposedInitiative, deputy), true);
  assert.equal(approvalDomain.canRejectDeliverableApproval(proposedDeliverable, undefined, { id: "ceo-1", platformRole: "ceo" }), false);
  assert.equal(approvalDomain.canRejectDeliverableApproval(proposedDeliverable, proposedInitiative, { id: "viewer-1", platformRole: "viewer" }), false);
});

test("Deputies can decide proposed Initiatives while Founder and Viewer cannot", () => {
  const proposedInitiative = { approvalStatus: "proposed" };

  assert.equal(approvalDomain.canDecideInitiativeApproval(proposedInitiative, { platformRole: "ceo" }), true);
  assert.equal(approvalDomain.canDecideInitiativeApproval(proposedInitiative, { platformRole: "deputy" }), true);
  assert.equal(approvalDomain.canDecideInitiativeApproval(proposedInitiative, { platformRole: "founder" }), false);
  assert.equal(approvalDomain.canDecideInitiativeApproval(proposedInitiative, { platformRole: "viewer" }), false);
});

test("only the current rejection or return reason is exposed by the approval view model", () => {
  assert.equal(approvalDomain.currentApprovalDecisionReason({ approvalStatus: "draft", decisionNote: "Bitte überarbeiten." }), "Bitte überarbeiten.");
  assert.equal(approvalDomain.currentApprovalDecisionReason({ approvalStatus: "rejected", decisionNote: "Passt nicht zum Ziel." }), "Passt nicht zum Ziel.");
  assert.equal(approvalDomain.currentApprovalDecisionReason({ approvalStatus: "approved", decisionNote: "Freigegeben." }), "");
  assert.equal(approvalDomain.currentApprovalDecisionReason({ approvalStatus: "proposed", decisionNote: "Alt" }), "");
});


test("returned planning items use the existing personal Google Chat delivery pipeline", () => {
  const definition = notificationCatalog.notificationDefinition("planning_item.returned");
  assert.equal(definition.lifecycle, "actionable");
  assert.equal(notificationCatalog.shouldSendToGoogleChatDigest("planning_item.returned"), true);
  assert.equal(notificationCatalog.shouldSendToGoogleChatDm("planning_item.returned"), true);
});
