import { createHash } from "node:crypto";
import type { AuthenticatedProfile, Task } from "@/lib/types";
import { ACTIVE_PACKAGES_TABLE, ACTIVE_TASKS_TABLE } from "@/lib/planning-read-model";
import type { getServerSupabase } from "@/lib/supabase";
import { resolveTaskGitHubRepository } from "@/lib/github-repositories";
import { taskDetailPermissions } from "@/features/tasks/model/task-detail-permissions";
import { isReviewStateLocked, reviewStateLockMessage } from "@/features/reviews/model/task-review-state";
import {
  FOUNDEROPS_PLANNING_PROJECT_ID,
  TEAM_PLANNING_ITEM_PATCH_FIELDS,
  type TeamPlanningItemPatchField,
  type TeamPlanningItemType,
} from "@/features/planning-items/model/planning-items-contract";
import {
  normalizePatchAcceptanceCriteria,
  normalizePatchDate,
  normalizePatchHours,
  normalizePatchId,
  normalizePatchMilestoneStatus,
  normalizePatchPriority,
  normalizePatchStringList,
  normalizePatchText,
} from "@/features/planning-items/model/planning-item-normalization";

type SupabaseServer = NonNullable<ReturnType<typeof getServerSupabase>>;
type UnknownRecord = Record<string, unknown>;
type DatabaseRow = Record<string, unknown>;

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
};

type TargetLoadResult =
  | { ok: true; itemType: TeamPlanningItemType; row: DatabaseRow }
  | { ok: false; status: 404; error: string };

const patchFields = new Set<string>(TEAM_PLANNING_ITEM_PATCH_FIELDS);
const fieldsByType: Record<TeamPlanningItemType, Set<TeamPlanningItemPatchField>> = {
  milestone: new Set(["title", "description", "targetDate", "status"]),
  initiative: new Set([
    "title", "intendedOutcome", "scopeConstraints", "acceptanceCriteria", "milestoneId", "ownerId",
    "accountableProfileId", "responsibleProfileIds", "consultedProfileIds", "informedProfileIds", "priority",
  ]),
  deliverable: new Set([
    "title", "description", "problemStatement", "intendedOutcome", "scopeConstraints", "acceptanceCriteria",
    "evidenceRequired", "definitionOfDone", "packageId", "ownerId", "priority", "workstream", "startDate",
    "endDate", "deadline", "hours",
  ]),
  sub_issue: new Set([
    "title", "description", "problemStatement", "intendedOutcome", "scopeConstraints", "acceptanceCriteria",
    "evidenceRequired", "definitionOfDone", "parentTaskId", "ownerId", "priority", "workstream", "startDate",
    "endDate", "deadline", "hours", "githubRepo",
  ]),
};

const founderInitiativeFields = new Set<TeamPlanningItemPatchField>([
  "title", "intendedOutcome", "scopeConstraints", "acceptanceCriteria", "priority", "responsibleProfileIds",
  "consultedProfileIds", "informedProfileIds",
]);
const founderTaskBriefFields = new Set<TeamPlanningItemPatchField>([
  "title", "description", "problemStatement", "intendedOutcome", "scopeConstraints", "acceptanceCriteria",
  "evidenceRequired", "definitionOfDone",
]);
const initiativeMaterialFields = new Set(["title", "intendedOutcome", "scopeConstraints", "acceptanceCriteria", "milestoneId"]);
const deliverableMaterialFields = new Set(["title", "problemStatement", "intendedOutcome", "scopeConstraints", "acceptanceCriteria", "definitionOfDone", "packageId"]);

function hasOwn(value: UnknownRecord, key: string) {
  return Object.hasOwn(value, key);
}

function sameValue(before: unknown, after: unknown) {
  return JSON.stringify(before) === JSON.stringify(after);
}

function publicPackage(row: DatabaseRow): UnknownRecord {
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

function publicTask(row: DatabaseRow): UnknownRecord {
  return {
    id: String(row.id || ""),
    itemType: row.task_type === "sub_issue" ? "sub_issue" : "deliverable",
    title: String(row.title || ""),
    description: String(row.description || ""),
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
    githubRepo: String(row.github_repo || ""),
    approvalStatus: row.approval_status || null,
    approvalRevision: Number(row.approval_revision || 1),
    sprintId: String(row.sprint_id || ""),
    reviewStatus: String(row.review_status || "not_requested"),
    scorePoints: Number(row.score_points || 0),
    scoreFinal: Boolean(row.score_final),
    scoreRelevant: Boolean(row.score_relevant),
    githubIssueSyncStatus: String(row.github_issue_sync_status || "not_synced"),
    updatedAt: String(row.updated_at || ""),
  };
}

function publicMilestone(row: DatabaseRow): UnknownRecord {
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

export function mapPlanningItemDatabaseRow(itemType: TeamPlanningItemType, row: DatabaseRow) {
  if (itemType === "milestone") return publicMilestone(row);
  return itemType === "initiative" ? publicPackage(row) : publicTask(row);
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stableJson(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function planningItemUpdateHash({
  itemId,
  itemType,
  expectedUpdatedAt,
  patch,
}: {
  itemId: string;
  itemType: TeamPlanningItemType;
  expectedUpdatedAt: string;
  patch: UnknownRecord;
}) {
  return createHash("sha256")
    .update(stableJson({ itemId, itemType, expectedUpdatedAt, patch }), "utf8")
    .digest("hex");
}

export function parsePlanningItemPatchPayload(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false as const, error: "PATCH-Payload muss ein Objekt sein." };
  }
  const raw = payload as UnknownRecord;
  const unknownKey = Object.keys(raw).find((key) => key !== "expectedUpdatedAt" && key !== "itemType" && !patchFields.has(key));
  if (unknownKey) return { ok: false as const, error: `PATCH-Payload enthält das unbekannte Feld ${unknownKey}.` };
  if (hasOwn(raw, "itemType")) return { ok: false as const, error: "itemType ist unveränderlich und darf nicht gepatcht werden." };
  if (typeof raw.expectedUpdatedAt !== "string" || Number.isNaN(Date.parse(raw.expectedUpdatedAt))) {
    return { ok: false as const, error: "expectedUpdatedAt muss ein gültiger Zeitstempel sein." };
  }
  const presentFields = Object.keys(raw).filter((key): key is TeamPlanningItemPatchField => patchFields.has(key));
  if (!presentFields.length) return { ok: false as const, error: "PATCH braucht mindestens ein änderbares Feld." };
  return {
    ok: true as const,
    expectedUpdatedAt: raw.expectedUpdatedAt,
    presentFields,
    raw,
  };
}

async function loadTarget(supabase: SupabaseServer, itemId: string): Promise<TargetLoadResult> {
  const [milestoneResult, initiativeResult, taskResult] = await Promise.all([
    supabase
      .from("milestones")
      .select("id,project_id,title,description,target_date,status,sort_order,updated_at")
      .eq("project_id", FOUNDEROPS_PLANNING_PROJECT_ID)
      .eq("id", itemId)
      .maybeSingle(),
    supabase.from(ACTIVE_PACKAGES_TABLE).select("id,title,goal,scope_constraints,success_criteria,milestone_id,owner_id,accountable_profile_id,responsible_profile_ids,consulted_profile_ids,informed_profile_ids,priority,approval_status,approval_revision,updated_at").eq("id", itemId).maybeSingle(),
    supabase.from(ACTIVE_TASKS_TABLE).select("id,title,description,problem_statement,intended_outcome,scope_constraints,acceptance_criteria,evidence_required,definition_of_done,task_type,parent_task_id,package_id,milestone_id,owner,assignee,priority,workstream,start_date,end_date,deadline,estimate_hours,github_repo,github_issue_number,github_issue_url,github_issue_sync_status,approval_status,approval_revision,sprint_id,review_status,score_points,score_final,score_relevant,updated_at").eq("id", itemId).maybeSingle(),
  ]);
  if (milestoneResult.error) throw new Error(milestoneResult.error.message);
  if (initiativeResult.error) throw new Error(initiativeResult.error.message);
  if (taskResult.error) throw new Error(taskResult.error.message);
  if (milestoneResult.data) return { ok: true, itemType: "milestone", row: milestoneResult.data as DatabaseRow };
  if (initiativeResult.data) return { ok: true, itemType: "initiative", row: initiativeResult.data as DatabaseRow };
  if (taskResult.data) {
    const itemType = taskResult.data.task_type === "sub_issue" ? "sub_issue" : "deliverable";
    return { ok: true, itemType, row: taskResult.data as DatabaseRow };
  }
  return { ok: false, status: 404, error: "Planungselement wurde nicht gefunden oder ist im Papierkorb." };
}

function appendSystemEffect(
  effects: PlanningItemSystemEffect[],
  field: string,
  before: unknown,
  after: unknown,
  reason: string,
) {
  if (!sameValue(before, after)) effects.push({ field, before, after, reason });
}

function validatePermission(
  actor: AuthenticatedProfile,
  itemType: TeamPlanningItemType,
  target: DatabaseRow,
  presentFields: TeamPlanningItemPatchField[],
) {
  const errors: string[] = [];
  if (["ceo", "deputy"].includes(actor.platformRole)) return errors;

  if (itemType === "milestone") {
    errors.push("Nur CEO oder Deputy können Meilensteine bearbeiten.");
    return errors;
  }

  if (actor.platformRole !== "founder") {
    errors.push("Nur CEO, Deputy oder Founder dürfen Planungselemente bearbeiten.");
    return errors;
  }

  if (itemType === "initiative") {
    if (String(target.owner_id || "") !== actor.id) {
      errors.push("Founder können nur eigene Initiativen bearbeiten.");
      return errors;
    }
    const restricted = presentFields.filter((field) => !founderInitiativeFields.has(field));
    if (restricted.length) errors.push(`Diese Initiative-Felder sind geschützt: ${restricted.join(", ")}.`);
    return errors;
  }

  const permissions = taskDetailPermissions({
    task: {
      assignee: String(target.assignee || ""),
      assigneeId: String(target.assignee || ""),
      owner: String(target.owner || ""),
      ownerId: String(target.owner || ""),
      reviewOwnerProfileId: "",
      reviewStatus: String(target.review_status || "not_requested") as Task["reviewStatus"],
      scoreFinal: Boolean(target.score_final),
      taskType: itemType,
    },
    profile: actor,
  });
  const briefFields = presentFields.filter((field) => founderTaskBriefFields.has(field));
  if (briefFields.length && !permissions.canEditBrief) {
    errors.push("Founder können den Aufgabenbrief nur bei eigenen oder zugewiesenen Aufgaben bearbeiten.");
  }
  const protectedFields = presentFields.filter((field) => !founderTaskBriefFields.has(field) && field !== "parentTaskId");
  if (protectedFields.length) errors.push(`Diese Aufgabenfelder sind geschützt: ${protectedFields.join(", ")}.`);
  if (presentFields.includes("parentTaskId") && !permissions.canReparentSubIssue) {
    errors.push("Dieses Sub-Issue darf nur von CEO, Deputy oder der aktuellen Zuständigkeit verschoben werden.");
  }
  return errors;
}

function normalizePatch(
  raw: UnknownRecord,
  presentFields: TeamPlanningItemPatchField[],
  itemType: TeamPlanningItemType,
) {
  const normalized: UnknownRecord = {};
  const errors: string[] = [];
  const allowedFields = fieldsByType[itemType];
  for (const field of presentFields) {
    if (!allowedFields.has(field)) {
      errors.push(`${field} ist für ${itemType} nicht zulässig.`);
      continue;
    }
    const value = raw[field];
    let result:
      | ReturnType<typeof normalizePatchText>
      | ReturnType<typeof normalizePatchAcceptanceCriteria>
      | ReturnType<typeof normalizePatchDate>
      | ReturnType<typeof normalizePatchHours>
      | ReturnType<typeof normalizePatchId>
      | ReturnType<typeof normalizePatchPriority>
      | ReturnType<typeof normalizePatchStringList>;
    switch (field) {
      case "title": result = normalizePatchText(value, 240, true); break;
      case "description": result = normalizePatchText(value, 4_000); break;
      case "problemStatement": result = normalizePatchText(value, 4_000); break;
      case "intendedOutcome": result = normalizePatchText(value, 4_000); break;
      case "scopeConstraints": result = normalizePatchText(value, 4_000); break;
      case "acceptanceCriteria": result = normalizePatchAcceptanceCriteria(value); break;
      case "evidenceRequired": result = normalizePatchText(value, 4_000); break;
      case "definitionOfDone": result = normalizePatchText(value, 4_000); break;
      case "priority": result = normalizePatchPriority(value); break;
      case "status": result = normalizePatchMilestoneStatus(value); break;
      case "workstream": result = normalizePatchText(value, 120); break;
      case "startDate":
      case "endDate":
      case "deadline":
      case "targetDate": result = normalizePatchDate(value); break;
      case "hours": result = normalizePatchHours(value); break;
      case "responsibleProfileIds": result = normalizePatchStringList(value, true); break;
      case "consultedProfileIds":
      case "informedProfileIds": result = normalizePatchStringList(value); break;
      case "milestoneId":
      case "accountableProfileId":
      case "packageId":
      case "parentTaskId": result = normalizePatchId(value, true); break;
      case "ownerId": result = normalizePatchId(value); break;
      case "githubRepo": result = normalizePatchText(value, 120, true); break;
      default: result = { ok: false, error: "wird nicht unterstützt" };
    }
    if (!result.ok) errors.push(`${field} ${result.error}.`);
    else normalized[field] = result.value;
  }
  return { normalized, errors };
}

function buildDbPatch(itemType: TeamPlanningItemType, changedFields: string[], resultingItem: UnknownRecord) {
  const dbPatch: UnknownRecord = {};
  const changed = new Set(changedFields);
  if (itemType === "milestone") {
    const maps: Array<[string, string]> = [
      ["title", "title"],
      ["description", "description"],
      ["targetDate", "target_date"],
      ["status", "status"],
    ];
    for (const [field, column] of maps) if (changed.has(field)) dbPatch[column] = resultingItem[field];
    return dbPatch;
  }
  if (itemType === "initiative") {
    const maps: Array<[string, string]> = [
      ["title", "title"],
      ["intendedOutcome", "goal"],
      ["scopeConstraints", "scope_constraints"],
      ["acceptanceCriteria", "success_criteria"],
      ["milestoneId", "milestone_id"],
      ["ownerId", "owner_id"],
      ["accountableProfileId", "accountable_profile_id"],
      ["responsibleProfileIds", "responsible_profile_ids"],
      ["consultedProfileIds", "consulted_profile_ids"],
      ["informedProfileIds", "informed_profile_ids"],
      ["priority", "priority"],
    ];
    for (const [field, column] of maps) if (changed.has(field)) dbPatch[column] = resultingItem[field];
    return dbPatch;
  }

  const maps: Array<[string, string]> = [
    ["title", "title"],
    ["description", "description"],
    ["problemStatement", "problem_statement"],
    ["intendedOutcome", "intended_outcome"],
    ["scopeConstraints", "scope_constraints"],
    ["acceptanceCriteria", "acceptance_criteria"],
    ["evidenceRequired", "evidence_required"],
    ["definitionOfDone", "definition_of_done"],
    ["packageId", "package_id"],
    ["parentTaskId", "parent_task_id"],
    ["priority", "priority"],
    ["workstream", "workstream"],
    ["startDate", "start_date"],
    ["endDate", "end_date"],
    ["deadline", "deadline"],
    ["hours", "estimate_hours"],
    ["githubRepo", "github_repo"],
  ];
  for (const [field, column] of maps) if (changed.has(field)) dbPatch[column] = resultingItem[field];
  if (changed.has("ownerId")) {
    dbPatch.owner = resultingItem.ownerId;
    dbPatch.assignee = resultingItem.ownerId;
  }
  return dbPatch;
}

export async function buildPlanningItemUpdatePreview({
  actor,
  itemId,
  parsed,
  supabase,
}: {
  actor: AuthenticatedProfile;
  itemId: string;
  parsed: Extract<ReturnType<typeof parsePlanningItemPatchPayload>, { ok: true }>;
  supabase: SupabaseServer;
}): Promise<{ ok: true; preview: PlanningItemUpdatePreview } | { ok: false; status: 403 | 404 | 409; error: string }> {
  const target = await loadTarget(supabase, itemId);
  if (!target.ok) return target;
  if ((target.itemType === "deliverable" || target.itemType === "sub_issue") && isReviewStateLocked(String(target.row.review_status || ""), Boolean(target.row.score_final))) {
    return { ok: false, status: 409, error: reviewStateLockMessage(String(target.row.review_status || ""), Boolean(target.row.score_final)) };
  }
  if (target.itemType === "milestone" && !["ceo", "deputy"].includes(actor.platformRole)) {
    return { ok: false, status: 403, error: "Nur CEO oder Deputy können Meilensteine bearbeiten." };
  }

  const currentItem = mapPlanningItemDatabaseRow(target.itemType, target.row);
  if (String(currentItem.updatedAt || "") !== parsed.expectedUpdatedAt) {
    return { ok: false, status: 409, error: "Planungselement wurde zwischenzeitlich geändert. Bitte Kontext erneut laden." };
  }

  const [profilesResult, milestonesResult, initiativesResult, parentsResult] = await Promise.all([
    supabase.from("profiles").select("id"),
    supabase.from("milestones").select("id").eq("project_id", FOUNDEROPS_PLANNING_PROJECT_ID),
    supabase.from(ACTIVE_PACKAGES_TABLE).select("id,milestone_id,approval_status"),
    supabase.from(ACTIVE_TASKS_TABLE).select("id,task_type,package_id,milestone_id,approval_status,review_status,score_final"),
  ]);
  if (profilesResult.error || milestonesResult.error || initiativesResult.error || parentsResult.error) {
    throw new Error("Planning-Items-Referenzen konnten nicht geladen werden.");
  }

  const errors = [
    ...validatePermission(actor, target.itemType, target.row, parsed.presentFields),
  ];
  const normalization = normalizePatch(parsed.raw, parsed.presentFields, target.itemType);
  errors.push(...normalization.errors);
  const normalizedPatch = normalization.normalized;

  const profileIds = new Set((profilesResult.data || []).map((profile) => profile.id));
  const milestoneIds = new Set((milestonesResult.data || []).map((milestone) => milestone.id));
  const initiatives = new Map((initiativesResult.data || []).map((initiative) => [initiative.id, initiative]));
  const parents = new Map((parentsResult.data || []).map((task) => [task.id, task]));
  const currentParent = target.itemType === "sub_issue" ? parents.get(String(target.row.parent_task_id || "")) : undefined;
  if (currentParent && isReviewStateLocked(currentParent.review_status, currentParent.score_final)) {
    errors.push(reviewStateLockMessage(currentParent.review_status, currentParent.score_final));
  }

  for (const field of ["ownerId", "accountableProfileId"] as const) {
    const value = normalizedPatch[field];
    if (typeof value === "string" && value && !profileIds.has(value)) errors.push(`${field} wurde nicht gefunden.`);
  }
  for (const field of ["responsibleProfileIds", "consultedProfileIds", "informedProfileIds"] as const) {
    const values = normalizedPatch[field];
    if (Array.isArray(values)) {
      const missing = values.filter((value) => typeof value === "string" && !profileIds.has(value));
      if (missing.length) errors.push(`${field} enthält unbekannte Profile.`);
    }
  }
  if (hasOwn(normalizedPatch, "milestoneId") && !milestoneIds.has(String(normalizedPatch.milestoneId || ""))) {
    errors.push("milestoneId wurde nicht gefunden.");
  }
  if (hasOwn(normalizedPatch, "packageId")) {
    const initiative = initiatives.get(String(normalizedPatch.packageId || ""));
    if (!initiative) errors.push("packageId wurde nicht gefunden.");
    else if (initiative.approval_status === "rejected") errors.push("Deliverables können nicht in einer abgelehnten Initiative liegen.");
  }
  if (hasOwn(normalizedPatch, "parentTaskId")) {
    const parent = parents.get(String(normalizedPatch.parentTaskId || ""));
    if (!parent || parent.task_type !== "deliverable") errors.push("parentTaskId muss ein aktives Deliverable sein.");
    else if (isReviewStateLocked(parent.review_status, parent.score_final)) errors.push(reviewStateLockMessage(parent.review_status, parent.score_final));
  }
  if (hasOwn(normalizedPatch, "githubRepo")) {
    const githubRepository = resolveTaskGitHubRepository("sub_issue", String(normalizedPatch.githubRepo || ""));
    if (!githubRepository.ok) errors.push(githubRepository.error);
    if (!["ceo", "deputy"].includes(actor.platformRole)) errors.push("githubRepo darf nur von CEO oder Deputy geändert werden.");
    if (target.row.github_issue_number || target.row.github_issue_url || target.row.github_issue_sync_status !== "not_synced") {
      errors.push("githubRepo kann nur vor der GitHub-Synchronisierung geändert werden.");
    }
  }

  const resultingItem: UnknownRecord = { ...currentItem, ...normalizedPatch };
  if (String(resultingItem.startDate || "") && String(resultingItem.endDate || "") && String(resultingItem.startDate) > String(resultingItem.endDate)) {
    errors.push("Startdatum darf nicht nach dem Enddatum liegen.");
  }

  const systemEffects: PlanningItemSystemEffect[] = [];
  if (target.itemType === "deliverable" && hasOwn(normalizedPatch, "packageId")) {
    const initiative = initiatives.get(String(resultingItem.packageId || ""));
    const nextMilestoneId = String(initiative?.milestone_id || "");
    appendSystemEffect(systemEffects, "milestoneId", currentItem.milestoneId, nextMilestoneId, "Aus der gewählten Initiative abgeleitet.");
    resultingItem.milestoneId = nextMilestoneId;
  }
  if (target.itemType === "sub_issue" && hasOwn(normalizedPatch, "parentTaskId")) {
    const parent = parents.get(String(resultingItem.parentTaskId || ""));
    const nextPackageId = String(parent?.package_id || "");
    const nextMilestoneId = String(parent?.milestone_id || "");
    appendSystemEffect(systemEffects, "packageId", currentItem.packageId, nextPackageId, "Vom Parent-Deliverable geerbt.");
    appendSystemEffect(systemEffects, "milestoneId", currentItem.milestoneId, nextMilestoneId, "Vom Parent-Deliverable geerbt.");
    resultingItem.packageId = nextPackageId;
    resultingItem.milestoneId = nextMilestoneId;
  }

  const changedFields = parsed.presentFields.filter((field) => !sameValue(currentItem[field], resultingItem[field]));
  if (target.itemType === "initiative" && changedFields.some((field) => initiativeMaterialFields.has(field))) {
    appendSystemEffect(systemEffects, "approvalStatus", currentItem.approvalStatus, "proposed", "Materielle Initiative-Änderung benötigt eine neue Freigabe.");
    appendSystemEffect(systemEffects, "approvalRevision", currentItem.approvalRevision, Number(currentItem.approvalRevision || 1) + 1, "Neue Freigabe-Revision.");
    resultingItem.approvalStatus = "proposed";
    resultingItem.approvalRevision = Number(currentItem.approvalRevision || 1) + 1;
  }
  if (target.itemType === "deliverable" && changedFields.some((field) => deliverableMaterialFields.has(field))) {
    appendSystemEffect(systemEffects, "approvalStatus", currentItem.approvalStatus, "proposed", "Materielle Deliverable-Änderung benötigt eine neue Freigabe.");
    appendSystemEffect(systemEffects, "approvalRevision", currentItem.approvalRevision, Number(currentItem.approvalRevision || 1) + 1, "Neue Freigabe-Revision.");
    appendSystemEffect(systemEffects, "sprintId", currentItem.sprintId, "", "Freigabewechsel entfernt die Sprint-Zuordnung.");
    appendSystemEffect(systemEffects, "reviewStatus", currentItem.reviewStatus, "not_requested", "Freigabewechsel beendet den laufenden Review-Zustand.");
    appendSystemEffect(systemEffects, "scorePoints", currentItem.scorePoints, 0, "Freigabewechsel setzt den Score zurück.");
    appendSystemEffect(systemEffects, "scoreFinal", currentItem.scoreFinal, false, "Freigabewechsel setzt den finalen Score zurück.");
    resultingItem.approvalStatus = "proposed";
    resultingItem.approvalRevision = Number(currentItem.approvalRevision || 1) + 1;
    resultingItem.sprintId = "";
    resultingItem.reviewStatus = "not_requested";
    resultingItem.scorePoints = 0;
    resultingItem.scoreFinal = false;
    resultingItem.scoreRelevant = false;
  }
  if ((target.itemType === "deliverable" || target.itemType === "sub_issue") && changedFields.length) {
    appendSystemEffect(systemEffects, "githubIssueSyncStatus", currentItem.githubIssueSyncStatus, "not_synced", "Planungsänderung markiert die GitHub-Projektion als erneut zu synchronisieren.");
    resultingItem.githubIssueSyncStatus = "not_synced";
  }

  const dbPatch = buildDbPatch(target.itemType, changedFields, resultingItem);
  const warnings = changedFields.length ? [] : ["Die normalisierte Änderung entspricht dem aktuellen Stand."];
  return {
    ok: true,
    preview: {
      itemId,
      itemType: target.itemType,
      expectedUpdatedAt: parsed.expectedUpdatedAt,
      currentItem,
      normalizedPatch,
      resultingItem,
      changedFields,
      systemEffects,
      warnings,
      errors,
      dbPatch,
    },
  };
}
