import { cleanText } from "@/lib/api-input";
import { taskStatuses } from "@/lib/status";
import type { TaskStatus, TaskType } from "@/lib/types";

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
  sprintIds: Set<string>;
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
  taskType: TaskType;
  parentTaskId: string;
  packageId: string;
  packageTitle: string;
  milestoneId: string;
  sprintId: string;
  ownerId: string;
  ownerName: string;
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

const priorities = new Set(["P0", "P1", "P2", "P3", "P4"]);
const taskTypes = new Set<TaskType>(["deliverable", "proposal", "sub_issue"]);

function valueAsText(value: unknown, maxLength: number) {
  if (Array.isArray(value)) {
    return cleanText(value.map((item) => `- ${String(item)}`).join("\n"), maxLength);
  }
  return cleanText(typeof value === "string" || typeof value === "number" ? String(value) : "", maxLength);
}

function profileId(value: string) {
  return value
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

function normalizeLookup(value: string) {
  return value.trim().toLowerCase();
}

function profileById(profiles: TaskIntakeProfile[], value: string) {
  const normalized = normalizeLookup(value);
  const slug = profileId(value);
  return profiles.find((profile) =>
    normalizeLookup(profile.id) === normalized ||
    normalizeLookup(profile.name) === normalized ||
    normalizeLookup(profile.githubLogin || "") === normalized ||
    normalizeLookup(profile.id) === slug
  ) || null;
}

function isoDate(value: unknown) {
  const text = valueAsText(value, 20);
  return /^\d{4}-\d{2}-\d{2}$/.test(text) ? text : "";
}

function ownerFromInitiative(initiative?: TaskIntakeInitiative) {
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
    const requestedType = valueAsText(rawTask.taskType, 40) || "deliverable";
    const taskType: TaskType = taskTypes.has(requestedType as TaskType) ? requestedType as TaskType : "deliverable";
    if (requestedType && !taskTypes.has(requestedType as TaskType)) errors.push(`Ungültiger Aufgabentyp: ${requestedType}.`);

    const title = valueAsText(rawTask.title, 240);
    if (title.length < 3) errors.push("Titel ist erforderlich.");

    const packageId = valueAsText(rawTask.packageId, 120);
    const initiative = context.initiatives.find((item) => item.id === packageId);
    if (taskType === "deliverable" && !packageId) errors.push("Deliverables brauchen eine Initiative.");
    if (packageId && !initiative) errors.push(`Initiative wurde nicht gefunden: ${packageId}.`);

    const requestedMilestoneId = valueAsText(rawTask.milestoneId, 120);
    const milestoneId = requestedMilestoneId || initiative?.milestoneId || "";
    if (requestedMilestoneId && !context.milestoneIds.has(requestedMilestoneId)) errors.push(`Epic / Meilenstein wurde nicht gefunden: ${requestedMilestoneId}.`);

    const sprintId = valueAsText(rawTask.sprintId, 120);
    if (taskType === "deliverable" && !sprintId) errors.push("Deliverables brauchen einen Sprint.");
    if (sprintId && !context.sprintIds.has(sprintId)) errors.push(`Sprint wurde nicht gefunden: ${sprintId}.`);

    const parentTaskId = valueAsText(rawTask.parentTaskId, 120);
    if (taskType === "sub_issue" && !parentTaskId) errors.push("Sub-Issues brauchen ein Deliverable.");
    if (parentTaskId && !context.parentTaskIds.has(parentTaskId)) errors.push(`Parent-Task wurde nicht gefunden: ${parentTaskId}.`);

    const requestedOwner = valueAsText(rawTask.owner, 120);
    const fallbackOwner = ownerFromInitiative(initiative);
    const ownerProfile = profileById(context.profiles, requestedOwner || fallbackOwner);
    if (requestedOwner && !ownerProfile) errors.push(`Assignee wurde nicht gefunden: ${requestedOwner}.`);
    if (!requestedOwner && !ownerProfile && taskType !== "proposal") errors.push("Assignee fehlt und konnte nicht aus der Initiative abgeleitet werden.");
    if (!requestedOwner && ownerProfile) warnings.push(`Assignee aus Initiative-RACI gesetzt: ${ownerProfile.name}.`);

    const reviewOwnerId = initiative?.accountableProfileId || initiative?.ownerId || "";
    const reviewOwnerProfile = reviewOwnerId ? profileById(context.profiles, reviewOwnerId) : null;
    if (taskType === "deliverable" && packageId && !reviewOwnerId) warnings.push("Ohne Review Owner: Initiative hat keinen Accountable oder Owner.");

    const requestedStatus = valueAsText(rawTask.status, 40);
    const status = taskType === "proposal"
      ? "Vorschlag"
      : taskStatuses.includes(requestedStatus as TaskStatus)
        ? requestedStatus as TaskStatus
        : "Offen";
    if (requestedStatus && status !== requestedStatus && taskType !== "proposal") warnings.push(`Status auf Offen gesetzt, weil ${requestedStatus} ungültig ist.`);

    const priority = priorities.has(valueAsText(rawTask.priority, 10)) ? valueAsText(rawTask.priority, 10) : "P2";
    const startDate = isoDate(rawTask.startDate);
    const endDate = isoDate(rawTask.endDate);
    const deadline = isoDate(rawTask.deadline);
    if (startDate && endDate && startDate > endDate) errors.push("Startdatum darf nicht nach dem Enddatum liegen.");

    return {
      clientId: `intake-${index + 1}`,
      title,
      description: valueAsText(rawTask.description, 4000),
      problemStatement: valueAsText(rawTask.problemStatement, 4000),
      intendedOutcome: valueAsText(rawTask.intendedOutcome, 4000),
      scopeConstraints: valueAsText(rawTask.scopeConstraints, 4000),
      acceptanceCriteria: valueAsText(rawTask.acceptanceCriteria, 6000),
      evidenceRequired: valueAsText(rawTask.evidenceRequired, 4000),
      definitionOfDone: valueAsText(rawTask.definitionOfDone, 4000),
      taskType,
      parentTaskId,
      packageId,
      packageTitle: initiative?.title || "",
      milestoneId,
      sprintId,
      ownerId: ownerProfile?.id || "",
      ownerName: ownerProfile?.name || "",
      priority,
      status,
      workstream: valueAsText(rawTask.workstream, 120),
      startDate,
      endDate,
      deadline,
      hours: Math.max(0, Math.min(200, Math.round(Number(rawTask.hours || 0)))),
      reviewOwnerProfileId: reviewOwnerId,
      reviewOwnerName: reviewOwnerProfile?.name || "",
      scoreRelevant: taskType === "deliverable",
      errors,
      warnings,
    };
  });
}
