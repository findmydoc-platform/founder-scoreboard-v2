"use client";

import type { Dispatch, SetStateAction } from "react";
import type { InitiativeDraft } from "../model/hierarchy-state";
import type { PlanningCommandContext } from "@/features/planning/hooks/planning-command-context";
import { canWithdrawPlanningRoot } from "@/features/planning/model/planning-trash-contract";
import type { ApprovalDecisionAction, Task } from "@/lib/types";

export function useInitiativeCommands({ planningState, currentProfile, setSaveError, setInitiativeDialogDefaults }: Pick<PlanningCommandContext, "planningState" | "currentProfile" | "setSaveError"> & { setInitiativeDialogDefaults: Dispatch<SetStateAction<Partial<InitiativeDraft> | null>> }) {
  const editInitiative = async (shown: Task) => {
    setSaveError("");
    let detail = shown;
    if (shown.detailAvailability === "summary") {
      const loaded = await planningState.loadTaskDetail(shown.id);
      const current = planningState.taskDetail(shown.id).task;
      if (!loaded.ok || !current || current.detailAvailability === "summary") {
        setSaveError("Initiative konnte nicht vollständig zum Bearbeiten geladen werden."); return;
      }
      detail = current;
    }
    setInitiativeDialogDefaults({
      id: shown.id, expectedUpdatedAt: shown.updatedAt, title: shown.title, parentTaskId: shown.parentTaskId || "", ownerId: shown.ownerId || "",
      accountableProfileId: detail.raciAssignments?.find(assignment => assignment.role === "accountable")?.profileId || detail.ownerId || "",
      responsibleProfileIds: detail.raciAssignments?.filter(assignment => assignment.role === "responsible").map(assignment => assignment.profileId) || [],
      consultedProfileIds: detail.raciAssignments?.filter(assignment => assignment.role === "consulted").map(assignment => assignment.profileId) || [],
      informedProfileIds: detail.raciAssignments?.filter(assignment => assignment.role === "informed").map(assignment => assignment.profileId) || [],
      priority: shown.priority, status: shown.status === "In Arbeit" ? "active" : shown.status === "Erledigt" ? "done" : shown.status === "Pausiert" ? "paused" : "planned", targetDate: shown.targetDate || "",
      goal: detail.strategy?.goal || detail.description, successCriteria: detail.strategy?.successCriteria || "", scopeConstraints: detail.strategy?.scopeConstraints || "",
      approvalStatus: shown.approvalStatus || "proposed", approvalRevision: shown.approvalRevision, decisionNote: shown.decisionNote,
    });
  };
  const decideInitiativeApproval = async (initiative: Task, action: ApprovalDecisionAction, note = "") => {
    setSaveError("");
    const result = await planningState.decideInitiativeApproval(initiative, action, note);
    if (!result.ok) setSaveError(result.error);
  };
  const withdrawInitiative = async (initiative: Task, reason: string) => {
    if (!canWithdrawPlanningRoot({ rootType: "initiative", approvalStatus: initiative.approvalStatus, proposedById: initiative.proposedById }, currentProfile, false)) {
      setSaveError("Nur Antragsteller, CEO oder Deputy können vorgeschlagene Initiativen zurückziehen."); return;
    }
    setSaveError("");
    const result = await planningState.withdrawTask(initiative, reason);
    if (!result.ok) setSaveError(result.error);
  };
  return { editInitiative, decideInitiativeApproval, withdrawInitiative };
}
