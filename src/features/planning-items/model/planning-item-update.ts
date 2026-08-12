import { createHash } from "node:crypto";
import type { AuthenticatedProfile, Task } from "@/lib/types";
import { ACTIVE_TASKS_TABLE } from "@/lib/planning-read-model";
import type { getServerSupabase } from "@/lib/supabase";
import { resolveTaskGitHubRepository } from "@/lib/github-repositories";
import { isOperationalLeadRole } from "@/lib/platform";
import { taskDetailPermissions } from "@/features/tasks/model/task-detail-permissions";
import {
  applyFinalStatusReopen,
  startsTaskReviewRequest,
  validateSubIssueStatusParentApproval,
  validateTaskStatusUpdate,
  type TaskRouteDbUpdate,
} from "@/features/tasks/model/task-route-update-helpers";
import { isReviewStateLocked, reviewStateLockMessage } from "@/features/reviews/model/task-review-state";
import { isSubIssueStatus, normalizeSubIssueStatus } from "@/lib/status";
import {
  FOUNDEROPS_PLANNING_PROJECT_ID,
  TEAM_PLANNING_ITEM_PATCH_FIELDS,
  TEAM_PLANNING_ITEM_REPLAY_ALIAS_FIELDS,
  TEAM_PLANNING_STRATEGIC_STATUSES,
  isStrategicPlanningItemType,
  parsePlanningItemGitHubSyncCommand,
  parsePlanningItemGitHubSyncMode,
  type PlanningItemGitHubSyncCommand,
  type PlanningItemGitHubSyncResult,
  type TeamPlanningItemPatchField,
  type TeamPlanningItemGitHubSyncMode,
  type TeamPlanningItemType,
} from "@/features/planning-items/model/planning-items-contract";
import {
  normalizePatchAcceptanceCriteria,
  normalizePatchDate,
  normalizePatchHours,
  normalizePatchId,
  normalizePatchPriority,
  normalizePatchStringList,
  normalizePatchTaskStatus,
  normalizePatchText,
} from "@/features/planning-items/model/planning-item-normalization";
import type { ActorContext } from "./actor-context";
import type { PlanningError, PlanningItems, PlanningItemChanges, PlanningResult, ReviseItem } from "./planning-items";

type SupabaseServer = NonNullable<ReturnType<typeof getServerSupabase>>;
type UnknownRecord = Record<string, unknown>;
type DatabaseRow = Record<string, unknown>;
export type PlanningItemReplayType = TeamPlanningItemType | "milestone";

type StrategyRow = {
  task_id: string;
  goal: string | null;
  success_criteria: string | null;
  scope_constraints: string | null;
};

type RaciRow = {
  task_id: string;
  profile_id: string;
  role: "accountable" | "responsible" | "consulted" | "informed";
  sort_order: number;
};

type TargetLoadResult =
  | { ok: true; itemType: TeamPlanningItemType; row: DatabaseRow; strategy?: StrategyRow; raciAssignments: RaciRow[] }
  | { ok: false; status: 404; error: string };

export type PlanningItemSystemEffect = {
  field: string;
  before: unknown;
  after: unknown;
  reason: string;
};

export type PlanningItemUpdatePreview = {
  itemId: string;
  itemType: TeamPlanningItemType;
  expectedUpdatedAt: string;
  currentItem: UnknownRecord;
  normalizedPatch: UnknownRecord;
  resultingItem: UnknownRecord;
  changedFields: string[];
  systemEffects: PlanningItemSystemEffect[];
  warnings: string[];
  errors: string[];
  dbPatch: UnknownRecord;
  githubSyncParentApprovalStatus?: unknown;
};

const patchFields = new Set<string>(TEAM_PLANNING_ITEM_PATCH_FIELDS);
const strategicStatuses = new Set<string>(TEAM_PLANNING_STRATEGIC_STATUSES);
const fieldsByType: Record<TeamPlanningItemType, Set<TeamPlanningItemPatchField>> = {
  epic: new Set(["title", "description", "ownerId", "targetDate", "status"]),
  initiative: new Set([
    "title", "description", "intendedOutcome", "scopeConstraints", "acceptanceCriteria", "parentTaskId",
    "ownerId", "accountableProfileId", "responsibleProfileIds", "consultedProfileIds", "informedProfileIds", "priority", "targetDate", "status",
  ]),
  deliverable: new Set([
    "title", "description", "problemStatement", "intendedOutcome", "scopeConstraints", "acceptanceCriteria",
    "evidenceRequired", "definitionOfDone", "parentTaskId", "ownerId", "priority", "workstream", "startDate",
    "endDate", "deadline", "hours", "status",
  ]),
  sub_issue: new Set([
    "title", "description", "problemStatement", "intendedOutcome", "scopeConstraints", "acceptanceCriteria",
    "evidenceRequired", "definitionOfDone", "parentTaskId", "ownerId", "githubRepo", "status",
  ]),
};
const founderInitiativeFields = new Set<TeamPlanningItemPatchField>([
  "title", "description", "intendedOutcome", "scopeConstraints", "acceptanceCriteria", "priority", "responsibleProfileIds",
  "consultedProfileIds", "informedProfileIds", "status",
]);
const founderTaskBriefFields = new Set<TeamPlanningItemPatchField>([
  "title", "description", "problemStatement", "intendedOutcome", "scopeConstraints", "acceptanceCriteria",
  "evidenceRequired", "definitionOfDone",
]);
function hasOwn(value: UnknownRecord, key: string) {
  return Object.hasOwn(value, key);
}

function sameValue(before: unknown, after: unknown) {
  return JSON.stringify(before) === JSON.stringify(after);
}

function taskTypeFromRow(row: DatabaseRow): TeamPlanningItemType {
  const value = String(row.task_type || "");
  return value === "epic" || value === "initiative" || value === "sub_issue" ? value : "deliverable";
}

function publicEpic(row: DatabaseRow): UnknownRecord {
  return {
    id: String(row.id || ""),
    itemType: "epic",
    title: String(row.title || ""),
    description: String(row.description || ""),
    targetDate: String(row.target_date || ""),
    status: String(row.status || "Offen"),
    ownerId: String(row.owner || ""),
    sortOrder: Number(row.sort_order || 0),
    approvalStatus: null,
    updatedAt: String(row.updated_at || ""),
  };
}

function publicInitiative(row: DatabaseRow, strategy?: StrategyRow, raciAssignments: RaciRow[] = []): UnknownRecord {
  // The Team API transaction returns the normalized Initiative data inline so
  // an idempotent replay does not need a second read. Context reads still pass
  // the typed rows separately. Keep both response shapes equivalent here.
  const inlineStrategy = strategy || (
    typeof row.goal === "string"
      || typeof row.success_criteria === "string"
      || typeof row.scope_constraints === "string"
      ? {
          task_id: String(row.id || ""),
          goal: typeof row.goal === "string" ? row.goal : null,
          success_criteria: typeof row.success_criteria === "string" ? row.success_criteria : null,
          scope_constraints: typeof row.scope_constraints === "string" ? row.scope_constraints : null,
        }
      : undefined
  );
  const inlineRaciAssignments = raciAssignments.length ? raciAssignments : Array.isArray(row.raci_assignments)
    ? row.raci_assignments.flatMap((assignment) => {
        if (!assignment || typeof assignment !== "object" || Array.isArray(assignment)) return [];
        const candidate = assignment as Record<string, unknown>;
        const profileId = typeof candidate.profile_id === "string"
          ? candidate.profile_id
          : typeof candidate.profileId === "string"
            ? candidate.profileId
            : "";
        const role = candidate.role;
        if (!profileId || !["accountable", "responsible", "consulted", "informed"].includes(String(role))) return [];
        return [{
          task_id: String(row.id || ""),
          profile_id: profileId,
          role: role as RaciRow["role"],
          sort_order: Number.isInteger(candidate.sort_order)
            ? Number(candidate.sort_order)
            : Number.isInteger(candidate.sortOrder)
              ? Number(candidate.sortOrder)
              : 0,
        }];
      })
    : [];
  const byRole = (role: RaciRow["role"]) => inlineRaciAssignments
    .filter((assignment) => assignment.role === role)
    .sort((left, right) => left.sort_order - right.sort_order || left.profile_id.localeCompare(right.profile_id));
  return {
    id: String(row.id || ""),
    itemType: "initiative",
    title: String(row.title || ""),
    description: String(row.description || ""),
    intendedOutcome: String(inlineStrategy?.goal || row.description || ""),
    scopeConstraints: String(inlineStrategy?.scope_constraints || ""),
    acceptanceCriteria: String(inlineStrategy?.success_criteria || ""),
    parentTaskId: String(row.parent_task_id || ""),
    ownerId: String(row.owner || ""),
    accountableProfileId: byRole("accountable")[0]?.profile_id || "",
    responsibleProfileIds: byRole("responsible").map((assignment) => assignment.profile_id),
    consultedProfileIds: byRole("consulted").map((assignment) => assignment.profile_id),
    informedProfileIds: byRole("informed").map((assignment) => assignment.profile_id),
    priority: String(row.priority || "P2"),
    targetDate: String(row.target_date || ""),
    status: String(row.status || "Offen"),
    approvalStatus: row.approval_status || "proposed",
    approvalRevision: Number(row.approval_revision || 1),
    updatedAt: String(row.updated_at || ""),
  };
}

function publicTask(row: DatabaseRow): UnknownRecord {
  const itemType = taskTypeFromRow(row);
  const isSubIssue = itemType === "sub_issue";
  const description = isSubIssue && !String(row.description || "").trim()
    ? String(row.problem_statement || "")
    : String(row.description || "");
  return {
    id: String(row.id || ""),
    itemType,
    title: String(row.title || ""),
    description,
    problemStatement: String(row.problem_statement || ""),
    intendedOutcome: String(row.intended_outcome || ""),
    scopeConstraints: String(row.scope_constraints || ""),
    acceptanceCriteria: String(row.acceptance_criteria || ""),
    evidenceRequired: String(row.evidence_required || ""),
    definitionOfDone: String(row.definition_of_done || ""),
    parentTaskId: String(row.parent_task_id || ""),
    ownerId: String(row.owner || row.assignee || ""),
    priority: isSubIssue ? "" : String(row.priority || "P2"),
    workstream: isSubIssue ? "" : String(row.workstream || ""),
    startDate: isSubIssue ? "" : String(row.start_date || ""),
    endDate: isSubIssue ? "" : String(row.end_date || ""),
    deadline: isSubIssue ? "" : String(row.deadline || ""),
    hours: isSubIssue ? 0 : Number(row.estimate_hours || 0),
    status: isSubIssue ? normalizeSubIssueStatus(String(row.status || "Offen")) : String(row.status || "Offen"),
    githubRepo: String(row.github_repo || ""),
    approvalStatus: itemType === "deliverable" ? row.approval_status || "proposed" : null,
    approvalRevision: Number(row.approval_revision || 1),
    sprintId: itemType === "deliverable" ? String(row.sprint_id || "") : "",
    reviewStatus: itemType === "deliverable" ? String(row.review_status || "not_requested") : "not_requested",
    reviewOwnerProfileId: itemType === "deliverable" ? String(row.review_owner_profile_id || "") : "",
    reviewRequestedAt: itemType === "deliverable" ? String(row.review_requested_at || "") : "",
    scorePoints: itemType === "deliverable" ? Number(row.score_points || 0) : 0,
    scoreFinal: itemType === "deliverable" && Boolean(row.score_final),
    scoreRelevant: itemType === "deliverable" && Boolean(row.score_relevant),
    githubIssueSyncStatus: String(row.github_issue_sync_status || "not_synced"),
    updatedAt: String(row.updated_at || ""),
  };
}

function publicLegacyMilestone(row: DatabaseRow): UnknownRecord {
  return {
    id: String(row.id || ""),
    itemType: "milestone",
    title: String(row.title || ""),
    description: String(row.description || ""),
    targetDate: String(row.target_date || ""),
    status: String(row.status || "planned"),
    sortOrder: Number(row.sort_order || 0),
    updatedAt: String(row.updated_at || ""),
    approvalStatus: null,
  };
}

function publicLegacyInitiative(row: DatabaseRow): UnknownRecord {
  return {
    id: String(row.id || ""),
    itemType: "initiative",
    title: String(row.title || ""),
    intendedOutcome: String(row.goal || ""),
    scopeConstraints: String(row.scope_constraints || ""),
    acceptanceCriteria: String(row.success_criteria || ""),
    milestoneId: String(row.milestone_id || ""),
    ownerId: String(row.owner_id || ""),
    accountableProfileId: String(row.accountable_profile_id || ""),
    responsibleProfileIds: Array.isArray(row.responsible_profile_ids) ? row.responsible_profile_ids : [],
    consultedProfileIds: Array.isArray(row.consulted_profile_ids) ? row.consulted_profile_ids : [],
    informedProfileIds: Array.isArray(row.informed_profile_ids) ? row.informed_profile_ids : [],
    priority: String(row.priority || "P2"),
    approvalStatus: row.approval_status || "proposed",
    approvalRevision: Number(row.approval_revision || 1),
    updatedAt: String(row.updated_at || ""),
  };
}

function publicLegacyTask(row: DatabaseRow): UnknownRecord {
  const isSubIssue = row.task_type === "sub_issue";
  const description = isSubIssue && !String(row.description || "").trim()
    ? String(row.problem_statement || "")
    : String(row.description || "");
  return {
    id: String(row.id || ""),
    itemType: isSubIssue ? "sub_issue" : "deliverable",
    title: String(row.title || ""),
    description,
    problemStatement: String(row.problem_statement || ""),
    intendedOutcome: String(row.intended_outcome || ""),
    scopeConstraints: String(row.scope_constraints || ""),
    acceptanceCriteria: String(row.acceptance_criteria || ""),
    evidenceRequired: String(row.evidence_required || ""),
    definitionOfDone: String(row.definition_of_done || ""),
    parentTaskId: String(row.parent_task_id || ""),
    packageId: String(row.package_id || ""),
    milestoneId: String(row.milestone_id || ""),
    ownerId: String(row.owner || row.assignee || ""),
    priority: String(row.priority || "P2"),
    workstream: String(row.workstream || ""),
    startDate: String(row.start_date || ""),
    endDate: String(row.end_date || ""),
    deadline: String(row.deadline || ""),
    hours: Number(row.estimate_hours || 0),
    status: isSubIssue ? normalizeSubIssueStatus(String(row.status || "Offen")) : String(row.status || "Offen"),
    githubRepo: String(row.github_repo || ""),
    approvalStatus: row.approval_status || null,
    approvalRevision: Number(row.approval_revision || 1),
    sprintId: String(row.sprint_id || ""),
    reviewStatus: isSubIssue ? "not_requested" : String(row.review_status || "not_requested"),
    reviewOwnerProfileId: isSubIssue ? "" : String(row.review_owner_profile_id || ""),
    reviewRequestedAt: isSubIssue ? "" : String(row.review_requested_at || ""),
    scorePoints: isSubIssue ? 0 : Number(row.score_points || 0),
    scoreFinal: !isSubIssue && Boolean(row.score_final),
    scoreRelevant: !isSubIssue && Boolean(row.score_relevant),
    githubIssueSyncStatus: String(row.github_issue_sync_status || "not_synced"),
    updatedAt: String(row.updated_at || ""),
  };
}

export function mapPlanningItemDatabaseRow(itemType: TeamPlanningItemType, row: DatabaseRow, strategy?: StrategyRow, raciAssignments: RaciRow[] = []) {
  if (itemType === "epic") return publicEpic(row);
  if (itemType === "initiative") return publicInitiative(row, strategy, raciAssignments);
  return publicTask(row);
}

export function mapLegacyPlanningItemDatabaseRow(itemType: PlanningItemReplayType, row: DatabaseRow) {
  if (itemType === "milestone") return publicLegacyMilestone(row);
  if (itemType === "initiative") return publicLegacyInitiative(row);
  return publicLegacyTask(row);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function planningItemUpdateHash({ itemId, itemType, expectedUpdatedAt, patch }: {
  itemId: string;
  itemType: PlanningItemReplayType;
  expectedUpdatedAt: string;
  patch: UnknownRecord;
}) {
  return createHash("sha256").update(stableJson({ itemId, itemType, expectedUpdatedAt, patch }), "utf8").digest("hex");
}

export function parsePlanningItemPatchPayload(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false as const, error: "PATCH-Payload muss ein Objekt sein." };
  }
  const raw = payload as UnknownRecord;
  const unknownKey = Object.keys(raw).find((key) => (
    key !== "expectedUpdatedAt"
    && key !== "itemType"
    && key !== "githubSync"
    && key !== "githubSyncMode"
    && !patchFields.has(key)
    && !TEAM_PLANNING_ITEM_REPLAY_ALIAS_FIELDS.includes(key as (typeof TEAM_PLANNING_ITEM_REPLAY_ALIAS_FIELDS)[number])
  ));
  if (unknownKey) return { ok: false as const, error: `PATCH-Payload enthält das unbekannte Feld ${unknownKey}.` };
  if (hasOwn(raw, "itemType")) return { ok: false as const, error: "itemType ist unveränderlich und darf nicht gepatcht werden." };
  if (typeof raw.expectedUpdatedAt !== "string" || Number.isNaN(Date.parse(raw.expectedUpdatedAt))) {
    return { ok: false as const, error: "expectedUpdatedAt muss ein gültiger Zeitstempel sein." };
  }
  const hasGitHubSync = hasOwn(raw, "githubSync");
  let githubSync: PlanningItemGitHubSyncCommand | null = null;
  if (hasGitHubSync) {
    const sync = parsePlanningItemGitHubSyncCommand(raw.githubSync);
    if (!sync.ok) return { ok: false as const, error: sync.error };
    githubSync = sync.command;
  }
  const hasMode = hasOwn(raw, "githubSyncMode");
  const githubSyncMode = parsePlanningItemGitHubSyncMode(raw.githubSyncMode);
  if (hasGitHubSync && !githubSyncMode) return { ok: false as const, error: "githubSyncMode muss bei GitHub-Sync async oder wait sein." };
  if (!hasGitHubSync && hasMode) return { ok: false as const, error: "githubSyncMode ist nur zusammen mit githubSync zulässig." };
  const presentFields = Object.keys(raw).filter((key): key is TeamPlanningItemPatchField => patchFields.has(key));
  const hasLegacyAliases = TEAM_PLANNING_ITEM_REPLAY_ALIAS_FIELDS.some((field) => hasOwn(raw, field));
  if (!presentFields.length && !githubSync && !hasLegacyAliases) return { ok: false as const, error: "PATCH braucht mindestens ein änderbares Feld oder githubSync." };
  return { ok: true as const, expectedUpdatedAt: raw.expectedUpdatedAt, presentFields, raw, githubSync, githubSyncMode: githubSyncMode as TeamPlanningItemGitHubSyncMode | null, hasLegacyAliases };
}

async function loadTarget(supabase: SupabaseServer, itemId: string): Promise<TargetLoadResult> {
  const canonicalId = itemId;
  const taskResult = await supabase
    .from(ACTIVE_TASKS_TABLE)
    .select("id,title,description,problem_statement,intended_outcome,scope_constraints,acceptance_criteria,evidence_required,definition_of_done,task_type,parent_task_id,owner,assignee,priority,status,workstream,start_date,end_date,deadline,estimate_hours,github_repo,github_issue_number,github_issue_url,github_issue_sync_status,approval_status,approval_revision,sprint_id,review_status,review_owner_profile_id,review_requested_at,score_points,score_final,score_relevant,target_date,sort_order,updated_at")
    .eq("project_id", FOUNDEROPS_PLANNING_PROJECT_ID)
    .eq("id", canonicalId)
    .maybeSingle();
  if (taskResult.error) throw new Error(taskResult.error.message);
  if (!taskResult.data) return { ok: false, status: 404, error: "Planungselement wurde nicht gefunden oder ist im Papierkorb." };
  const itemType = taskTypeFromRow(taskResult.data as DatabaseRow);
  if (itemType !== "initiative") return { ok: true, itemType, row: taskResult.data as DatabaseRow, raciAssignments: [] };
  const [strategyResult, raciResult] = await Promise.all([
    supabase.from("planning_item_strategy").select("task_id,goal,success_criteria,scope_constraints").eq("task_id", canonicalId).maybeSingle<StrategyRow>(),
    supabase.from("planning_item_raci_assignments").select("task_id,profile_id,role,sort_order").eq("task_id", canonicalId).order("sort_order").returns<RaciRow[]>(),
  ]);
  if (strategyResult.error || raciResult.error) throw new Error(strategyResult.error?.message || raciResult.error?.message || "Initiative konnte nicht geladen werden.");
  return { ok: true, itemType, row: taskResult.data as DatabaseRow, strategy: strategyResult.data || undefined, raciAssignments: raciResult.data || [] };
}

function appendSystemEffect(effects: PlanningItemSystemEffect[], field: string, before: unknown, after: unknown, reason: string) {
  if (!sameValue(before, after)) effects.push({ field, before, after, reason });
}

function validatePermission(actor: AuthenticatedProfile, itemType: TeamPlanningItemType, target: DatabaseRow, presentFields: TeamPlanningItemPatchField[]) {
  const errors: string[] = [];
  if (["ceo", "deputy"].includes(actor.platformRole)) return errors;
  if (itemType === "epic") return ["Nur CEO oder Deputy können Epics bearbeiten."];
  if (actor.platformRole !== "founder") return ["Nur CEO, Deputy oder Founder dürfen Planungselemente bearbeiten."];
  if (itemType === "initiative") {
    if (String(target.owner || "") !== actor.id) return ["Founder können nur eigene Initiativen bearbeiten."];
    const restricted = presentFields.filter((field) => !founderInitiativeFields.has(field));
    if (restricted.length) errors.push(`Diese Initiative-Felder sind geschützt: ${restricted.join(", ")}.`);
    return errors;
  }
  const permissions = taskDetailPermissions({
    task: {
      assignee: String(target.assignee || ""), assigneeId: String(target.assignee || ""),
      owner: String(target.owner || ""), ownerId: String(target.owner || ""),
      reviewOwnerProfileId: String(target.review_owner_profile_id || ""),
      reviewStatus: String(target.review_status || "not_requested") as Task["reviewStatus"],
      scoreFinal: Boolean(target.score_final), taskType: itemType,
    },
    profile: actor,
  });
  const briefFields = presentFields.filter((field) => founderTaskBriefFields.has(field));
  if (briefFields.length && !permissions.canEditBrief) errors.push("Founder können den Aufgabenbrief nur bei eigenen oder zugewiesenen Aufgaben bearbeiten.");
  const protectedFields = presentFields.filter((field) => !founderTaskBriefFields.has(field) && field !== "parentTaskId" && field !== "status");
  if (protectedFields.length) errors.push(`Diese Aufgabenfelder sind geschützt: ${protectedFields.join(", ")}.`);
  if (presentFields.includes("parentTaskId") && !permissions.canReparentSubIssue) errors.push("Dieses Sub-Issue darf nur von CEO, Deputy oder der aktuellen Zuständigkeit verschoben werden.");
  return errors;
}

function normalizePatch(raw: UnknownRecord, presentFields: TeamPlanningItemPatchField[], itemType: TeamPlanningItemType) {
  const normalized: UnknownRecord = {};
  const errors: string[] = [];
  for (const field of presentFields) {
    if (!fieldsByType[itemType].has(field)) {
      errors.push(`${field} ist für ${itemType} nicht zulässig.`);
      continue;
    }
    const value = raw[field];
    let result: { ok: true; value: unknown } | { ok: false; error: string };
    switch (field) {
      case "title": result = normalizePatchText(value, 240, true); break;
      case "description":
      case "problemStatement":
      case "intendedOutcome":
      case "scopeConstraints":
      case "evidenceRequired":
      case "definitionOfDone": result = normalizePatchText(value, 4_000); break;
      case "acceptanceCriteria": result = normalizePatchAcceptanceCriteria(value); break;
      case "priority": result = normalizePatchPriority(value); break;
      case "status": {
        if (isStrategicPlanningItemType(itemType)) {
          const status = typeof value === "string" ? value.trim() : "";
          result = strategicStatuses.has(status) ? { ok: true, value: status } : { ok: false, error: "muss Offen, In Arbeit, Pausiert, Blockiert oder Erledigt sein" };
        } else result = normalizePatchTaskStatus(value);
        break;
      }
      case "workstream":
      case "deadline": result = normalizePatchText(value, 120); break;
      case "startDate":
      case "endDate":
      case "targetDate": result = normalizePatchDate(value); break;
      case "hours": result = normalizePatchHours(value); break;
      case "responsibleProfileIds": result = normalizePatchStringList(value); break;
      case "consultedProfileIds":
      case "informedProfileIds": result = normalizePatchStringList(value); break;
      case "accountableProfileId":
      case "parentTaskId":
      case "ownerId": result = normalizePatchId(value); break;
      case "githubRepo": result = normalizePatchText(value, 120, true); break;
      default: result = { ok: false, error: "wird nicht unterstützt" };
    }
    if (!result.ok) errors.push(`${field} ${result.error}.`);
    else if (field === "status" && itemType === "sub_issue" && !isSubIssueStatus(String(result.value))) errors.push("status muss Offen, In Arbeit, Blockiert oder Erledigt sein.");
    else normalized[field] = result.value;
  }
  return { normalized, errors };
}

function buildRaciAssignments(item: UnknownRecord) {
  const assignments: Array<{ profileId: string; role: string; sortOrder: number }> = [];
  const accountable = String(item.accountableProfileId || "");
  if (accountable) assignments.push({ profileId: accountable, role: "accountable", sortOrder: 0 });
  for (const [role, key] of [["responsible", "responsibleProfileIds"], ["consulted", "consultedProfileIds"], ["informed", "informedProfileIds"]] as const) {
    const profiles = Array.isArray(item[key]) ? item[key] as unknown[] : [];
    profiles.forEach((profileId, sortOrder) => assignments.push({ profileId: String(profileId), role, sortOrder }));
  }
  return assignments;
}

function buildDbPatch(itemType: TeamPlanningItemType, changedFields: string[], resultingItem: UnknownRecord) {
  const dbPatch: UnknownRecord = {};
  const changed = new Set(changedFields);
  const maps: Array<[string, string]> = [
    ["title", "title"], ["description", "description"], ["status", "status"], ["targetDate", "target_date"],
    ["priority", "priority"], ["parentTaskId", "parent_task_id"], ["workstream", "workstream"],
    ["startDate", "start_date"], ["endDate", "end_date"], ["deadline", "deadline"], ["hours", "estimate_hours"],
    ["problemStatement", "problem_statement"], ["intendedOutcome", "intended_outcome"], ["scopeConstraints", "scope_constraints"],
    ["acceptanceCriteria", "acceptance_criteria"], ["evidenceRequired", "evidence_required"], ["definitionOfDone", "definition_of_done"],
    ["githubRepo", "github_repo"],
  ];
  for (const [field, column] of maps) if (changed.has(field)) dbPatch[column] = resultingItem[field];
  if (changed.has("ownerId")) {
    dbPatch.owner = resultingItem.ownerId;
    dbPatch.assignee = resultingItem.ownerId;
  }
  if (itemType === "initiative" && changedFields.some((field) => ["intendedOutcome", "scopeConstraints", "acceptanceCriteria"].includes(field))) {
    dbPatch.strategy = {
      goal: resultingItem.intendedOutcome || "",
      successCriteria: resultingItem.acceptanceCriteria || "",
      scopeConstraints: resultingItem.scopeConstraints || "",
    };
  }
  if (itemType === "initiative" && changedFields.some((field) => ["accountableProfileId", "responsibleProfileIds", "consultedProfileIds", "informedProfileIds"].includes(field))) {
    dbPatch.raciAssignments = buildRaciAssignments(resultingItem);
  }
  return dbPatch;
}

export async function buildPlanningItemUpdatePreview({ actor, itemId, parsed, supabase }: {
  actor: AuthenticatedProfile;
  itemId: string;
  parsed: Extract<ReturnType<typeof parsePlanningItemPatchPayload>, { ok: true }>;
  supabase: SupabaseServer;
}): Promise<{ ok: true; preview: PlanningItemUpdatePreview } | { ok: false; status: 403 | 404 | 409; error: string }> {
  const target = await loadTarget(supabase, itemId);
  if (!target.ok) return target;
  if (String(target.row.updated_at || "") !== parsed.expectedUpdatedAt) {
    return { ok: false, status: 409, error: "Planungselement wurde zwischenzeitlich geändert. Bitte Kontext erneut laden." };
  }

  const currentItem = mapPlanningItemDatabaseRow(target.itemType, target.row, target.strategy, target.raciAssignments);
  const errors = validatePermission(actor, target.itemType, target.row, parsed.presentFields);
  const normalization = normalizePatch(parsed.raw, parsed.presentFields, target.itemType);
  errors.push(...normalization.errors);
  const normalizedPatch = normalization.normalized;
  if (parsed.githubSync && isStrategicPlanningItemType(target.itemType)) {
    errors.push("GitHub-Sync ist für Epic und Initiative nicht verfügbar.");
  }

  const [profilesResult, parentsResult, sprintsResult, raciResult] = await Promise.all([
    supabase.from("profiles").select("id,platform_role"),
    supabase.from(ACTIVE_TASKS_TABLE)
      .select("id,task_type,parent_task_id,owner,assignee,approval_status,review_status,score_final,sprint_id")
      .eq("project_id", FOUNDEROPS_PLANNING_PROJECT_ID),
    supabase.from("sprints").select("id,score_locked"),
    supabase.from("planning_item_raci_assignments").select("task_id,profile_id,role,sort_order"),
  ]);
  if (profilesResult.error || parentsResult.error || sprintsResult.error || raciResult.error) {
    throw new Error("Planning-Items-Referenzen konnten nicht geladen werden.");
  }

  const profiles = new Map(((profilesResult.data || []) as DatabaseRow[]).map((profile) => [String(profile.id), profile]));
  const profileIds = new Set(profiles.keys());
  const parents = new Map(((parentsResult.data || []) as DatabaseRow[]).map((parent) => [String(parent.id), parent]));
  const sprints = new Map(((sprintsResult.data || []) as DatabaseRow[]).map((sprint) => [String(sprint.id), sprint]));
  const raciAssignments = (raciResult.data || []) as RaciRow[];

  const parentPatched = hasOwn(normalizedPatch, "parentTaskId");
  const parentInput = parentPatched ? String(normalizedPatch.parentTaskId || "") : String(currentItem.parentTaskId || "");
  const parentTaskId = parentInput;
  if (parentPatched) normalizedPatch.parentTaskId = parentTaskId;
  const parent = parentTaskId ? parents.get(parentTaskId) : undefined;

  if (target.itemType === "initiative" && parentTaskId && parent?.task_type !== "epic") {
    errors.push("Initiative braucht als Parent ein Epic.");
  }
  if (target.itemType === "deliverable" && parentTaskId) {
    if (parent?.task_type !== "initiative") errors.push("Deliverable braucht als Parent eine Initiative.");
    else if (parent.approval_status === "rejected") errors.push("Deliverables können nicht in einer abgelehnten Initiative liegen.");
  }
  if (target.itemType === "sub_issue") {
    if (!parentTaskId || parent?.task_type !== "deliverable") {
      errors.push("Sub-Issue braucht ein gültiges Parent-Deliverable.");
    } else if (parent.approval_status !== "approved") {
      errors.push("Sub-Issue braucht ein freigegebenes Parent-Deliverable.");
    } else if (isReviewStateLocked(String(parent.review_status || ""), Boolean(parent.score_final))) {
      errors.push(reviewStateLockMessage(String(parent.review_status || ""), Boolean(parent.score_final)));
    }
  }
  for (const field of ["ownerId", "accountableProfileId"] as const) {
    const value = normalizedPatch[field];
    if (typeof value === "string" && value && !profileIds.has(value)) errors.push(`${field} wurde nicht gefunden.`);
  }
  for (const field of ["responsibleProfileIds", "consultedProfileIds", "informedProfileIds"] as const) {
    const values = normalizedPatch[field];
    if (Array.isArray(values) && values.some((value) => typeof value === "string" && !profileIds.has(value))) {
      errors.push(`${field} enthält unbekannte Profile.`);
    }
  }
  if (hasOwn(normalizedPatch, "githubRepo")) {
    const githubRepository = resolveTaskGitHubRepository("sub_issue", String(normalizedPatch.githubRepo || ""));
    if (!githubRepository.ok) errors.push(githubRepository.error);
    if (!["ceo", "deputy"].includes(actor.platformRole)) errors.push("githubRepo darf nur von CEO oder Deputy geändert werden.");
    if (target.row.github_issue_number || target.row.github_issue_url || target.row.github_issue_sync_status !== "not_synced") {
      errors.push("githubRepo kann nur vor der GitHub-Synchronisierung geändert werden.");
    }
  }

  const resultingItem: UnknownRecord = { ...currentItem, ...normalizedPatch, parentTaskId };
  if (String(resultingItem.startDate || "") && String(resultingItem.endDate || "") && String(resultingItem.startDate) > String(resultingItem.endDate)) {
    errors.push("Startdatum darf nicht nach dem Enddatum liegen.");
  }

  const rewritesLegacySubIssueStatus = target.itemType === "sub_issue"
    && parsed.presentFields.includes("status")
    && !isSubIssueStatus(String(target.row.status || ""));
  const fieldChanged = (field: TeamPlanningItemPatchField) => {
    if (field === "parentTaskId") {
      return !sameValue(currentItem.parentTaskId, parentTaskId);
    }
    return !sameValue(currentItem[field], resultingItem[field]);
  };
  const changedFields = parsed.presentFields.filter((field) => fieldChanged(field) || (field === "status" && rewritesLegacySubIssueStatus));
  const taskUpdateRequested = (target.itemType === "deliverable" || target.itemType === "sub_issue") && changedFields.length > 0;
  if (taskUpdateRequested && target.itemType === "deliverable" && isReviewStateLocked(String(target.row.review_status || ""), Boolean(target.row.score_final))) {
    return { ok: false, status: 409, error: reviewStateLockMessage(String(target.row.review_status || ""), Boolean(target.row.score_final)) };
  }
  if (taskUpdateRequested && target.itemType === "sub_issue" && parent && isReviewStateLocked(String(parent.review_status || ""), Boolean(parent.score_final))) {
    return { ok: false, status: 409, error: reviewStateLockMessage(String(parent.review_status || ""), Boolean(parent.score_final)) };
  }

  const statusChanged = changedFields.includes("status") && (target.itemType === "deliverable" || target.itemType === "sub_issue");
  const statusPayload = statusChanged ? { status: String(resultingItem.status || "") } : {};
  const statusPermissions = taskDetailPermissions({
    task: {
      assignee: String(target.row.assignee || ""),
      assigneeId: String(target.row.assignee || ""),
      owner: String(target.row.owner || ""),
      ownerId: String(target.row.owner || ""),
      reviewOwnerProfileId: String(target.row.review_owner_profile_id || ""),
      reviewStatus: String(target.row.review_status || "not_requested") as Task["reviewStatus"],
      scoreFinal: Boolean(target.row.score_final),
      taskType: target.itemType,
    },
    profile: actor,
  });
  if (statusChanged) {
    const statusGuard = validateTaskStatusUpdate({
      canCompleteSubIssue: statusPermissions.canCompleteSubIssue,
      canReopenSubIssue: statusPermissions.canReopenSubIssue,
      currentTask: {
        assignee: String(target.row.assignee || ""),
        owner: String(target.row.owner || ""),
        status: String(target.row.status || ""),
        task_type: String(target.row.task_type || ""),
      },
      isOperationalLead: isOperationalLeadRole(actor.platformRole),
      isCeo: actor.platformRole === "ceo",
      payload: statusPayload,
      profile: actor,
    });
    if (!statusGuard.ok) errors.push(statusGuard.error);

    const parentStatusGuard = validateSubIssueStatusParentApproval({
      currentTask: { task_type: String(target.row.task_type || "") },
      parentApprovalStatus: parent?.approval_status as string | null | undefined,
      payload: statusPayload,
    });
    if (!parentStatusGuard.ok) errors.push(parentStatusGuard.error);
  }

  const systemEffects: PlanningItemSystemEffect[] = [];
  if (statusChanged) {
    const currentStatus = rewritesLegacySubIssueStatus
      ? String(target.row.status || currentItem.status || "")
      : String(currentItem.status || "");
    systemEffects.push({
      field: "activity",
      before: null,
      after: { action: "task.status_changed", message: `Status geändert: ${currentStatus} → ${String(resultingItem.status || "")}` },
      reason: "Tatsächliche Statusänderung wird in der Aufgabenaktivität erfasst.",
    });
    systemEffects.push({
      field: "audit",
      before: null,
      after: { action: "team.planning_items.update" },
      reason: "Tatsächliche Statusänderung wird mit Bezug auf das persönliche API-Token auditiert.",
    });

    const reopenedPatch: TaskRouteDbUpdate = {};
    applyFinalStatusReopen(
      reopenedPatch,
      { status: String(target.row.status || ""), task_type: String(target.row.task_type || "") },
      statusPayload,
      actor.platformRole === "ceo",
      statusPermissions.canReopenSubIssue,
    );
    if (Object.hasOwn(reopenedPatch, "score_final")) {
      appendSystemEffect(systemEffects, "scoreFinal", currentItem.scoreFinal, reopenedPatch.score_final, "Wiederöffnen setzt den finalen Score zurück.");
      resultingItem.scoreFinal = reopenedPatch.score_final;
    }
    if (Object.hasOwn(reopenedPatch, "review_status")) {
      appendSystemEffect(systemEffects, "reviewStatus", currentItem.reviewStatus, reopenedPatch.review_status, "Wiederöffnen setzt den Review-Zustand zurück.");
      resultingItem.reviewStatus = reopenedPatch.review_status;
    }
    if (Object.hasOwn(reopenedPatch, "review_requested_at")) {
      appendSystemEffect(systemEffects, "reviewRequestedAt", currentItem.reviewRequestedAt, reopenedPatch.review_requested_at, "Wiederöffnen aktualisiert den Review-Zeitstempel.");
      resultingItem.reviewRequestedAt = reopenedPatch.review_requested_at;
    }

    if (target.itemType === "deliverable" && startsTaskReviewRequest(statusPayload)) {
      if (target.row.approval_status !== "approved") errors.push("Nur freigegebene Deliverables können in Review gegeben werden.");
      if (target.row.score_final) errors.push("Final bewertete Aufgaben müssen über „Review erneut öffnen“ zurück in Review gegeben werden.");
      const sprint = sprints.get(String(target.row.sprint_id || ""));
      if (sprint?.score_locked) errors.push("Sprint-Score ist bereits gelockt.");

      const reviewOwnerProfileId = String(
        target.row.review_owner_profile_id
        || raciAssignments
          .filter((assignment) => assignment.task_id === parentTaskId && assignment.role === "accountable")
          .sort((left, right) => left.sort_order - right.sort_order)[0]?.profile_id
        || parent?.owner
        || "",
      );
      const reviewOwner = profiles.get(reviewOwnerProfileId);
      if (!reviewOwnerProfileId) {
        errors.push("Lege vor der Review-Anfrage eine Review-Verantwortung fest.");
      } else if (!reviewOwner?.platform_role || reviewOwner.platform_role === "viewer") {
        errors.push("Die Review-Verantwortung braucht eine beitragende Rolle.");
      } else {
        const reviewRequestedAt = new Date().toISOString();
        appendSystemEffect(systemEffects, "reviewStatus", currentItem.reviewStatus, "requested", "Status Review startet den bestehenden Review-Übergang.");
        appendSystemEffect(systemEffects, "scorePoints", currentItem.scorePoints, 0, "Review-Anfrage setzt den Score zurück.");
        appendSystemEffect(systemEffects, "scoreFinal", currentItem.scoreFinal, false, "Review-Anfrage setzt den finalen Score zurück.");
        appendSystemEffect(systemEffects, "reviewOwnerProfileId", currentItem.reviewOwnerProfileId, reviewOwnerProfileId, "Review Owner aus Aufgabe oder Initiative abgeleitet.");
        appendSystemEffect(systemEffects, "reviewRequestedAt", currentItem.reviewRequestedAt, reviewRequestedAt, "Review-Anfrage setzt den Zeitstempel.");
        resultingItem.reviewStatus = "requested";
        resultingItem.scorePoints = 0;
        resultingItem.scoreFinal = false;
        resultingItem.reviewOwnerProfileId = reviewOwnerProfileId;
        resultingItem.reviewRequestedAt = reviewRequestedAt;
        systemEffects.push({
          field: "notification",
          before: null,
          after: { type: "task.review_requested", recipientProfileId: reviewOwnerProfileId },
          reason: "Review Owner wird über die Review-Anfrage benachrichtigt.",
        });
      }
    }
  }

  const parentChanged = changedFields.includes("parentTaskId");
  if (parentChanged && (target.itemType === "deliverable" || target.itemType === "sub_issue") && changedFields.length > 1) {
    errors.push("Ändere die übergeordnete Planungsebene separat von weiteren Feldern.");
  }
  if ((target.itemType === "initiative" || target.itemType === "deliverable") && parentChanged && currentItem.approvalStatus === "approved") {
    appendSystemEffect(systemEffects, "approvalStatus", currentItem.approvalStatus, "proposed", "Parent-Wechsel benötigt eine neue Freigabe.");
    appendSystemEffect(systemEffects, "approvalRevision", currentItem.approvalRevision, Number(currentItem.approvalRevision || 1) + 1, "Neue Freigabe-Revision.");
    resultingItem.approvalStatus = "proposed";
    resultingItem.approvalRevision = Number(currentItem.approvalRevision || 1) + 1;
    if (target.itemType === "deliverable") {
      appendSystemEffect(systemEffects, "sprintId", currentItem.sprintId, "", "Freigabewechsel entfernt die Sprint-Zuordnung.");
      appendSystemEffect(systemEffects, "reviewStatus", currentItem.reviewStatus, "not_requested", "Freigabewechsel beendet den laufenden Review-Zustand.");
      appendSystemEffect(systemEffects, "scorePoints", currentItem.scorePoints, 0, "Freigabewechsel setzt den Score zurück.");
      appendSystemEffect(systemEffects, "scoreFinal", currentItem.scoreFinal, false, "Freigabewechsel setzt den finalen Score zurück.");
      resultingItem.sprintId = "";
      resultingItem.reviewStatus = "not_requested";
      resultingItem.scorePoints = 0;
      resultingItem.scoreFinal = false;
      resultingItem.scoreRelevant = false;
    }
  }
  if ((target.itemType === "deliverable" || target.itemType === "sub_issue") && changedFields.length) {
    appendSystemEffect(systemEffects, "githubIssueSyncStatus", currentItem.githubIssueSyncStatus, "not_synced", "Planungsänderung markiert die GitHub-Projektion als erneut zu synchronisieren.");
    resultingItem.githubIssueSyncStatus = "not_synced";
  }

  return {
    ok: true,
    preview: {
      itemId: String(target.row.id || itemId),
      itemType: target.itemType,
      expectedUpdatedAt: parsed.expectedUpdatedAt,
      currentItem,
      normalizedPatch,
      resultingItem,
      changedFields,
      systemEffects,
      warnings: changedFields.length ? [] : ["Die normalisierte Änderung entspricht dem aktuellen Stand."],
      errors,
      dbPatch: buildDbPatch(target.itemType, changedFields, resultingItem),
      ...(target.itemType === "sub_issue" ? { githubSyncParentApprovalStatus: parent?.approval_status } : {}),
    },
  };
}

export function planningItemReviseCommand(
  itemId: string,
  itemType: TeamPlanningItemType,
  expectedRevision: string,
  patch: UnknownRecord,
): ReviseItem {
  const brief: UnknownRecord = {};
  for (const field of ["description", "problemStatement", "intendedOutcome", "scopeConstraints", "acceptanceCriteria", "evidenceRequired", "definitionOfDone"]) {
    if (hasOwn(patch, field)) brief[field] = patch[field];
  }
  const ownerPresent = ["ownerId", "owner", "assignee"].some((field) => hasOwn(patch, field));
  const ownerValue = patch.ownerId ?? patch.owner ?? patch.assignee;
  const statusValue = itemType === "epic" || itemType === "initiative"
    ? ({ planned: "Offen", active: "In Arbeit", paused: "Pausiert", done: "Erledigt" }[String(patch.status)] || patch.status)
    : patch.status;
  const common = {
    itemKind: itemType,
    ...(hasOwn(patch, "title") ? { title: String(patch.title || "") } : {}),
    ...(ownerPresent ? { ownerId: String(ownerValue || "") || null } : {}),
    ...(hasOwn(patch, "status") ? { status: statusValue } : {}),
  };
  let changes: PlanningItemChanges;
  if (itemType === "epic") {
    changes = {
      ...common,
      itemKind: "epic",
      ...(hasOwn(patch, "description") ? { description: String(patch.description || "") } : {}),
      ...(hasOwn(patch, "targetDate") ? { targetDate: String(patch.targetDate || "") || null } : {}),
    } as PlanningItemChanges;
  } else if (itemType === "initiative") {
    const nestedStrategy = patch.strategy && typeof patch.strategy === "object" && !Array.isArray(patch.strategy)
      ? patch.strategy as UnknownRecord
      : null;
    const strategy = {
      ...(hasOwn(patch, "intendedOutcome") || hasOwn(patch, "goal") || nestedStrategy && hasOwn(nestedStrategy, "goal")
        ? { goal: String(patch.intendedOutcome ?? patch.goal ?? nestedStrategy?.goal ?? "") } : {}),
      ...(hasOwn(patch, "acceptanceCriteria") || hasOwn(patch, "successCriteria") || nestedStrategy && hasOwn(nestedStrategy, "successCriteria")
        ? { successCriteria: String(patch.acceptanceCriteria ?? patch.successCriteria ?? nestedStrategy?.successCriteria ?? "") } : {}),
      ...(hasOwn(patch, "scopeConstraints") || nestedStrategy && hasOwn(nestedStrategy, "scopeConstraints")
        ? { scopeConstraints: String(patch.scopeConstraints ?? nestedStrategy?.scopeConstraints ?? "") } : {}),
    };
    const raciChanged = hasOwn(patch, "raciAssignments")
      || ["accountableProfileId", "responsibleProfileIds", "consultedProfileIds", "informedProfileIds"].some((field) => hasOwn(patch, field));
    const raciAssignments = Array.isArray(patch.raciAssignments)
      ? patch.raciAssignments.filter((entry): entry is UnknownRecord => Boolean(entry) && typeof entry === "object" && !Array.isArray(entry)).map((entry, index) => ({
        profileId: String(entry.profileId || ""),
        role: String(entry.role || ""),
        sortOrder: Number.isInteger(entry.sortOrder) ? Number(entry.sortOrder) : index,
      }))
      : buildRaciAssignments(patch);
    changes = {
      ...common,
      itemKind: "initiative",
      ...(hasOwn(patch, "description") ? { description: String(patch.description || "") } : {}),
      ...(Object.keys(strategy).length ? { strategy } : {}),
      ...(raciChanged ? { raciAssignments } : {}),
      ...(hasOwn(patch, "targetDate") ? { targetDate: String(patch.targetDate || "") || null } : {}),
      ...(hasOwn(patch, "priority") ? { priority: String(patch.priority || "") } : {}),
    } as PlanningItemChanges;
  } else if (itemType === "sub_issue") {
    changes = {
      ...common,
      itemKind: "sub_issue",
      ...(Object.keys(brief).length ? { brief } : {}),
      ...(hasOwn(patch, "githubRepo") ? { githubRepository: String(patch.githubRepo || "") } : {}),
    } as PlanningItemChanges;
  } else {
    changes = {
      ...common,
      itemKind: "deliverable",
      ...(Object.keys(brief).length ? { brief } : {}),
      ...(hasOwn(patch, "priority") ? { priority: String(patch.priority || "") } : {}),
      ...(hasOwn(patch, "workstream") ? { workstream: String(patch.workstream || "") } : {}),
      ...(hasOwn(patch, "startDate") ? { startDate: String(patch.startDate || "") || null } : {}),
      ...(hasOwn(patch, "endDate") ? { endDate: String(patch.endDate || "") || null } : {}),
      ...(hasOwn(patch, "deadline") ? { deadline: String(patch.deadline || "") || null } : {}),
      ...(hasOwn(patch, "hours") ? { hours: Number(patch.hours || 0) } : {}),
    } as PlanningItemChanges;
  }
  return { kind: "reviseItem", itemId, expectedRevision, changes };
}

export type BrowserReviseWriter =
  | Readonly<{
    kind: "strategic";
    params: Readonly<{
      taskId: string;
      expectedUpdatedAt: string;
      patch: UnknownRecord;
      strategy: UnknownRecord | null;
      raciAssignments: readonly UnknownRecord[] | null;
      legacyAuditAction?: string;
    }>;
  }>
  | Readonly<{
    kind: "delivery";
    params: Readonly<{
      taskId: string;
      expectedUpdatedAt: string;
      taskPatch: UnknownRecord;
      notePresent: boolean;
      note: string | null;
      dependencyPresent: boolean;
      dependencyNote: string | null;
      activityMessages: readonly string[];
      notifications: readonly UnknownRecord[];
    }>;
  }>;

type BrowserReviseDependencies = Readonly<{
  supabase: SupabaseServer;
  actor: ActorContext;
  writer: BrowserReviseWriter;
}>;

function reviseError(error: unknown): PlanningError {
  const code = error && typeof error === "object" && "code" in error ? String(error.code || "") : "";
  if (code === "P0001") return { code: "conflict", reason: "revision" };
  if (code === "P0003") return { code: "conflict", reason: "state", details: { reviseState: "trashed" } };
  if (code === "P0008") return { code: "conflict", reason: "state", details: { reviseState: "parentApproval" } };
  if (code === "P0010") return { code: "conflict", reason: "state", details: { reviseState: "reviewLocked" } };
  if (code === "P0015") return { code: "conflict", reason: "state", details: { reviseState: "sprintLocked" } };
  if (code === "P0002") return { code: "notFound", entity: { kind: "deliverable", id: "" } };
  if (code === "P0006") return { code: "forbidden", reason: "reviseNotAllowed" };
  if (code === "22023" || code === "23514") return { code: "invalidCommand", issues: [{ path: "command.changes", reason: "persistenceValidation" }] };
  return { code: "dependencyUnavailable", dependency: "database", retryable: true };
}

export function createBrowserRevisePlanningItems(dependencies: BrowserReviseDependencies): PlanningItems {
  return {
    async run(invocation) {
      if (invocation.actor.profileId !== dependencies.actor.profileId) return { ok: false, error: { code: "forbidden", reason: "actorMismatch" } };
      if (invocation.command.kind !== "reviseItem") return { ok: false, error: { code: "invalidCommand", issues: [{ path: "command.kind", reason: "reviseItemRequired" }] } };
      if ("parentId" in invocation.command.changes) return { ok: false, error: { code: "invalidCommand", issues: [{ path: "command.changes.parentId", reason: "useChangeParentAction" }] } };
      if (invocation.mode === "preview") return {
        ok: true,
        status: "previewed",
        items: [],
        changes: [{ field: "reviseItem", before: null, after: invocation.command.changes }],
        effects: [{ kind: "audit", description: "Record the planning item revision" }],
        warnings: [],
      };
      const writer = dependencies.writer;
      const result = writer.kind === "strategic"
        ? await dependencies.supabase.rpc("update_browser_planning_item_transaction", {
          p_task_id: writer.params.taskId,
          p_expected_updated_at: writer.params.expectedUpdatedAt,
          p_patch: writer.params.patch,
          p_strategy: writer.params.strategy,
          p_raci_assignments: writer.params.raciAssignments,
          p_actor_profile_id: invocation.actor.profileId,
          p_request_ip: invocation.requestMetadata?.requestIp || null,
          p_user_agent: invocation.requestMetadata?.userAgent || null,
          p_legacy_audit_action: writer.params.legacyAuditAction || null,
        })
        : await dependencies.supabase.rpc("update_browser_planning_task_transaction", {
          p_task_id: writer.params.taskId,
          p_expected_updated_at: writer.params.expectedUpdatedAt,
          p_task_patch: writer.params.taskPatch,
          p_note_present: writer.params.notePresent,
          p_note: writer.params.note,
          p_dependency_present: writer.params.dependencyPresent,
          p_dependency_note: writer.params.dependencyNote,
          p_activity_messages: writer.params.activityMessages,
          p_notifications: writer.params.notifications,
          p_actor_profile_id: invocation.actor.profileId,
        });
      if (result.error) return { ok: false, error: reviseError(result.error) };
      return {
        ok: true,
        status: "committed",
        items: [],
        changes: [{ field: "browserReviseTransaction", before: null, after: result.data }],
        effects: [{ kind: "audit", description: "Record the planning item revision", status: "applied" }],
        replayed: false,
      };
    },
  };
}

export function browserReviseTransactionFromResult(result: Extract<PlanningResult, { ok: true }>) {
  return result.changes.find((change) => change.field === "browserReviseTransaction")?.after;
}

export type TeamReviseTransaction = Readonly<{
  replayed?: boolean;
  itemType?: PlanningItemReplayType;
  item?: UnknownRecord;
  changedFields?: string[];
  systemEffects?: unknown[];
  githubSync?: PlanningItemGitHubSyncResult;
  projectionOperationId?: string;
}>;

type StoredTeamReviseRequest = Readonly<{
  request_hash: string;
  response: TeamReviseTransaction | null;
  contract_version: number | null;
}>;

type TeamReviseDependencies = Readonly<{
  supabase: SupabaseServer;
  actor: ActorContext;
  tokenId: string;
  itemId: string;
  parsed: Extract<ReturnType<typeof parsePlanningItemPatchPayload>, { ok: true }>;
  preparedPreview?: PlanningItemUpdatePreview;
  onPreview?: (preview: PlanningItemUpdatePreview) => void;
  dispatchGitHubProjections?: (
    supabase: SupabaseServer,
    operationId: string,
  ) => Promise<Map<string, PlanningItemGitHubSyncResult>>;
  scheduleAfter?: (callback: () => Promise<void>) => void;
}>;

type TeamReviseReceipt = Readonly<{
  transaction: TeamReviseTransaction;
  contractVersion: number;
}>;

function teamReviseChange(receipt: TeamReviseReceipt) {
  return { field: "teamReviseTransaction", before: null, after: receipt } as const;
}

function teamReviseReceiptFromResult(result: Extract<PlanningResult, { ok: true }>): TeamReviseReceipt | null {
  return result.changes.find((change) => change.field === "teamReviseTransaction")?.after as TeamReviseReceipt | null || null;
}

export function teamReviseTransactionFromResult(result: Extract<PlanningResult, { ok: true }>) {
  return teamReviseReceiptFromResult(result);
}

function teamReviseProviderError(error: unknown): PlanningError {
  const code = error && typeof error === "object" && "code" in error ? String(error.code || "") : "";
  if (code === "P0001") return { code: "conflict", reason: "revision" };
  if (code === "P0003") return { code: "conflict", reason: "idempotency" };
  if (["P0004", "P0005", "P0006", "P0007"].includes(code)) return { code: "forbidden", reason: "planningTokenRejected" };
  if (["P0008", "P0010"].includes(code)) return { code: "conflict", reason: "state" };
  if (["P0014", "P0015"].includes(code)) return { code: "conflict", reason: "state" };
  if (code === "P0002") return { code: "notFound", entity: { kind: "deliverable", id: "" } };
  if (["22023", "23514"].includes(code)) return { code: "invalidCommand", issues: [{ path: "command.changes", reason: "persistenceValidation" }] };
  return { code: "dependencyUnavailable", dependency: "database", retryable: true };
}

function teamReviseEffects(preview: PlanningItemUpdatePreview) {
  return [
    { kind: "audit" as const, description: "Record the planning item revision" },
    ...preview.systemEffects.map((effect) => ({ kind: "activity" as const, description: effect.reason })),
    ...(preview.changedFields.length ? [{ kind: "notification" as const, description: "Notify affected planning participants" }] : []),
  ];
}

export function createTeamRevisePlanningItems(dependencies: TeamReviseDependencies): PlanningItems {
  return {
    async run(invocation) {
      if (invocation.actor.profileId !== dependencies.actor.profileId) return { ok: false, error: { code: "forbidden", reason: "actorMismatch" } };
      if (invocation.command.kind !== "reviseItem") return { ok: false, error: { code: "invalidCommand", issues: [{ path: "command.kind", reason: "reviseItemRequired" }] } };
      if (invocation.command.itemId !== dependencies.itemId || invocation.command.expectedRevision !== dependencies.parsed.expectedUpdatedAt) {
        return { ok: false, error: { code: "invalidCommand", issues: [{ path: "command", reason: "transportMismatch" }] } };
      }
      if (invocation.mode === "commit" && !invocation.idempotencyKey) {
        return { ok: false, error: { code: "invalidCommand", issues: [{ path: "idempotencyKey", reason: "idempotencyKeyRequired" }] } };
      }
      const idempotencyKey = invocation.idempotencyKey || "";
      const existing = invocation.mode === "commit" ? await dependencies.supabase
        .from("team_planning_item_update_requests")
        .select("request_hash,response,contract_version")
        .eq("token_id", dependencies.tokenId)
        .eq("idempotency_key", idempotencyKey)
        .maybeSingle() : { data: null, error: null };
      if (existing.error) return { ok: false, error: teamReviseProviderError(existing.error) };
      const stored = existing.data as StoredTeamReviseRequest | null;
      if (stored) {
        const itemType = stored.response?.itemType;
        if (!itemType) return { ok: false, error: { code: "dependencyUnavailable", dependency: "database", retryable: false } };
        if ((itemType === "epic" || itemType === "milestone") && !["ceo", "deputy"].includes(invocation.actor.platformRole)) {
          return { ok: false, error: { code: "forbidden", reason: "reviseEpicRequiresOperationalLead" } };
        }
        const requestHash = planningItemUpdateHash({
          itemId: dependencies.itemId,
          itemType,
          expectedUpdatedAt: dependencies.parsed.expectedUpdatedAt,
          patch: dependencies.parsed.raw,
        });
        if (requestHash !== stored.request_hash) return { ok: false, error: { code: "conflict", reason: "idempotency" } };
        let replayResponse = stored.response;
        if (dependencies.parsed.githubSyncMode === "wait" && dependencies.dispatchGitHubProjections) {
          await dependencies.dispatchGitHubProjections(
            dependencies.supabase,
            `team-update:${dependencies.tokenId}:${idempotencyKey}`,
          );
          const refreshed = await dependencies.supabase
            .from("team_planning_item_update_requests")
            .select("response")
            .eq("token_id", dependencies.tokenId)
            .eq("idempotency_key", idempotencyKey)
            .single();
          if (refreshed.error) return { ok: false, error: teamReviseProviderError(refreshed.error) };
          replayResponse = (refreshed.data as { response: TeamReviseTransaction }).response;
        }
        return {
          ok: true,
          status: "committed",
          items: [],
          changes: [teamReviseChange({ transaction: { ...replayResponse, replayed: true }, contractVersion: Number(stored.contract_version || 1) })],
          effects: [],
          replayed: true,
        };
      }

      if (dependencies.parsed.hasLegacyAliases) {
        return { ok: false, error: { code: "invalidCommand", issues: [{ path: "command.changes", reason: "legacyAliasRetired" }] } };
      }

      const prepared = dependencies.preparedPreview ? { ok: true as const, preview: dependencies.preparedPreview } : await buildPlanningItemUpdatePreview({
          actor: { id: invocation.actor.profileId, platformRole: invocation.actor.platformRole } as AuthenticatedProfile,
          itemId: dependencies.itemId,
          parsed: dependencies.parsed,
          supabase: dependencies.supabase,
        });
      if (!prepared.ok) {
        if (prepared.status === 404) return { ok: false, error: { code: "notFound", entity: { kind: "deliverable", id: dependencies.itemId } } };
        if (prepared.status === 403) return { ok: false, error: { code: "forbidden", reason: "reviseNotAllowed" } };
        return { ok: false, error: { code: "conflict", reason: "revision" } };
      }
      const preview = prepared.preview;
      dependencies.onPreview?.(preview);
      if (preview.errors.length) {
        return { ok: false, error: { code: "invalidCommand", issues: preview.errors.map((reason: string) => ({ path: "command.changes", reason })) } };
      }
      const effects = teamReviseEffects(preview);
      if (invocation.mode === "preview") return {
        ok: true,
        status: "previewed",
        items: [],
        changes: [{ field: "reviseItem", before: preview.currentItem, after: preview.resultingItem }],
        effects,
        warnings: preview.warnings.map((message, index) => ({ code: `reviseWarning${index + 1}`, message })),
      };

      const metadata = invocation.requestMetadata;
      const { data, error } = await dependencies.supabase.rpc("update_team_planning_item_with_projection_transaction", {
        p_token_id: dependencies.tokenId,
        p_profile_id: invocation.actor.profileId,
        p_item_type: preview.itemType,
        p_item_id: preview.itemId,
        p_expected_updated_at: preview.expectedUpdatedAt,
        p_idempotency_key: idempotencyKey,
        p_request_hash: planningItemUpdateHash({ itemId: preview.itemId, itemType: preview.itemType, expectedUpdatedAt: preview.expectedUpdatedAt, patch: dependencies.parsed.raw }),
        p_patch: preview.dbPatch,
        p_changed_fields: preview.changedFields,
        p_system_effects: preview.systemEffects,
        p_projection_command: dependencies.parsed.githubSync || null,
        p_request_ip: metadata?.requestIp || null,
        p_user_agent: metadata?.userAgent || null,
      });
      if (error) return { ok: false, error: teamReviseProviderError(error) };
      let transaction = data as TeamReviseTransaction | null;
      if (!transaction) return { ok: false, error: { code: "dependencyUnavailable", dependency: "database", retryable: false } };

      const syncMode = dependencies.parsed.githubSyncMode;
      if (syncMode && transaction.projectionOperationId) {
        const projectionOperationId = transaction.projectionOperationId;
        if (syncMode === "wait") {
          if (!dependencies.dispatchGitHubProjections) return { ok: false, error: { code: "dependencyUnavailable", dependency: "github", retryable: true } };
          const results = await dependencies.dispatchGitHubProjections(dependencies.supabase, projectionOperationId);
          transaction = { ...transaction, githubSync: results.get(preview.itemId) };
        } else {
          if (dependencies.scheduleAfter && dependencies.dispatchGitHubProjections) {
            dependencies.scheduleAfter(async () => {
              await dependencies.dispatchGitHubProjections!(dependencies.supabase, projectionOperationId);
            });
          }
        }
      }
      return {
        ok: true,
        status: "committed",
        items: [],
        changes: [teamReviseChange({ transaction, contractVersion: 2 })],
        effects: effects.map((effect) => ({ ...effect, status: "applied" as const })),
        replayed: Boolean(transaction.replayed),
      };
    },
  };
}
