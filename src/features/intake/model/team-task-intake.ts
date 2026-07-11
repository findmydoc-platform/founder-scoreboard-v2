import { cleanText } from "@/lib/api-input";
import { isOperationalLeadRole } from "@/lib/platform";
import { normalizeLookup, slugify } from "@/lib/slug";
import { taskStatuses } from "@/lib/status";
import type { getServerSupabase } from "@/lib/supabase";
import type { AuthenticatedProfile, TaskStatus } from "@/lib/types";
import { parseTaskIntakePayload, type TaskIntakeInput } from "@/features/intake/model/task-intake";

type SupabaseServer = NonNullable<ReturnType<typeof getServerSupabase>>;

type TeamIntakeProfileRow = {
  id: string;
  name: string;
  github_login: string | null;
};

type TeamIntakeInitiativeRow = {
  id: string;
  title: string;
  milestone_id: string | null;
};

type TeamIntakeParentRow = {
  id: string;
  title: string;
  task_type: string | null;
  owner: string | null;
  assignee: string | null;
  package_id: string | null;
  milestone_id: string | null;
};

export type TeamTaskIntakeContext = {
  profiles: TeamIntakeProfileRow[];
  initiatives: TeamIntakeInitiativeRow[];
  milestoneIds: Set<string>;
  parentTasks: TeamIntakeParentRow[];
};

export type TeamTaskIntakePreviewTask = {
  clientId: string;
  title: string;
  description: string;
  problemStatement: string;
  intendedOutcome: string;
  scopeConstraints: string;
  acceptanceCriteria: string;
  evidenceRequired: string;
  definitionOfDone: string;
  taskType: "proposal" | "sub_issue";
  parentTaskId: string;
  parentTaskTitle: string;
  packageId: string;
  packageTitle: string;
  milestoneId: string;
  ownerId: string;
  ownerName: string;
  priority: string;
  status: TaskStatus;
  workstream: string;
  startDate: string;
  endDate: string;
  deadline: string;
  hours: number;
  scoreRelevant: false;
  errors: string[];
  warnings: string[];
};

export const TEAM_TASK_INTAKE_MAX_TASKS = 30;
export const TEAM_TASK_INTAKE_ALLOWED_TASK_TYPES = ["proposal", "sub_issue"] as const;

const priorities = new Set(["P0", "P1", "P2", "P3", "P4"]);
const allowedTaskTypes = new Set<string>(TEAM_TASK_INTAKE_ALLOWED_TASK_TYPES);
const subIssueStatuses = new Set<TaskStatus>(taskStatuses.filter((status) => status !== "Vorschlag"));

function valueAsText(value: unknown, maxLength: number) {
  if (Array.isArray(value)) return cleanText(value.map((item) => `- ${String(item)}`).join("\n"), maxLength);
  return cleanText(typeof value === "string" || typeof value === "number" ? String(value) : "", maxLength);
}

function isoDate(value: unknown) {
  const text = valueAsText(value, 20);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function profileByValue(profiles: TeamIntakeProfileRow[], value: string) {
  const normalized = normalizeLookup(value);
  const slug = slugify(value);
  return profiles.find((profile) => (
    normalizeLookup(profile.id) === normalized
    || normalizeLookup(profile.name) === normalized
    || normalizeLookup(profile.github_login || "") === normalized
    || normalizeLookup(profile.id) === slug
  )) || null;
}

export function validateTeamTaskIntakeBatchSize(taskCount: number) {
  if (taskCount <= 0) return "Keine Aufgaben im Payload gefunden.";
  if (taskCount > TEAM_TASK_INTAKE_MAX_TASKS) return `Maximal ${TEAM_TASK_INTAKE_MAX_TASKS} Aufgaben pro Intake.`;
  return "";
}

export function isAllowedTeamTaskIntakeTaskType(value: string): value is "proposal" | "sub_issue" {
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

export function parseTeamTaskIntakePayload(payload: unknown) {
  return parseTaskIntakePayload(payload);
}

export async function loadTeamTaskIntakeContext(
  supabase: SupabaseServer,
  rawTasks: TaskIntakeInput[],
): Promise<TeamTaskIntakeContext> {
  const parentTaskIds = [...new Set(rawTasks
    .map((task) => valueAsText(task.parentTaskId, 120))
    .filter(Boolean))];

  const [profilesResult, initiativesResult, milestonesResult, parentsResult] = await Promise.all([
    supabase.from("profiles").select("id,name,github_login").order("name"),
    supabase.from("packages").select("id,title,milestone_id").order("sort_order"),
    supabase.from("milestones").select("id"),
    parentTaskIds.length
      ? supabase.from("tasks").select("id,title,task_type,owner,assignee,package_id,milestone_id").in("id", parentTaskIds)
      : Promise.resolve({ data: [], error: null }),
  ]);

  const firstError = profilesResult.error || initiativesResult.error || milestonesResult.error || parentsResult.error;
  if (firstError) throw new Error(firstError.message);

  return {
    profiles: profilesResult.data || [],
    initiatives: initiativesResult.data || [],
    milestoneIds: new Set((milestonesResult.data || []).map((milestone) => milestone.id)),
    parentTasks: parentsResult.data || [],
  };
}

export function buildTeamTaskIntakePreview(
  rawTasks: TaskIntakeInput[],
  context: TeamTaskIntakeContext,
  actor: AuthenticatedProfile,
) {
  return rawTasks.slice(0, TEAM_TASK_INTAKE_MAX_TASKS).map((rawTask, index): TeamTaskIntakePreviewTask => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const requestedType = valueAsText(rawTask.taskType, 40) || "proposal";
    const taskType = isAllowedTeamTaskIntakeTaskType(requestedType) ? requestedType : "proposal";
    if (!isAllowedTeamTaskIntakeTaskType(requestedType)) errors.push("Team Intake erlaubt nur Vorschläge und Sub-Issues.");

    const title = valueAsText(rawTask.title, 240);
    if (title.length < 3) errors.push("Titel ist erforderlich.");

    const requestedParentTaskId = valueAsText(rawTask.parentTaskId, 120);
    const parentTask = requestedParentTaskId
      ? context.parentTasks.find((task) => task.id === requestedParentTaskId) || null
      : null;
    if (taskType === "sub_issue" && !requestedParentTaskId) errors.push("Sub-Issue braucht ein Deliverable.");
    if (requestedParentTaskId && !parentTask) errors.push(`Deliverable wurde nicht gefunden: ${requestedParentTaskId}.`);
    if (parentTask && parentTask.task_type !== "deliverable") errors.push("Sub-Issues können nur unter Deliverables erstellt werden.");
    const parentOwnerId = parentTask?.assignee || parentTask?.owner || null;
    if (taskType === "sub_issue" && parentTask && !canCreateTeamSubIssueUnderDeliverable({
      actorId: actor.id,
      actorRole: actor.platformRole,
      parentOwnerId,
    })) {
      errors.push("Founder können nur eigene Deliverables verfeinern.");
    }

    const requestedPackageId = valueAsText(rawTask.packageId, 120);
    const inheritedPackageId = parentTask?.package_id || "";
    const packageId = taskType === "sub_issue" ? inheritedPackageId : requestedPackageId;
    const initiative = packageId ? context.initiatives.find((item) => item.id === packageId) || null : null;
    if (requestedPackageId && !context.initiatives.some((item) => item.id === requestedPackageId)) {
      errors.push(`Initiative wurde nicht gefunden: ${requestedPackageId}.`);
    }
    if (taskType === "sub_issue" && requestedPackageId && requestedPackageId !== inheritedPackageId) {
      errors.push("Sub-Issues übernehmen die Initiative ihres Deliverables.");
    }

    const requestedMilestoneId = valueAsText(rawTask.milestoneId, 120);
    const inheritedMilestoneId = parentTask?.milestone_id || initiative?.milestone_id || "";
    const milestoneId = taskType === "sub_issue" ? inheritedMilestoneId : requestedMilestoneId || initiative?.milestone_id || "";
    if (requestedMilestoneId && !context.milestoneIds.has(requestedMilestoneId)) {
      errors.push(`Epic / Meilenstein wurde nicht gefunden: ${requestedMilestoneId}.`);
    }
    if (taskType === "sub_issue" && requestedMilestoneId && requestedMilestoneId !== inheritedMilestoneId) {
      errors.push("Sub-Issues übernehmen Epic / Meilenstein ihres Deliverables.");
    }

    if (valueAsText(rawTask.sprintId, 120)) errors.push("Team Intake erlaubt keine Sprint-Zuordnung.");

    const requestedOwner = valueAsText(rawTask.assignee, 120) || valueAsText(rawTask.owner, 120);
    const ownerProfile = profileByValue(context.profiles, requestedOwner || (taskType === "sub_issue" ? actor.id : ""));
    if (requestedOwner && !ownerProfile) errors.push(`Zuständige Person wurde nicht gefunden: ${requestedOwner}.`);

    const requestedStatus = valueAsText(rawTask.status, 40);
    const status: TaskStatus = taskType === "proposal"
      ? "Vorschlag"
      : subIssueStatuses.has(requestedStatus as TaskStatus)
        ? requestedStatus as TaskStatus
        : "Offen";
    if (taskType === "sub_issue" && requestedStatus && status !== requestedStatus) {
      warnings.push(`Status auf Offen gesetzt, weil ${requestedStatus} für Sub-Issues ungültig ist.`);
    }

    const priorityText = valueAsText(rawTask.priority, 10);
    const priority = priorities.has(priorityText) ? priorityText : "P2";
    const startDate = isoDate(rawTask.startDate);
    const endDate = isoDate(rawTask.endDate);
    if (startDate && endDate && startDate > endDate) errors.push("Startdatum darf nicht nach dem Enddatum liegen.");

    return {
      clientId: `team-intake-${index + 1}`,
      title,
      description: valueAsText(rawTask.description, 4000),
      problemStatement: valueAsText(rawTask.problemStatement, 4000),
      intendedOutcome: valueAsText(rawTask.intendedOutcome, 4000),
      scopeConstraints: valueAsText(rawTask.scopeConstraints, 4000),
      acceptanceCriteria: valueAsText(rawTask.acceptanceCriteria, 6000),
      evidenceRequired: valueAsText(rawTask.evidenceRequired, 4000),
      definitionOfDone: valueAsText(rawTask.definitionOfDone, 4000),
      taskType,
      parentTaskId: taskType === "sub_issue" ? requestedParentTaskId : "",
      parentTaskTitle: parentTask?.title || "",
      packageId,
      packageTitle: initiative?.title || "",
      milestoneId,
      ownerId: ownerProfile?.id || "",
      ownerName: ownerProfile?.name || "",
      priority,
      status,
      workstream: valueAsText(rawTask.workstream, 120),
      startDate,
      endDate,
      deadline: isoDate(rawTask.deadline),
      hours: Math.max(0, Math.min(200, Math.round(Number(rawTask.hours || 0)))),
      scoreRelevant: false,
      errors,
      warnings,
    };
  });
}

export function teamTaskIntakePreviewIsValid(preview: TeamTaskIntakePreviewTask[]) {
  return preview.every((task) => task.errors.length === 0);
}

export function teamTaskIntakeActorCanReadContext(actor: AuthenticatedProfile) {
  return isOperationalLeadRole(actor.platformRole) || actor.platformRole === "founder";
}
