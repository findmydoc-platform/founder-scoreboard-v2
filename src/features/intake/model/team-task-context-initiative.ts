import type { ApprovalStatus, Package } from "@/lib/types";

type InitiativeStatus = NonNullable<Package["status"]>;

export const TEAM_TASK_CONTEXT_INITIATIVE_SELECT = "id,title,milestone_id,owner_id,accountable_profile_id,responsible_profile_ids,status,priority,target_date,sort_order,approval_status,goal,scope_constraints,success_criteria";

export type TeamTaskContextInitiativeRow = {
  id: string;
  title: string;
  milestone_id: string | null;
  owner_id: string | null;
  accountable_profile_id: string | null;
  responsible_profile_ids: string[] | null;
  status: InitiativeStatus | null;
  priority: string | null;
  target_date: string | null;
  sort_order: number;
  approval_status: ApprovalStatus | null;
  goal: string | null;
  scope_constraints: string | null;
  success_criteria: string | null;
};

export type TeamTaskContextInitiative = {
  id: string;
  title: string;
  milestoneId: string;
  ownerId: string;
  accountableProfileId: string;
  responsibleProfileIds: string[];
  status: InitiativeStatus;
  priority: string;
  targetDate: string;
  approvalStatus: ApprovalStatus;
  goal: string;
  scopeConstraints: string;
  successCriteria: string;
};

export function mapTeamTaskContextInitiative(
  initiative: TeamTaskContextInitiativeRow,
): TeamTaskContextInitiative {
  return {
    id: initiative.id,
    title: initiative.title,
    milestoneId: initiative.milestone_id || "",
    ownerId: initiative.owner_id || "",
    accountableProfileId: initiative.accountable_profile_id || "",
    responsibleProfileIds: initiative.responsible_profile_ids || [],
    status: initiative.status || "planned",
    priority: initiative.priority || "",
    targetDate: initiative.target_date || "",
    approvalStatus: initiative.approval_status || "approved",
    goal: initiative.goal || "",
    scopeConstraints: initiative.scope_constraints || "",
    successCriteria: initiative.success_criteria || "",
  };
}
