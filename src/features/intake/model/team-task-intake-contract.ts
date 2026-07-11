export const TEAM_TASK_INTAKE_MAX_TASKS = 30;
export const TEAM_TASK_INTAKE_MAX_ACTIVE_TOKENS = 3;
export const TEAM_TASK_INTAKE_TOKEN_HISTORY_LIMIT = 20;
export const TEAM_TASK_INTAKE_TOKEN_TTL_DAYS = 90;

export const TEAM_TASK_INTAKE_ALLOWED_TASK_TYPES = ["proposal", "sub_issue"] as const;
export const TEAM_TASK_INTAKE_SCOPES = ["read:task-context", "write:task-intake"] as const;
export const TEAM_TASK_INTAKE_FORBIDDEN_WRITES = [
  "deliverable",
  "score",
  "final-review",
  "review-owner",
  "sprint-configuration",
  "github-sync",
] as const;

export const TEAM_TASK_INTAKE_INPUT_KEYS = [
  "title",
  "description",
  "problemStatement",
  "intendedOutcome",
  "scopeConstraints",
  "acceptanceCriteria",
  "evidenceRequired",
  "definitionOfDone",
  "taskType",
  "parentTaskId",
  "packageId",
  "milestoneId",
  "sprintId",
  "assignee",
  "owner",
  "priority",
  "status",
  "workstream",
  "startDate",
  "endDate",
  "deadline",
  "hours",
] as const;

export type TeamTaskIntakeScope = (typeof TEAM_TASK_INTAKE_SCOPES)[number];
export type TeamTaskIntakeTaskType = (typeof TEAM_TASK_INTAKE_ALLOWED_TASK_TYPES)[number];

export type TeamTaskIntakeTokenRecord = {
  id: string;
  label: string;
  tokenHint: string;
  scopes: TeamTaskIntakeScope[];
  expiresAt: string;
  createdAt: string;
  lastUsedAt: string;
  revokedAt: string;
};

export type TeamTaskIntakeCreatedTask = {
  id: string;
  title: string;
  status: string;
  priority: string;
  ownerId: string;
  assigneeId: string;
  createdById: string;
  initiativeId: string;
  milestoneId: string;
  sprintId: string;
  taskType: TeamTaskIntakeTaskType;
  parentTaskId: string;
  scoreRelevant: false;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string) {
  return uuidPattern.test(value);
}
