import { isOperationalLeadRole } from "@/lib/platform";
import type { ApprovalStatus, PlatformRole, TrashRootType } from "@/lib/types";

export const PLANNING_TRASH_REASON_MAX_LENGTH = 2000;

export type PlanningTrashAction = "withdraw" | "restore";

export type PlanningTrashWithdrawPayload = {
  expectedRevision?: number;
  reason?: string;
};

export type PlanningTrashRestorePayload = {
  expectedTrashRevision?: number;
};

type PlanningTrashPermissionProfile = {
  id: string;
  platformRole: PlatformRole;
};

type WithdrawablePlanningRoot = {
  rootType: TrashRootType;
  approvalStatus: ApprovalStatus | null;
  proposedById?: string | null;
};

export function isPlanningTrashRootType(value: unknown): value is TrashRootType {
  return value === "initiative" || value === "deliverable";
}

export function validatePlanningTrashRevision(value: unknown) {
  return Number.isInteger(value) && Number(value) >= 1;
}

export function validatePlanningTrashReason(value: unknown):
  | { ok: true; reason: string }
  | { ok: false; reason: "required" | "too_long" } {
  const reason = typeof value === "string" ? value.trim() : "";
  if (reason.length > PLANNING_TRASH_REASON_MAX_LENGTH) return { ok: false, reason: "too_long" };
  if (!reason) return { ok: false, reason: "required" };
  return { ok: true, reason };
}

export function isWithdrawableApprovalStatus(status: ApprovalStatus | null | undefined) {
  return status === "draft" || status === "proposed";
}

export function canWithdrawPlanningRoot(
  root: WithdrawablePlanningRoot,
  profile?: PlanningTrashPermissionProfile | null,
  unrestricted = false,
) {
  if (!isWithdrawableApprovalStatus(root.approvalStatus)) return false;
  if (unrestricted) return true;
  if (!profile) return false;
  return isOperationalLeadRole(profile.platformRole) || Boolean(root.proposedById && root.proposedById === profile.id);
}

export function canRestorePlanningRoot(profile?: PlanningTrashPermissionProfile | null, unrestricted = false) {
  return unrestricted || isOperationalLeadRole(profile?.platformRole);
}
