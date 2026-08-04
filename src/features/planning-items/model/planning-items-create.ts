import { createHash } from "node:crypto";
import type { AuthenticatedProfile } from "@/lib/types";
import { ACTIVE_TASKS_TABLE } from "@/lib/planning-read-model";
import type { getServerSupabase } from "@/lib/supabase";
import { defaultGitHubRepository, resolveTaskGitHubRepository } from "@/lib/github-repositories";
import {
  FOUNDEROPS_PLANNING_PROJECT_ID,
  TEAM_PLANNING_ITEMS_MAX_BATCH_SIZE,
  TEAM_PLANNING_ITEM_CREATE_FIELDS,
  TEAM_PLANNING_ITEM_TYPES,
  TEAM_PLANNING_STRATEGIC_STATUSES,
  TEAM_PLANNING_SUB_ISSUE_STATUSES,
  TEAM_PLANNING_TASK_STATUSES,
  isStrategicPlanningItemType,
  normalizeTeamPlanningItemType,
  parsePlanningItemGitHubSyncCommand,
  parsePlanningItemGitHubSyncMode,
  type PlanningItemGitHubSyncCommand,
  type PlanningItemGitHubSyncResult,
  type TeamPlanningItemGitHubSyncMode,
  type TeamPlanningItemType,
} from "@/features/planning-items/model/planning-items-contract";
import { previewPlanningItemGitHubSync } from "@/features/planning-items/model/planning-items-github-sync-preview";
import {
  intakeDate,
  intakeHours,
  intakePriority,
  intakeStringList,
  intakeText,
} from "@/features/planning-items/model/planning-item-normalization";

type SupabaseServer = NonNullable<ReturnType<typeof getServerSupabase>>;

type ParentRow = {
  id: string;
  task_type: TeamPlanningItemType;
  approval_status: string | null;
  trashed_at: string | null;
};

type LegacyIdRow = {
  source_kind: "milestone" | "package";
  legacy_id: string;
  task_id: string;
};

export type PlanningItemCreateInput = {
  itemType?: unknown;
  title?: unknown;
  description?: unknown;
  problemStatement?: unknown;
  intendedOutcome?: unknown;
  scopeConstraints?: unknown;
  acceptanceCriteria?: unknown;
  evidenceRequired?: unknown;
  definitionOfDone?: unknown;
  parentTaskId?: unknown;
  /** @deprecated Resolves to a canonical Initiative parent. */
  packageId?: unknown;
  /** @deprecated Resolves to a canonical Epic parent. */
  milestoneId?: unknown;
  ownerId?: unknown;
  accountableProfileId?: unknown;
  responsibleProfileIds?: unknown;
  consultedProfileIds?: unknown;
  informedProfileIds?: unknown;
  priority?: unknown;
  workstream?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  deadline?: unknown;
  hours?: unknown;
  githubRepo?: unknown;
  targetDate?: unknown;
  status?: unknown;
  githubSync?: unknown;
};

export type PlanningItemCreatePreviewItem = {
  clientId: string;
  itemType: TeamPlanningItemType;
  title: string;
  description: string;
  problemStatement?: string;
  intendedOutcome?: string;
  scopeConstraints?: string;
  acceptanceCriteria?: string;
  evidenceRequired?: string;
  definitionOfDone?: string;
  parentTaskId?: string;
  /** Deprecated response compatibility only. */
  packageId?: string;
  /** Deprecated response compatibility only. */
  milestoneId?: string;
  ownerId?: string;
  accountableProfileId?: string;
  responsibleProfileIds?: string[];
  consultedProfileIds?: string[];
  informedProfileIds?: string[];
  priority?: string;
  workstream?: string;
  startDate?: string;
  endDate?: string;
  deadline?: string;
  hours?: number;
  githubRepo?: string;
  targetDate?: string;
  status?: string;
  approvalStatus: "proposed" | null;
  scoreRelevant?: false;
  githubSync?: PlanningItemGitHubSyncResult;
  errors: string[];
  warnings: string[];
};

const itemTypes = new Set<TeamPlanningItemType>(TEAM_PLANNING_ITEM_TYPES);
const inputKeys = new Set<string>([...TEAM_PLANNING_ITEM_CREATE_FIELDS, "githubSync"]);
const strategicStatuses = new Set<string>(TEAM_PLANNING_STRATEGIC_STATUSES);
const deliveryStatuses = new Set<string>(TEAM_PLANNING_TASK_STATUSES);
const subIssueStatuses = new Set<string>(TEAM_PLANNING_SUB_ISSUE_STATUSES);
const fieldsByType: Record<TeamPlanningItemType, Set<string>> = {
  epic: new Set(["itemType", "title", "description", "ownerId", "targetDate", "status"]),
  initiative: new Set([
    "itemType", "title", "description", "intendedOutcome", "scopeConstraints", "acceptanceCriteria",
    "parentTaskId", "milestoneId", "ownerId", "accountableProfileId", "responsibleProfileIds",
    "consultedProfileIds", "informedProfileIds", "priority", "targetDate", "status",
  ]),
  deliverable: new Set([
    "itemType", "title", "description", "problemStatement", "intendedOutcome", "scopeConstraints",
    "acceptanceCriteria", "evidenceRequired", "definitionOfDone", "parentTaskId", "packageId", "ownerId",
    "priority", "workstream", "startDate", "endDate", "deadline", "hours", "githubRepo", "status", "githubSync",
  ]),
  sub_issue: new Set([
    "itemType", "title", "description", "problemStatement", "intendedOutcome", "scopeConstraints",
    "acceptanceCriteria", "evidenceRequired", "definitionOfDone", "parentTaskId", "ownerId", "githubRepo", "status", "githubSync",
  ]),
};

function legacyStatus(value: string) {
  if (value === "planned") return "Offen";
  if (value === "active") return "In Arbeit";
  if (value === "done") return "Erledigt";
  return value;
}

function canonicalParentId(candidate: string, parents: Map<string, ParentRow>, legacyIds: Map<string, string>) {
  if (!candidate) return "";
  return parents.has(candidate) ? candidate : legacyIds.get(candidate) || candidate;
}

function normalizedStatus(itemType: TeamPlanningItemType, value: unknown, legacyType: boolean, errors: string[]) {
  const status = legacyType ? legacyStatus(intakeText(value, 40)) : intakeText(value, 40);
  const fallback = "Offen";
  const result = status || fallback;
  const allowed = itemType === "epic" || itemType === "initiative"
    ? strategicStatuses
    : itemType === "sub_issue"
      ? subIssueStatuses
      : deliveryStatuses;
  if (!allowed.has(result)) {
    errors.push(`status ist für ${itemType} nicht zulässig.`);
  }
  return result;
}

function normalizedTextList(value: unknown) {
  return intakeStringList(value, 120);
}

function itemTypeForInput(value: unknown) {
  const requested = intakeText(value, 40);
  return {
    requested,
    itemType: normalizeTeamPlanningItemType(requested),
    legacyType: requested === "milestone",
  };
}

export function planningItemCreateRequiresOperationalLead(items: PlanningItemCreateInput[]) {
  return items.some((item) => normalizeTeamPlanningItemType(intakeText(item.itemType, 40)) === "epic");
}

export function parsePlanningItemCreatePayload(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false as const, error: "Payload muss ein Objekt mit items sein." };
  }
  if (Object.keys(payload).some((key) => !["items", "githubSyncMode"].includes(key))) {
    return { ok: false as const, error: "Payload enthält unbekannte Felder." };
  }
  const items = (payload as { items?: unknown }).items;
  if (!Array.isArray(items) || items.length < 1 || items.length > TEAM_PLANNING_ITEMS_MAX_BATCH_SIZE) {
    return { ok: false as const, error: "items muss 1 bis 30 Einträge enthalten." };
  }
  const normalizedItems: PlanningItemCreateInput[] = [];
  let hasGitHubSync = false;
  for (const [index, item] of items.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return { ok: false as const, error: `Eintrag ${index + 1} muss ein Objekt sein.` };
    }
    const unknownKey = Object.keys(item).find((key) => !inputKeys.has(key));
    if (unknownKey) {
      return { ok: false as const, error: `Eintrag ${index + 1} enthält das unbekannte Feld ${unknownKey}.` };
    }
    const input = item as PlanningItemCreateInput;
    if (Object.hasOwn(input, "githubSync")) {
      const sync = parsePlanningItemGitHubSyncCommand(input.githubSync);
      if (!sync.ok) return { ok: false as const, error: `Eintrag ${index + 1}: ${sync.error}` };
      hasGitHubSync = true;
      normalizedItems.push({ ...input, githubSync: sync.command });
    } else {
      normalizedItems.push(input);
    }
  }
  const payloadRecord = payload as { githubSyncMode?: unknown };
  const hasMode = Object.hasOwn(payloadRecord, "githubSyncMode");
  const githubSyncMode = parsePlanningItemGitHubSyncMode(payloadRecord.githubSyncMode);
  if (hasGitHubSync && !githubSyncMode) {
    return { ok: false as const, error: "githubSyncMode muss bei GitHub-Sync async oder wait sein." };
  }
  if (!hasGitHubSync && hasMode) {
    return { ok: false as const, error: "githubSyncMode ist nur zusammen mit githubSync zulässig." };
  }
  return { ok: true as const, items: normalizedItems, githubSyncMode: githubSyncMode as TeamPlanningItemGitHubSyncMode | null };
}

export async function buildPlanningItemCreatePreview(
  items: PlanningItemCreateInput[],
  actor: AuthenticatedProfile,
  supabase: SupabaseServer,
) {
  const [profilesResult, parentsResult, legacyIdsResult] = await Promise.all([
    supabase.from("profiles").select("id,name"),
    supabase
      .from(ACTIVE_TASKS_TABLE)
      .select("id,task_type,approval_status,trashed_at")
      .eq("project_id", FOUNDEROPS_PLANNING_PROJECT_ID),
    supabase.from("planning_item_legacy_ids").select("source_kind,legacy_id,task_id"),
  ]);
  if (profilesResult.error || parentsResult.error || legacyIdsResult.error) {
    throw new Error("Planning-Items-Kontext konnte nicht geladen werden.");
  }

  const profileIds = new Set((profilesResult.data || []).map((profile) => profile.id));
  const parents = new Map((parentsResult.data || []).map((parent) => [parent.id, parent as ParentRow]));
  const legacyIds = new Map((legacyIdsResult.data || []).map((row) => [row.legacy_id, (row as LegacyIdRow).task_id]));

  return items.map((raw, index): PlanningItemCreatePreviewItem => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const type = itemTypeForInput(raw.itemType);
    const itemType = type.itemType || "deliverable";
    if (!type.itemType || !itemTypes.has(itemType)) {
      errors.push("itemType muss epic, initiative, deliverable oder sub_issue sein.");
    }
    for (const field of Object.keys(raw)) {
      if (!fieldsByType[itemType].has(field)) errors.push(`${field} ist für ${itemType} nicht zulässig.`);
    }
    if (Object.hasOwn(raw, "githubSync") && isStrategicPlanningItemType(itemType)) {
      errors.push("GitHub-Sync ist für Epic und Initiative nicht verfügbar.");
    }

    const title = intakeText(raw.title, 240);
    if (title.length < 3) errors.push("Titel ist erforderlich.");
    const description = intakeText(raw.description, 4_000);
    const ownerId = intakeText(raw.ownerId, 120) || (itemType === "sub_issue" ? actor.id : "");
    if ((itemType === "epic" || itemType === "initiative") && !ownerId) {
      errors.push(`${itemType === "epic" ? "Epic" : "Initiative"} braucht einen Owner.`);
    }
    if (ownerId && !profileIds.has(ownerId)) errors.push("Owner wurde nicht gefunden.");
    if (itemType === "epic" && !["ceo", "deputy"].includes(actor.platformRole)) {
      errors.push("Nur CEO oder Deputy können Epics anlegen.");
    }
    if (itemType === "initiative" && !["ceo", "deputy"].includes(actor.platformRole)) {
      errors.push("Nur CEO oder Deputy können Initiativen vorschlagen.");
    }

    const rawParentId = intakeText(raw.parentTaskId, 120)
      || (itemType === "initiative" ? intakeText(raw.milestoneId, 120) : "")
      || (itemType === "deliverable" ? intakeText(raw.packageId, 120) : "");
    const parentTaskId = canonicalParentId(rawParentId, parents, legacyIds);
    const parent = parentTaskId ? parents.get(parentTaskId) : null;
    if (itemType === "epic" && parentTaskId) errors.push("Epic darf keinen Parent haben.");
    if (itemType === "initiative" && parentTaskId && parent?.task_type !== "epic") {
      errors.push("Initiative braucht als Parent ein Epic.");
    }
    if (itemType === "deliverable" && parentTaskId) {
      if (parent?.task_type !== "initiative") errors.push("Deliverable braucht als Parent eine Initiative.");
      else if (parent.approval_status === "rejected") errors.push("Deliverables können nicht in einer abgelehnten Initiative liegen.");
    }
    if (itemType === "sub_issue") {
      if (!parent || parent.task_type !== "deliverable") errors.push("Sub-Issue braucht ein gültiges Parent-Deliverable.");
      else if (parent.approval_status !== "approved") errors.push("Sub-Issue braucht ein freigegebenes Parent-Deliverable.");
    }

    const targetDate = intakeDate(raw.targetDate);
    if (raw.targetDate !== undefined && raw.targetDate !== null && intakeText(raw.targetDate, 20) && !targetDate) {
      errors.push("targetDate muss ein gültiges Datum im Format YYYY-MM-DD sein.");
    }
    if (raw.targetDate !== undefined && itemType !== "epic" && itemType !== "initiative") {
      errors.push(`targetDate ist für ${itemType} nicht zulässig.`);
    }
    const status = normalizedStatus(itemType, raw.status, type.legacyType, errors);
    const startDate = intakeDate(raw.startDate);
    const endDate = intakeDate(raw.endDate);
    if (startDate && endDate && startDate > endDate) errors.push("Startdatum darf nicht nach dem Enddatum liegen.");

    const accountableProfileId = intakeText(raw.accountableProfileId, 120);
    const responsibleProfileIds = normalizedTextList(raw.responsibleProfileIds);
    const consultedProfileIds = normalizedTextList(raw.consultedProfileIds);
    const informedProfileIds = normalizedTextList(raw.informedProfileIds);
    for (const profileId of [accountableProfileId, ...responsibleProfileIds, ...consultedProfileIds, ...informedProfileIds]) {
      if (profileId && !profileIds.has(profileId)) errors.push("RACI enthält ein unbekanntes Profil.");
    }

    const requestedGitHubRepo = intakeText(raw.githubRepo, 120);
    const githubRepository = isStrategicPlanningItemType(itemType)
      ? { ok: true as const, repository: "" }
      : resolveTaskGitHubRepository(itemType === "sub_issue" ? "sub_issue" : "deliverable", requestedGitHubRepo);
    if (!githubRepository.ok) errors.push(githubRepository.error);
    const githubRepo = githubRepository.ok ? githubRepository.repository : defaultGitHubRepository;
    const githubSyncCommand = raw.githubSync as PlanningItemGitHubSyncCommand | undefined;
    const githubSync = githubSyncCommand && !isStrategicPlanningItemType(itemType)
      ? previewPlanningItemGitHubSync({
        itemType,
        approvalStatus: itemType === "deliverable" ? "proposed" : null,
        parentApprovalStatus: itemType === "sub_issue" ? parent?.approval_status : undefined,
      })
      : undefined;

    const preview: PlanningItemCreatePreviewItem = {
      clientId: `planning-items-create-${index + 1}`,
      itemType,
      title,
      description,
      parentTaskId,
      ownerId,
      status,
      approvalStatus: itemType === "initiative" || itemType === "deliverable" ? "proposed" : null,
      errors,
      warnings,
    };

    if (itemType === "epic" || itemType === "initiative") preview.targetDate = targetDate;

    if (itemType === "initiative") {
      Object.assign(preview, {
        intendedOutcome: intakeText(raw.intendedOutcome, 4_000) || description,
        scopeConstraints: intakeText(raw.scopeConstraints, 4_000),
        acceptanceCriteria: Array.isArray(raw.acceptanceCriteria)
          ? raw.acceptanceCriteria.map((value) => intakeText(value, 1_000)).filter(Boolean).join("\n")
          : intakeText(raw.acceptanceCriteria, 6_000),
        priority: intakePriority(raw.priority),
        accountableProfileId,
        responsibleProfileIds,
        consultedProfileIds,
        informedProfileIds,
      });
    }
    if (itemType === "deliverable" || itemType === "sub_issue") {
      Object.assign(preview, {
        problemStatement: intakeText(raw.problemStatement, 4_000),
        intendedOutcome: intakeText(raw.intendedOutcome, 4_000),
        scopeConstraints: intakeText(raw.scopeConstraints, 4_000),
        acceptanceCriteria: Array.isArray(raw.acceptanceCriteria)
          ? raw.acceptanceCriteria.map((value) => intakeText(value, 1_000)).filter(Boolean).join("\n")
          : intakeText(raw.acceptanceCriteria, 6_000),
        evidenceRequired: intakeText(raw.evidenceRequired, 4_000),
        definitionOfDone: intakeText(raw.definitionOfDone, 4_000),
        githubRepo,
        scoreRelevant: false,
      });
      if (itemType === "deliverable") {
        Object.assign(preview, {
          priority: intakePriority(raw.priority),
          workstream: intakeText(raw.workstream, 120),
          startDate,
          endDate,
          deadline: intakeText(raw.deadline, 120),
          hours: intakeHours(raw.hours),
        });
      }
    }
    if (githubSync) preview.githubSync = githubSync;
    return preview;
  });
}

export function planningItemCreateCommitItem(item: PlanningItemCreatePreviewItem) {
  const result = { ...item } as Partial<PlanningItemCreatePreviewItem>;
  delete result.errors;
  delete result.warnings;
  delete result.githubSync;
  delete result.packageId;
  delete result.milestoneId;
  return result;
}

export function planningItemCreateHash(
  items: PlanningItemCreatePreviewItem[],
  githubSyncMode: TeamPlanningItemGitHubSyncMode | null = null,
  githubSyncCommands: Array<PlanningItemGitHubSyncCommand | null> = [],
) {
  const committedItems = items.map(planningItemCreateCommitItem);
  const hashInput = githubSyncMode || githubSyncCommands.some(Boolean)
    ? { items: committedItems, githubSyncMode, githubSyncCommands }
    : committedItems;
  return createHash("sha256").update(JSON.stringify(hashInput), "utf8").digest("hex");
}

export function planningItemCreateGitHubSyncCommands(items: PlanningItemCreateInput[]) {
  return items.map((item) => {
    const itemType = normalizeTeamPlanningItemType(intakeText(item.itemType, 40));
    return itemType && !isStrategicPlanningItemType(itemType) && Object.hasOwn(item, "githubSync")
      ? item.githubSync as PlanningItemGitHubSyncCommand
      : null;
  });
}
