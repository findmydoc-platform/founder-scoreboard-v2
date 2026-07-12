import { createHash } from "node:crypto";
import type { AuthenticatedProfile } from "@/lib/types";
import type { getServerSupabase } from "@/lib/supabase";
import { defaultGitHubRepository, resolveTaskGitHubRepository } from "@/lib/github-repositories";
import { TEAM_TASK_INTAKE_MAX_TASKS } from "@/features/intake/model/team-task-intake-contract";
import { intakeDate, intakeHours, intakePriority, intakeStringList, intakeText } from "@/features/intake/model/task-intake-normalization";

type SupabaseServer = NonNullable<ReturnType<typeof getServerSupabase>>;
export type TeamTaskIntakeV2ItemType = "initiative" | "deliverable" | "sub_issue";

export type TeamTaskIntakeV2Input = {
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
};

export type TeamTaskIntakeV2PreviewItem = {
  clientId: string;
  itemType: TeamTaskIntakeV2ItemType;
  title: string;
  description: string;
  problemStatement: string;
  intendedOutcome: string;
  scopeConstraints: string;
  acceptanceCriteria: string;
  evidenceRequired: string;
  definitionOfDone: string;
  parentTaskId: string;
  packageId: string;
  milestoneId: string;
  ownerId: string;
  accountableProfileId: string;
  responsibleProfileIds: string[];
  consultedProfileIds: string[];
  informedProfileIds: string[];
  priority: string;
  workstream: string;
  startDate: string;
  endDate: string;
  deadline: string;
  hours: number;
  githubRepo: string;
  approvalStatus: "proposed" | null;
  scoreRelevant: false;
  errors: string[];
  warnings: string[];
};

const itemTypes = new Set<TeamTaskIntakeV2ItemType>(["initiative", "deliverable", "sub_issue"]);
const inputKeys = new Set<keyof TeamTaskIntakeV2Input>([
  "itemType", "title", "description", "problemStatement", "intendedOutcome", "scopeConstraints",
  "acceptanceCriteria", "evidenceRequired", "definitionOfDone", "parentTaskId", "packageId",
  "milestoneId", "ownerId", "accountableProfileId", "responsibleProfileIds", "consultedProfileIds",
  "informedProfileIds", "priority", "workstream", "startDate", "endDate", "deadline", "hours", "githubRepo",
]);

export function parseTeamTaskIntakeV2Payload(payload: unknown) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return { ok: false as const, error: "Payload muss ein Objekt mit items sein." };
  if (Object.keys(payload).some((key) => key !== "items")) return { ok: false as const, error: "Payload enthält unbekannte Felder." };
  const items = (payload as { items?: unknown }).items;
  if (!Array.isArray(items) || items.length < 1 || items.length > TEAM_TASK_INTAKE_MAX_TASKS) return { ok: false as const, error: "items muss 1 bis 30 Einträge enthalten." };
  for (const [index, item] of items.entries()) {
    if (!item || typeof item !== "object" || Array.isArray(item)) return { ok: false as const, error: `Eintrag ${index + 1} muss ein Objekt sein.` };
    const unknownKey = Object.keys(item).find((key) => !inputKeys.has(key as keyof TeamTaskIntakeV2Input));
    if (unknownKey) return { ok: false as const, error: `Eintrag ${index + 1} enthält das unbekannte Feld ${unknownKey}.` };
  }
  return { ok: true as const, items: items as TeamTaskIntakeV2Input[] };
}

export async function buildTeamTaskIntakeV2Preview(items: TeamTaskIntakeV2Input[], actor: AuthenticatedProfile, supabase: SupabaseServer) {
  const [profilesResult, initiativesResult, milestonesResult, parentsResult] = await Promise.all([
    supabase.from("profiles").select("id,name"),
    supabase.from("packages").select("id,title,milestone_id,approval_status"),
    supabase.from("milestones").select("id"),
    supabase.from("tasks").select("id,title,task_type,package_id,milestone_id,approval_status"),
  ]);
  if (profilesResult.error || initiativesResult.error || milestonesResult.error || parentsResult.error) throw new Error("Team Task Intake v2 context could not be loaded.");
  const profileIds = new Set((profilesResult.data || []).map((profile) => profile.id));
  const initiatives = new Map((initiativesResult.data || []).map((initiative) => [initiative.id, initiative]));
  const milestoneIds = new Set((milestonesResult.data || []).map((milestone) => milestone.id));
  const parents = new Map((parentsResult.data || []).map((task) => [task.id, task]));

  return items.map((raw, index): TeamTaskIntakeV2PreviewItem => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const requestedType = intakeText(raw.itemType, 40);
    const itemType = itemTypes.has(requestedType as TeamTaskIntakeV2ItemType) ? requestedType as TeamTaskIntakeV2ItemType : "deliverable";
    if (!itemTypes.has(requestedType as TeamTaskIntakeV2ItemType)) errors.push("itemType muss initiative, deliverable oder sub_issue sein.");
    const title = intakeText(raw.title, 240);
    if (title.length < 3) errors.push("Titel ist erforderlich.");
    let packageId = intakeText(raw.packageId, 120);
    let milestoneId = intakeText(raw.milestoneId, 120);
    const parentTaskId = intakeText(raw.parentTaskId, 120);
    const parent = parentTaskId ? parents.get(parentTaskId) : null;

    if (itemType === "initiative" && !["ceo", "deputy"].includes(actor.platformRole)) errors.push("Nur CEO oder Deputy können Initiativen vorschlagen.");
    if (itemType === "initiative" && (!milestoneId || !milestoneIds.has(milestoneId))) errors.push("Initiative braucht einen gültigen Meilenstein.");
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

    const ownerId = intakeText(raw.ownerId, 120) || (itemType === "sub_issue" ? actor.id : "");
    if (ownerId && !profileIds.has(ownerId)) errors.push("Owner wurde nicht gefunden.");
    const accountableProfileId = intakeText(raw.accountableProfileId, 120) || ownerId;
    const responsibleProfileIds = intakeStringList(raw.responsibleProfileIds);
    if (itemType === "initiative" && (!accountableProfileId || !profileIds.has(accountableProfileId))) errors.push("Initiative braucht einen gültigen Accountable.");
    if (itemType === "initiative" && !responsibleProfileIds.length) errors.push("Initiative braucht mindestens eine Responsible-Person.");
    const requestedGitHubRepo = intakeText(raw.githubRepo, 120);
    const githubRepository = itemType === "initiative"
      ? { ok: true as const, repository: defaultGitHubRepository }
      : resolveTaskGitHubRepository(itemType, requestedGitHubRepo);
    if (!githubRepository.ok) errors.push(githubRepository.error);
    const githubRepo = githubRepository.ok ? githubRepository.repository : defaultGitHubRepository;
    const startDate = intakeDate(raw.startDate);
    const endDate = intakeDate(raw.endDate);
    if (startDate && endDate && startDate > endDate) errors.push("Startdatum darf nicht nach dem Enddatum liegen.");

    return {
      clientId: `team-intake-v2-${index + 1}`,
      itemType,
      title,
      description: intakeText(raw.description, 4000),
      problemStatement: intakeText(raw.problemStatement, 4000),
      intendedOutcome: intakeText(raw.intendedOutcome, 4000),
      scopeConstraints: intakeText(raw.scopeConstraints, 4000),
      acceptanceCriteria: Array.isArray(raw.acceptanceCriteria) ? raw.acceptanceCriteria.map((value) => intakeText(value, 1000)).filter(Boolean).join("\n") : intakeText(raw.acceptanceCriteria, 6000),
      evidenceRequired: intakeText(raw.evidenceRequired, 4000),
      definitionOfDone: intakeText(raw.definitionOfDone, 4000),
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

export function teamTaskIntakeV2CommitItem(item: TeamTaskIntakeV2PreviewItem) {
  const result = { ...item } as Partial<TeamTaskIntakeV2PreviewItem>;
  delete result.errors;
  delete result.warnings;
  return result;
}

export function teamTaskIntakeV2Hash(items: TeamTaskIntakeV2PreviewItem[]) {
  return createHash("sha256").update(JSON.stringify(items.map(teamTaskIntakeV2CommitItem)), "utf8").digest("hex");
}
