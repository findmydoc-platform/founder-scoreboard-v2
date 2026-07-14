import { createHash } from "node:crypto";
import type { AuthenticatedProfile } from "@/lib/types";
import { ACTIVE_PACKAGES_TABLE, ACTIVE_TASKS_TABLE } from "@/lib/planning-read-model";
import type { getServerSupabase } from "@/lib/supabase";
import { defaultGitHubRepository, resolveTaskGitHubRepository } from "@/lib/github-repositories";
import {
  FOUNDEROPS_PLANNING_PROJECT_ID,
  TEAM_PLANNING_ITEMS_MAX_BATCH_SIZE,
  TEAM_PLANNING_ITEM_CREATE_FIELDS,
  TEAM_PLANNING_MILESTONE_STATUSES,
  TEAM_PLANNING_ITEM_TYPES,
  type TeamPlanningItemType,
} from "@/features/planning-items/model/planning-items-contract";
import {
  intakeDate,
  intakeHours,
  intakePriority,
  intakeStringList,
  intakeText,
} from "@/features/planning-items/model/planning-item-normalization";

type SupabaseServer = NonNullable<ReturnType<typeof getServerSupabase>>;

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
  packageId?: unknown;
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
  packageId?: string;
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
  errors: string[];
  warnings: string[];
};

const itemTypes = new Set<TeamPlanningItemType>(TEAM_PLANNING_ITEM_TYPES);
const inputKeys = new Set<string>(TEAM_PLANNING_ITEM_CREATE_FIELDS);
const milestoneStatuses = new Set<string>(TEAM_PLANNING_MILESTONE_STATUSES);
const milestoneCreateFields = new Set(["itemType", "title", "description", "targetDate", "status"]);

export function planningItemCreateRequiresOperationalLead(items: PlanningItemCreateInput[]) {
  return items.some((item) => intakeText(item.itemType, 40) === "milestone");
}

export function parsePlanningItemCreatePayload(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false as const, error: "Payload muss ein Objekt mit items sein." };
  }
  if (Object.keys(payload).some((key) => key !== "items")) {
    return { ok: false as const, error: "Payload enthält unbekannte Felder." };
  }
  const items = (payload as { items?: unknown }).items;
  if (!Array.isArray(items) || items.length < 1 || items.length > TEAM_PLANNING_ITEMS_MAX_BATCH_SIZE) {
    return { ok: false as const, error: "items muss 1 bis 30 Einträge enthalten." };
  }
  for (const [index, item] of items.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return { ok: false as const, error: `Eintrag ${index + 1} muss ein Objekt sein.` };
    }
    const unknownKey = Object.keys(item).find((key) => !inputKeys.has(key));
    if (unknownKey) {
      return { ok: false as const, error: `Eintrag ${index + 1} enthält das unbekannte Feld ${unknownKey}.` };
    }
  }
  return { ok: true as const, items: items as PlanningItemCreateInput[] };
}

export async function buildPlanningItemCreatePreview(
  items: PlanningItemCreateInput[],
  actor: AuthenticatedProfile,
  supabase: SupabaseServer,
) {
  const [profilesResult, initiativesResult, milestonesResult, parentsResult] = await Promise.all([
    supabase.from("profiles").select("id,name"),
    supabase.from(ACTIVE_PACKAGES_TABLE).select("id,title,milestone_id,approval_status"),
    supabase.from("milestones").select("id").eq("project_id", FOUNDEROPS_PLANNING_PROJECT_ID),
    supabase.from(ACTIVE_TASKS_TABLE).select("id,title,task_type,package_id,milestone_id,approval_status"),
  ]);
  if (profilesResult.error || initiativesResult.error || milestonesResult.error || parentsResult.error) {
    throw new Error("Planning-Items-Kontext konnte nicht geladen werden.");
  }

  const profileIds = new Set((profilesResult.data || []).map((profile) => profile.id));
  const initiatives = new Map((initiativesResult.data || []).map((initiative) => [initiative.id, initiative]));
  const milestoneIds = new Set((milestonesResult.data || []).map((milestone) => milestone.id));
  const parents = new Map((parentsResult.data || []).map((task) => [task.id, task]));

  return items.map((raw, index): PlanningItemCreatePreviewItem => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const requestedType = intakeText(raw.itemType, 40);
    const itemType = itemTypes.has(requestedType as TeamPlanningItemType)
      ? requestedType as TeamPlanningItemType
      : "deliverable";
    if (!itemTypes.has(requestedType as TeamPlanningItemType)) {
      errors.push("itemType muss milestone, initiative, deliverable oder sub_issue sein.");
    }

    const title = intakeText(raw.title, 240);
    if (title.length < 3) errors.push("Titel ist erforderlich.");
    let packageId = intakeText(raw.packageId, 120);
    let milestoneId = intakeText(raw.milestoneId, 120);
    const parentTaskId = intakeText(raw.parentTaskId, 120);
    const parent = parentTaskId ? parents.get(parentTaskId) : null;

    if (itemType === "initiative" && !["ceo", "deputy"].includes(actor.platformRole)) {
      errors.push("Nur CEO oder Deputy können Initiativen vorschlagen.");
    }
    if (itemType === "milestone" && !["ceo", "deputy"].includes(actor.platformRole)) {
      errors.push("Nur CEO oder Deputy können Meilensteine anlegen.");
    }
    if (itemType === "milestone") {
      for (const field of Object.keys(raw)) {
        if (!milestoneCreateFields.has(field)) errors.push(`${field} ist für milestone nicht zulässig.`);
      }
    } else {
      if (raw.targetDate !== undefined) errors.push(`targetDate ist für ${itemType} nicht zulässig.`);
      if (raw.status !== undefined) errors.push(`status ist für ${itemType} nicht zulässig.`);
    }
    if (itemType === "initiative" && (!milestoneId || !milestoneIds.has(milestoneId))) {
      errors.push("Initiative braucht einen gültigen Meilenstein.");
    }
    if (itemType === "deliverable") {
      const initiative = initiatives.get(packageId);
      if (!initiative) errors.push("Deliverable braucht eine gültige Initiative.");
      else if (initiative.approval_status === "rejected") errors.push("In einer abgelehnten Initiative können keine Deliverables vorgeschlagen werden.");
      milestoneId = milestoneId || initiative?.milestone_id || "";
    }
    if (itemType === "sub_issue") {
      if (!parent || parent.task_type !== "deliverable") errors.push("Sub-Issue braucht ein gültiges Parent-Deliverable.");
      packageId = parent?.package_id || "";
      milestoneId = parent?.milestone_id || "";
    }

    const targetDate = intakeDate(raw.targetDate);
    if (raw.targetDate !== undefined && raw.targetDate !== null && intakeText(raw.targetDate, 20) && !targetDate) {
      errors.push("targetDate muss ein gültiges Datum im Format YYYY-MM-DD sein.");
    }
    const requestedStatus = intakeText(raw.status, 40);
    const status = requestedStatus || "planned";
    if (itemType === "milestone" && !milestoneStatuses.has(status)) {
      errors.push("status muss planned, active oder done sein.");
    }
    if (itemType === "milestone") {
      return {
        clientId: `planning-items-create-${index + 1}`,
        itemType,
        title,
        description: intakeText(raw.description, 4_000),
        targetDate,
        status,
        approvalStatus: null,
        errors,
        warnings,
      };
    }

    const ownerId = intakeText(raw.ownerId, 120) || (itemType === "sub_issue" ? actor.id : "");
    if (ownerId && !profileIds.has(ownerId)) errors.push("Owner wurde nicht gefunden.");
    const accountableProfileId = intakeText(raw.accountableProfileId, 120) || ownerId;
    const responsibleProfileIds = intakeStringList(raw.responsibleProfileIds);
    if (itemType === "initiative" && (!accountableProfileId || !profileIds.has(accountableProfileId))) {
      errors.push("Initiative braucht einen gültigen Accountable.");
    }
    if (itemType === "initiative" && !responsibleProfileIds.length) {
      errors.push("Initiative braucht mindestens eine Responsible-Person.");
    }

    const requestedGitHubRepo = intakeText(raw.githubRepo, 120);
    const githubRepository = itemType === "initiative"
      ? { ok: true as const, repository: defaultGitHubRepository }
      : resolveTaskGitHubRepository(itemType, requestedGitHubRepo);
    if (!githubRepository.ok) errors.push(githubRepository.error);
    const githubRepo = githubRepository.ok ? githubRepository.repository : defaultGitHubRepository;

    const startDate = intakeDate(raw.startDate);
    const endDate = intakeDate(raw.endDate);
    if (startDate && endDate && startDate > endDate) {
      errors.push("Startdatum darf nicht nach dem Enddatum liegen.");
    }
    return {
      clientId: `planning-items-create-${index + 1}`,
      itemType,
      title,
      description: intakeText(raw.description, 4_000),
      problemStatement: intakeText(raw.problemStatement, 4_000),
      intendedOutcome: intakeText(raw.intendedOutcome, 4_000),
      scopeConstraints: intakeText(raw.scopeConstraints, 4_000),
      acceptanceCriteria: Array.isArray(raw.acceptanceCriteria)
        ? raw.acceptanceCriteria.map((value) => intakeText(value, 1_000)).filter(Boolean).join("\n")
        : intakeText(raw.acceptanceCriteria, 6_000),
      evidenceRequired: intakeText(raw.evidenceRequired, 4_000),
      definitionOfDone: intakeText(raw.definitionOfDone, 4_000),
      parentTaskId: itemType === "sub_issue" ? parentTaskId : "",
      packageId: itemType === "initiative" ? "" : packageId,
      milestoneId,
      ownerId,
      accountableProfileId,
      responsibleProfileIds,
      consultedProfileIds: intakeStringList(raw.consultedProfileIds),
      informedProfileIds: intakeStringList(raw.informedProfileIds),
      priority: intakePriority(raw.priority),
      workstream: intakeText(raw.workstream, 120),
      startDate,
      endDate,
      deadline: intakeDate(raw.deadline),
      hours: intakeHours(raw.hours),
      githubRepo,
      approvalStatus: itemType === "sub_issue" ? null : "proposed",
      scoreRelevant: false,
      errors,
      warnings,
    };
  });
}

export function planningItemCreateCommitItem(item: PlanningItemCreatePreviewItem) {
  const result = { ...item } as Partial<PlanningItemCreatePreviewItem>;
  delete result.errors;
  delete result.warnings;
  return result;
}

export function planningItemCreateHash(items: PlanningItemCreatePreviewItem[]) {
  return createHash("sha256")
    .update(JSON.stringify(items.map(planningItemCreateCommitItem)), "utf8")
    .digest("hex");
}
