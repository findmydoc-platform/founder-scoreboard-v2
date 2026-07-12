export const TEAM_TASK_INTAKE_MAX_TASKS = 30;
export const TEAM_TASK_INTAKE_MAX_ACTIVE_TOKENS = 3;
export const TEAM_TASK_INTAKE_TOKEN_HISTORY_LIMIT = 20;
export const TEAM_TASK_INTAKE_TOKEN_TTL_DAYS = 90;

export const TEAM_TASK_INTAKE_ALLOWED_ITEM_TYPES = ["initiative", "deliverable", "sub_issue"] as const;
export const TEAM_TASK_INTAKE_GENERIC_TASK_TYPES = ["deliverable", "sub_issue"] as const;
export const TEAM_TASK_INTAKE_SCOPES = ["read:task-context", "write:task-intake"] as const;
export const TEAM_TASK_INTAKE_FORBIDDEN_WRITES = [
  "approval",
  "score",
  "final-review",
  "review-owner",
  "sprint-configuration",
  "github-sync",
] as const;

export const TEAM_TASK_INTAKE_INPUT_RULES = {
  title: { kind: "string", required: true, minLength: 3, maxLength: 240 },
  description: { kind: "string", maxLength: 4_000 },
  problemStatement: { kind: "string", maxLength: 4_000 },
  intendedOutcome: { kind: "string", maxLength: 4_000 },
  scopeConstraints: { kind: "string", maxLength: 4_000 },
  acceptanceCriteria: { kind: "string-or-string-array", maxLength: 6_000 },
  evidenceRequired: { kind: "string", maxLength: 4_000 },
  definitionOfDone: { kind: "string", maxLength: 4_000 },
  taskType: { kind: "enum", values: TEAM_TASK_INTAKE_GENERIC_TASK_TYPES },
  parentTaskId: { kind: "string", maxLength: 120 },
  packageId: { kind: "string", maxLength: 120 },
  milestoneId: { kind: "string", maxLength: 120 },
  sprintId: { kind: "string", maxLength: 120 },
  assignee: { kind: "string", maxLength: 120 },
  owner: { kind: "string", maxLength: 120 },
  priority: { kind: "enum", values: ["P0", "P1", "P2", "P3", "P4"] },
  status: { kind: "string", maxLength: 40 },
  workstream: { kind: "string", maxLength: 120 },
  startDate: { kind: "date" },
  endDate: { kind: "date" },
  deadline: { kind: "date" },
  hours: { kind: "number", minimum: 0, maximum: 200 },
} as const;

export const TEAM_TASK_INTAKE_INPUT_KEYS = Object.keys(TEAM_TASK_INTAKE_INPUT_RULES) as Array<keyof typeof TEAM_TASK_INTAKE_INPUT_RULES>;

export type TeamTaskIntakeScope = (typeof TEAM_TASK_INTAKE_SCOPES)[number];
export type TeamTaskIntakeItemType = (typeof TEAM_TASK_INTAKE_ALLOWED_ITEM_TYPES)[number];
export type TeamTaskIntakeTaskType = (typeof TEAM_TASK_INTAKE_GENERIC_TASK_TYPES)[number];
export type TeamTaskIntakeInputKey = keyof typeof TEAM_TASK_INTAKE_INPUT_RULES;

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

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string) {
  return uuidPattern.test(value);
}
