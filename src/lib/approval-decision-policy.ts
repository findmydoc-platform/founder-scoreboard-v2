import type { ApprovalDecisionAction } from "@/lib/types";

export const APPROVAL_DECISION_NOTE_MAX_LENGTH = 2000;

export type ApprovalReasonAction = Extract<ApprovalDecisionAction, "reject" | "return_to_draft">;

export type ApprovalDecisionNoteValidation =
  | { ok: true; note: string | null }
  | { ok: false; reason: "required" | "too_long" };

export function approvalDecisionRequiresNote(action: ApprovalDecisionAction) {
  return action === "reject" || action === "return_to_draft";
}

export function validateApprovalDecisionNote(
  action: ApprovalDecisionAction,
  value: unknown,
): ApprovalDecisionNoteValidation {
  const note = typeof value === "string" ? value.trim() : "";
  if (note.length > APPROVAL_DECISION_NOTE_MAX_LENGTH) {
    return { ok: false, reason: "too_long" };
  }
  if (approvalDecisionRequiresNote(action) && !note) {
    return { ok: false, reason: "required" };
  }
  return { ok: true, note: note || null };
}
