import { isOperationalLeadRole } from "@/lib/platform";
import type { AuthenticatedProfile } from "@/lib/types";
import {
  TEAM_TASK_INTAKE_ALLOWED_TASK_TYPES,
  TEAM_TASK_INTAKE_MAX_TASKS,
  type TeamTaskIntakeTaskType,
} from "@/features/intake/model/team-task-intake-contract";

const allowedTaskTypes = new Set<string>(TEAM_TASK_INTAKE_ALLOWED_TASK_TYPES);

export function validateTeamTaskIntakeBatchSize(taskCount: number) {
  if (taskCount <= 0) return "Keine Aufgaben im Payload gefunden.";
  if (taskCount > TEAM_TASK_INTAKE_MAX_TASKS) return `Maximal ${TEAM_TASK_INTAKE_MAX_TASKS} Aufgaben pro Intake.`;
  return "";
}

export function isAllowedTeamTaskIntakeTaskType(value: string): value is TeamTaskIntakeTaskType {
  return allowedTaskTypes.has(value);
}

export function canCreateTeamSubIssueUnderDeliverable({
  actorId,
  actorRole,
  parentOwnerId,
}: {
  actorId: string;
  actorRole: string;
  parentOwnerId: string | null | undefined;
}) {
  return actorRole === "ceo" || actorRole === "deputy" || parentOwnerId === actorId;
}

export function teamTaskIntakeActorCanReadContext(actor: AuthenticatedProfile) {
  return isOperationalLeadRole(actor.platformRole) || actor.platformRole === "founder";
}
