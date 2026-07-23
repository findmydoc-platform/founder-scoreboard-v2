export const TEAM_PLANNING_ITEMS_MAX_BATCH_SIZE = 30;
export const TEAM_PLANNING_ITEMS_MAX_ACTIVE_TOKENS = 3;
export const TEAM_PLANNING_ITEMS_TOKEN_HISTORY_LIMIT = 20;
export const TEAM_PLANNING_ITEMS_TOKEN_TTL_DAYS = 90;
export const FOUNDEROPS_PLANNING_PROJECT_ID = "findmydoc-founder-execution";

export const TEAM_PLANNING_ITEM_TYPES = ["milestone", "initiative", "deliverable", "sub_issue"] as const;
export const TEAM_PLANNING_ITEM_GENERIC_TASK_TYPES = ["deliverable", "sub_issue"] as const;
export const TEAM_PLANNING_MILESTONE_STATUSES = ["planned", "active", "done"] as const;
export const TEAM_PLANNING_TASK_STATUSES = ["Offen", "In Arbeit", "Review", "Nacharbeit", "Blockiert", "Erledigt"] as const;
export const TEAM_PLANNING_ITEM_SCOPES = [
  "read:planning-context",
  "write:planning-items:create",
  "write:planning-items:update",
  "write:planning-items:delete-empty",
] as const;
export const TEAM_PLANNING_ITEMS_FORBIDDEN_WRITES = [
  "approval",
  "score",
  "final-review",
  "review-owner",
  "sprint-configuration",
  "github-sync",
] as const;

export const PLANNING_ITEM_FIELD_RULES = {
  title: { kind: "string", required: true, minLength: 3, maxLength: 240 },
  description: { kind: "string", maxLength: 4_000 },
  problemStatement: { kind: "string", maxLength: 4_000 },
  intendedOutcome: { kind: "string", maxLength: 4_000 },
  scopeConstraints: { kind: "string", maxLength: 4_000 },
  acceptanceCriteria: { kind: "string-or-string-array", maxLength: 6_000 },
  evidenceRequired: { kind: "string", maxLength: 4_000 },
  definitionOfDone: { kind: "string", maxLength: 4_000 },
  taskType: { kind: "enum", values: TEAM_PLANNING_ITEM_GENERIC_TASK_TYPES },
  parentTaskId: { kind: "string", maxLength: 120 },
  packageId: { kind: "string", maxLength: 120 },
  milestoneId: { kind: "string", maxLength: 120 },
  sprintId: { kind: "string", maxLength: 120 },
  assignee: { kind: "string", maxLength: 120 },
  owner: { kind: "string", maxLength: 120 },
  ownerId: { kind: "string", maxLength: 120 },
  accountableProfileId: { kind: "string", maxLength: 120 },
  responsibleProfileIds: { kind: "string-array", maxLength: 120 },
  consultedProfileIds: { kind: "string-array", maxLength: 120 },
  informedProfileIds: { kind: "string-array", maxLength: 120 },
  priority: { kind: "enum", values: ["P0", "P1", "P2", "P3", "P4"] },
  status: { kind: "enum", values: TEAM_PLANNING_MILESTONE_STATUSES },
  targetDate: { kind: "date" },
  workstream: { kind: "string", maxLength: 120 },
  startDate: { kind: "date" },
  endDate: { kind: "date" },
  deadline: { kind: "date" },
  hours: { kind: "number", minimum: 0, maximum: 200 },
  githubRepo: { kind: "string", maxLength: 120 },
} as const;

export const TEAM_PLANNING_ITEM_CREATE_FIELDS = [
  "itemType",
  "title",
  "description",
  "problemStatement",
  "intendedOutcome",
  "scopeConstraints",
  "acceptanceCriteria",
  "evidenceRequired",
  "definitionOfDone",
  "parentTaskId",
  "packageId",
  "milestoneId",
  "ownerId",
  "accountableProfileId",
  "responsibleProfileIds",
  "consultedProfileIds",
  "informedProfileIds",
  "priority",
  "workstream",
  "startDate",
  "endDate",
  "deadline",
  "hours",
  "githubRepo",
  "targetDate",
  "status",
] as const;

export const TEAM_PLANNING_ITEM_PATCH_FIELDS = TEAM_PLANNING_ITEM_CREATE_FIELDS.filter(
  (field) => field !== "itemType",
) as Exclude<(typeof TEAM_PLANNING_ITEM_CREATE_FIELDS)[number], "itemType">[];

export type TeamPlanningItemScope = (typeof TEAM_PLANNING_ITEM_SCOPES)[number];
export type TeamPlanningItemType = (typeof TEAM_PLANNING_ITEM_TYPES)[number];
export type TeamPlanningItemGenericTaskType = (typeof TEAM_PLANNING_ITEM_GENERIC_TASK_TYPES)[number];
export type PlanningItemFieldKey = keyof typeof PLANNING_ITEM_FIELD_RULES;
export type TeamPlanningItemPatchField = (typeof TEAM_PLANNING_ITEM_PATCH_FIELDS)[number];

export type TeamPlanningItemTokenRecord = {
  id: string;
  label: string;
  tokenHint: string;
  scopes: TeamPlanningItemScope[];
  expiresAt: string;
  createdAt: string;
  lastUsedAt: string;
  revokedAt: string;
};

const uuidPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isUuid(value: string) {
  return uuidPattern.test(value);
}
