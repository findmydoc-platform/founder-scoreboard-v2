import { taskStatuses } from "@/lib/status";
import type { getServerSupabase } from "@/lib/supabase";
import type { AuthenticatedProfile, TaskStatus } from "@/lib/types";
import type { TaskIntakeInput } from "@/features/intake/model/task-intake";
import {
  TEAM_TASK_INTAKE_INPUT_KEYS,
  TEAM_TASK_INTAKE_MAX_TASKS,
  type TeamTaskIntakeTaskType,
} from "@/features/intake/model/team-task-intake-contract";
import {
  intakeDate,
  intakeHours,
  intakePriority,
  intakeProfileByValue,
  intakeText,
  normalizeTaskIntakeBrief,
} from "@/features/intake/model/task-intake-normalization";
import {
  canCreateTeamSubIssueUnderDeliverable,
  isAllowedTeamTaskIntakeTaskType,
} from "@/features/intake/model/team-task-intake-policy";

type SupabaseServer = NonNullable<ReturnType<typeof getServerSupabase>>;

type TeamIntakeProfileRow = {
  id: string;
  name: string;
  githubLogin: string;
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
  taskType: TeamTaskIntakeTaskType;
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

const subIssueStatuses = new Set<TaskStatus>(taskStatuses.filter((status) => status !== "Vorschlag"));
const allowedInputKeys = new Set<string>(TEAM_TASK_INTAKE_INPUT_KEYS);

export function parseTeamTaskIntakePayload(payload: unknown):
  | { ok: true; tasks: TaskIntakeInput[] }
  | { ok: false; error: string } {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
    return { ok: false, error: "Payload muss ein Objekt mit dem Feld tasks sein." };
  }
  const unsupportedPayloadKey = Object.keys(payload).find((key) => key !== "tasks");
  if (unsupportedPayloadKey) return { ok: false, error: `Payload enthält das unbekannte Feld ${unsupportedPayloadKey}.` };
  const tasks = (payload as { tasks?: unknown }).tasks;
  if (!Array.isArray(tasks)) return { ok: false, error: "Payload muss ein tasks-Array enthalten." };

  for (const [index, task] of tasks.entries()) {
    if (!task || typeof task !== "object" || Array.isArray(task)) {
      return { ok: false, error: `Aufgabe ${index + 1} muss ein Objekt sein.` };
    }
    const unsupportedKey = Object.keys(task).find((key) => !allowedInputKeys.has(key));
    if (unsupportedKey) return { ok: false, error: `Aufgabe ${index + 1} enthält das unbekannte Feld ${unsupportedKey}.` };
  }

  return { ok: true, tasks: tasks as TaskIntakeInput[] };
}

export function canonicalTeamTaskIntakeRequest(rawTasks: TaskIntakeInput[]) {
  return rawTasks.map((rawTask) => {
    const brief = normalizeTaskIntakeBrief(rawTask);
    return {
      ...brief,
      taskType: intakeText(rawTask.taskType, 40) || "proposal",
      parentTaskId: intakeText(rawTask.parentTaskId, 120),
      packageId: intakeText(rawTask.packageId, 120),
      milestoneId: intakeText(rawTask.milestoneId, 120),
      sprintId: intakeText(rawTask.sprintId, 120),
      assignee: intakeText(rawTask.assignee, 120),
      owner: intakeText(rawTask.owner, 120),
      priority: intakePriority(rawTask.priority),
      status: intakeText(rawTask.status, 40),
      workstream: intakeText(rawTask.workstream, 120),
      startDate: intakeDate(rawTask.startDate),
      endDate: intakeDate(rawTask.endDate),
      deadline: intakeDate(rawTask.deadline),
      hours: intakeHours(rawTask.hours),
    };
  });
}

export async function loadTeamTaskIntakeContext(
  supabase: SupabaseServer,
  rawTasks: TaskIntakeInput[],
): Promise<TeamTaskIntakeContext> {
  const parentTaskIds = [...new Set(rawTasks
    .map((task) => intakeText(task.parentTaskId, 120))
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
    profiles: (profilesResult.data || []).map((profile) => ({
      id: profile.id,
      name: profile.name,
      githubLogin: profile.github_login || "",
    })),
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
    const brief = normalizeTaskIntakeBrief(rawTask);
    const requestedType = intakeText(rawTask.taskType, 40) || "proposal";
    const taskType = isAllowedTeamTaskIntakeTaskType(requestedType) ? requestedType : "proposal";
    if (!isAllowedTeamTaskIntakeTaskType(requestedType)) errors.push("Team Intake erlaubt nur Vorschläge und Sub-Issues.");

    const title = brief.title;
    if (title.length < 3) errors.push("Titel ist erforderlich.");

    const requestedParentTaskId = intakeText(rawTask.parentTaskId, 120);
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

    const requestedPackageId = intakeText(rawTask.packageId, 120);
    const inheritedPackageId = parentTask?.package_id || "";
    const packageId = taskType === "sub_issue" ? inheritedPackageId : requestedPackageId;
    const initiative = packageId ? context.initiatives.find((item) => item.id === packageId) || null : null;
    if (requestedPackageId && !context.initiatives.some((item) => item.id === requestedPackageId)) {
      errors.push(`Initiative wurde nicht gefunden: ${requestedPackageId}.`);
    }
    if (taskType === "sub_issue" && requestedPackageId && requestedPackageId !== inheritedPackageId) {
      errors.push("Sub-Issues übernehmen die Initiative ihres Deliverables.");
    }

    const requestedMilestoneId = intakeText(rawTask.milestoneId, 120);
    const inheritedMilestoneId = parentTask?.milestone_id || initiative?.milestone_id || "";
    const milestoneId = taskType === "sub_issue" ? inheritedMilestoneId : requestedMilestoneId || initiative?.milestone_id || "";
    if (requestedMilestoneId && !context.milestoneIds.has(requestedMilestoneId)) {
      errors.push(`Epic / Meilenstein wurde nicht gefunden: ${requestedMilestoneId}.`);
    }
    if (taskType === "sub_issue" && requestedMilestoneId && requestedMilestoneId !== inheritedMilestoneId) {
      errors.push("Sub-Issues übernehmen Epic / Meilenstein ihres Deliverables.");
    }

    if (intakeText(rawTask.sprintId, 120)) errors.push("Team Intake erlaubt keine Sprint-Zuordnung.");

    const requestedOwner = intakeText(rawTask.assignee, 120) || intakeText(rawTask.owner, 120);
    const ownerProfile = intakeProfileByValue(context.profiles, requestedOwner || (taskType === "sub_issue" ? actor.id : ""));
    if (requestedOwner && !ownerProfile) errors.push(`Zuständige Person wurde nicht gefunden: ${requestedOwner}.`);

    const requestedStatus = intakeText(rawTask.status, 40);
    const status: TaskStatus = taskType === "proposal"
      ? "Vorschlag"
      : subIssueStatuses.has(requestedStatus as TaskStatus)
        ? requestedStatus as TaskStatus
        : "Offen";
    if (taskType === "sub_issue" && requestedStatus && status !== requestedStatus) {
      warnings.push(`Status auf Offen gesetzt, weil ${requestedStatus} für Sub-Issues ungültig ist.`);
    }

    const priority = intakePriority(rawTask.priority);
    const startDate = intakeDate(rawTask.startDate);
    const endDate = intakeDate(rawTask.endDate);
    if (startDate && endDate && startDate > endDate) errors.push("Startdatum darf nicht nach dem Enddatum liegen.");

    return {
      clientId: `team-intake-${index + 1}`,
      title,
      description: brief.description,
      problemStatement: brief.problemStatement,
      intendedOutcome: brief.intendedOutcome,
      scopeConstraints: brief.scopeConstraints,
      acceptanceCriteria: brief.acceptanceCriteria,
      evidenceRequired: brief.evidenceRequired,
      definitionOfDone: brief.definitionOfDone,
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
      workstream: intakeText(rawTask.workstream, 120),
      startDate,
      endDate,
      deadline: intakeDate(rawTask.deadline),
      hours: intakeHours(rawTask.hours),
      scoreRelevant: false,
      errors,
      warnings,
    };
  });
}

export function teamTaskIntakePreviewIsValid(preview: TeamTaskIntakePreviewTask[]) {
  return preview.every((task) => task.errors.length === 0);
}
