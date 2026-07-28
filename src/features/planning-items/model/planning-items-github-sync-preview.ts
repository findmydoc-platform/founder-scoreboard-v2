import {
  type PlanningItemGitHubSyncResult,
  type TeamPlanningItemType,
} from "@/features/planning-items/model/planning-items-contract";

export function previewPlanningItemGitHubSync({
  itemType,
  approvalStatus,
  parentApprovalStatus,
}: {
  itemType: TeamPlanningItemType;
  approvalStatus?: unknown;
  parentApprovalStatus?: unknown;
}): PlanningItemGitHubSyncResult {
  if (itemType === "milestone" || itemType === "initiative") {
    return {
      status: "notEligible",
      code: "github_sync_invalid_target",
      error: itemType === "milestone"
        ? "Meilensteine können nicht mit GitHub synchronisiert werden."
        : "Initiativen können nicht mit GitHub synchronisiert werden.",
      retryable: false,
    };
  }
  if (itemType === "deliverable" && approvalStatus !== "approved") {
    return {
      status: "notEligible",
      code: "github_sync_not_approved",
      error: "Nur freigegebene Deliverables können mit GitHub synchronisiert werden.",
      retryable: false,
    };
  }
  if (itemType === "sub_issue" && parentApprovalStatus !== undefined
      && parentApprovalStatus !== "approved") {
    return {
      status: "notEligible",
      code: "github_sync_not_approved",
      error: "Das Parent-Deliverable muss vor dem GitHub-Sync freigegeben sein.",
      retryable: false,
    };
  }
  return { status: "accepted" };
}
