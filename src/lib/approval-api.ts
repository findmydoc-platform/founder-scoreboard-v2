import { apiError } from "@/lib/api-response";
import { validateApprovalDecisionNote } from "@/lib/approval-decision-policy";
import type { ApprovalDecisionAction } from "@/lib/types";

export type ApprovalDecisionPayload = {
  action?: ApprovalDecisionAction;
  expectedRevision?: number;
  note?: string;
};

const approvalActions = new Set<ApprovalDecisionAction>(["approve", "reject", "return_to_draft"]);

export function validateApprovalDecision(payload: ApprovalDecisionPayload) {
  if (!payload.action || !approvalActions.has(payload.action)) {
    return { ok: false as const, response: apiError("Ungültige Freigabeaktion.", 400) };
  }
  if (!Number.isInteger(payload.expectedRevision) || Number(payload.expectedRevision) < 1) {
    return { ok: false as const, response: apiError("Aktueller Freigabestand ist erforderlich.", 400) };
  }
  const note = validateApprovalDecisionNote(payload.action, payload.note);
  if (!note.ok) {
    return {
      ok: false as const,
      response: apiError(
        note.reason === "too_long"
          ? "Die Begründung darf höchstens 2.000 Zeichen lang sein."
          : "Für Ablehnung und Rückgabe ist eine Begründung erforderlich.",
        400,
      ),
    };
  }
  return {
    ok: true as const,
    action: payload.action,
    expectedRevision: Number(payload.expectedRevision),
    note: note.note,
  };
}

export function approvalTransactionError(error: { code?: string; message?: string }, entityLabel: string) {
  if (error.code === "P0001") return apiError(`${entityLabel} wurde zwischenzeitlich entschieden. Bitte neu laden.`, 409);
  if (error.code === "P0002") return apiError(`${entityLabel} wurde nicht gefunden.`, 404);
  if (error.code === "P0003") return apiError(error.message || `${entityLabel} kann in diesem Zustand nicht entschieden werden.`, 409);
  if (error.code === "P0006") return apiError(error.message || "Keine Berechtigung für diese Freigabeentscheidung.", 403);
  if (error.code === "22023") return apiError(error.message || "Freigabeentscheidung ist ungültig.", 400);
  return apiError(error.message || "Freigabeentscheidung konnte nicht gespeichert werden.", 500);
}
