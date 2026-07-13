import { taskStatuses } from "@/lib/status";
import type { TaskStatus } from "@/lib/types";

export type TaskIntakeType = "deliverable" | "sub_issue";
import {
  intakeDate,
  intakeHours,
  intakePriority,
  intakeProfileByValue,
  intakeText,
  normalizeTaskIntakeBrief,
} from "@/features/planning-items/model/planning-item-normalization";

export type TaskIntakeInput = {
  title?: unknown;
  description?: unknown;
  problemStatement?: unknown;
  intendedOutcome?: unknown;
  scopeConstraints?: unknown;
  acceptanceCriteria?: unknown;
  evidenceRequired?: unknown;
  definitionOfDone?: unknown;
  taskType?: unknown;
  parentTaskId?: unknown;
  packageId?: unknown;
  milestoneId?: unknown;
  sprintId?: unknown;
  assignee?: unknown;
  owner?: unknown;
  priority?: unknown;
  status?: unknown;
  workstream?: unknown;
  startDate?: unknown;
  endDate?: unknown;
  deadline?: unknown;
  hours?: unknown;
};

export type TaskIntakeProfile = {
  id: string;
  name: string;
  githubLogin?: string;
};

export type TaskIntakeInitiative = {
  id: string;
  title: string;
  milestoneId: string;
  ownerId: string;
  accountableProfileId: string;
  responsibleProfileIds: string[];
};

export type TaskIntakeContext = {
  profiles: TaskIntakeProfile[];
  initiatives: TaskIntakeInitiative[];
  milestoneIds: Set<string>;
  parentTaskIds: Set<string>;
};

export type TaskIntakePreviewTask = {
  clientId: string;
  title: string;
  description: string;
  problemStatement: string;
  intendedOutcome: string;
  scopeConstraints: string;
  acceptanceCriteria: string;
  evidenceRequired: string;
  definitionOfDone: string;
  taskType: TaskIntakeType;
  parentTaskId: string;
  packageId: string;
  packageTitle: string;
  milestoneId: string;
  sprintId: string;
  assigneeId: string;
  assigneeName: string;
  priority: string;
  status: TaskStatus;
  workstream: string;
  startDate: string;
  endDate: string;
  deadline: string;
  hours: number;
  reviewOwnerProfileId: string;
  reviewOwnerName: string;
  scoreRelevant: boolean;
  errors: string[];
  warnings: string[];
};

const taskTypes = new Set<TaskIntakeType>(["deliverable", "sub_issue"]);

function assigneeFromInitiative(initiative?: TaskIntakeInitiative) {
  return initiative?.responsibleProfileIds[0] || initiative?.ownerId || initiative?.accountableProfileId || "";
}

export function parseTaskIntakePayload(payload: unknown) {
  if (Array.isArray(payload)) return payload as TaskIntakeInput[];
  if (payload && typeof payload === "object" && Array.isArray((payload as { tasks?: unknown }).tasks)) {
    return (payload as { tasks: TaskIntakeInput[] }).tasks;
  }
  return [];
}

export function buildTaskIntakePreview(rawTasks: TaskIntakeInput[], context: TaskIntakeContext) {
  return rawTasks.slice(0, 30).map((rawTask, index): TaskIntakePreviewTask => {
    const errors: string[] = [];
    const warnings: string[] = [];
    const brief = normalizeTaskIntakeBrief(rawTask);
    const requestedType = intakeText(rawTask.taskType, 40) || "deliverable";
    const taskType: TaskIntakeType = taskTypes.has(requestedType as TaskIntakeType) ? requestedType as TaskIntakeType : "deliverable";
    if (requestedType && !taskTypes.has(requestedType as TaskIntakeType)) errors.push(`Ungültiger Aufgabentyp: ${requestedType}.`);

    const title = brief.title;
    if (title.length < 3) errors.push("Titel ist erforderlich.");

    const packageId = intakeText(rawTask.packageId, 120);
    const initiative = context.initiatives.find((item) => item.id === packageId);
    if (taskType === "deliverable" && !packageId) errors.push("Deliverables brauchen eine Initiative.");
    if (packageId && !initiative) errors.push(`Initiative wurde nicht gefunden: ${packageId}.`);

    const requestedMilestoneId = intakeText(rawTask.milestoneId, 120);
    const milestoneId = requestedMilestoneId || initiative?.milestoneId || "";
    if (requestedMilestoneId && !context.milestoneIds.has(requestedMilestoneId)) errors.push(`Epic / Meilenstein wurde nicht gefunden: ${requestedMilestoneId}.`);

    if (intakeText(rawTask.sprintId, 120)) warnings.push("Sprint-Zuordnung wird erst nach der Freigabe vorgenommen.");

    const parentTaskId = intakeText(rawTask.parentTaskId, 120);
    if (taskType === "sub_issue" && !parentTaskId) errors.push("Sub-Issues brauchen ein Deliverable.");
    if (parentTaskId && !context.parentTaskIds.has(parentTaskId)) errors.push(`Parent-Task wurde nicht gefunden: ${parentTaskId}.`);

    const requestedAssignee = intakeText(rawTask.assignee, 120) || intakeText(rawTask.owner, 120);
    const fallbackAssignee = assigneeFromInitiative(initiative);
    const assigneeProfile = intakeProfileByValue(context.profiles, requestedAssignee || fallbackAssignee);
    if (requestedAssignee && !assigneeProfile) errors.push(`Zuständige Person wurde nicht gefunden: ${requestedAssignee}.`);
    if (!requestedAssignee && !assigneeProfile) errors.push("Zuständigkeit fehlt und konnte nicht aus der Initiative abgeleitet werden.");
    if (!requestedAssignee && assigneeProfile) warnings.push(`Zuständigkeit aus Initiative-RACI gesetzt: ${assigneeProfile.name}.`);

    const reviewOwnerId = initiative?.accountableProfileId || initiative?.ownerId || "";
    const reviewOwnerProfile = reviewOwnerId ? intakeProfileByValue(context.profiles, reviewOwnerId) : null;
    if (taskType === "deliverable" && packageId && !reviewOwnerId) warnings.push("Ohne Review Owner: Initiative hat keinen Accountable oder Owner.");

    const requestedStatus = intakeText(rawTask.status, 40);
    const status = taskStatuses.includes(requestedStatus as TaskStatus)
      ? requestedStatus as TaskStatus
      : "Offen";
    if (requestedStatus && status !== requestedStatus) warnings.push(`Status auf Offen gesetzt, weil ${requestedStatus} ungültig ist.`);

    const priority = intakePriority(rawTask.priority);
    const startDate = intakeDate(rawTask.startDate);
    const endDate = intakeDate(rawTask.endDate);
    const deadline = intakeDate(rawTask.deadline);
    if (startDate && endDate && startDate > endDate) errors.push("Startdatum darf nicht nach dem Enddatum liegen.");

    return {
      clientId: `intake-${index + 1}`,
      title,
      description: brief.description,
      problemStatement: brief.problemStatement,
      intendedOutcome: brief.intendedOutcome,
      scopeConstraints: brief.scopeConstraints,
      acceptanceCriteria: brief.acceptanceCriteria,
      evidenceRequired: brief.evidenceRequired,
      definitionOfDone: brief.definitionOfDone,
      taskType,
      parentTaskId,
      packageId,
      packageTitle: initiative?.title || "",
      milestoneId,
      sprintId: "",
      assigneeId: assigneeProfile?.id || "",
      assigneeName: assigneeProfile?.name || "",
      priority,
      status,
      workstream: intakeText(rawTask.workstream, 120),
      startDate,
      endDate,
      deadline,
      hours: intakeHours(rawTask.hours),
      reviewOwnerProfileId: reviewOwnerId,
      reviewOwnerName: reviewOwnerProfile?.name || "",
      scoreRelevant: false,
      errors,
      warnings,
    };
  });
}
