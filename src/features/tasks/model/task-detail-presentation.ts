import { normalizeStatus } from "@/lib/status";
import type {
  Task,
  TaskActivity,
  TaskComment,
  TaskExternalComment,
  TaskRelation,
} from "@/lib/types";

export type TaskDetailTabId = "overview" | "sub-issues" | "relationships" | "activity";

export type TaskOverviewDraft = {
  title: string;
  problemStatement: string;
  intendedOutcome: string;
  scopeConstraints: string;
  acceptanceCriteria: string;
  evidenceRequired: string;
  evidenceLink: string;
  definitionOfDone: string;
  note: string;
};

export type TaskOverviewEditPermissions = {
  canEditBrief: boolean;
  canEditChecklist: boolean;
  canEditEvidence: boolean;
  canEditNotes: boolean;
};

export type QuickSubIssueDraft = {
  assignee: string;
  title: string;
};

function normalizedDraftValue(value?: string) {
  return (value || "").replaceAll("\r\n", "\n").trimEnd();
}

export function buildTaskOverviewDraft(task: Task): TaskOverviewDraft {
  return {
    title: task.title,
    problemStatement: task.problemStatement || task.description || "",
    intendedOutcome: task.intendedOutcome || "",
    scopeConstraints: task.scopeConstraints || "",
    acceptanceCriteria: task.acceptanceCriteria || "",
    evidenceRequired: task.evidenceRequired || "",
    evidenceLink: task.evidenceLink || "",
    definitionOfDone: task.definitionOfDone || "",
    note: task.note || "",
  };
}

export function taskOverviewPatch(
  task: Task,
  draft: TaskOverviewDraft,
  permissions: TaskOverviewEditPermissions,
): Partial<Task> {
  const baseline = buildTaskOverviewDraft(task);
  const patch: Partial<Task> = {};

  const assignWhenChanged = <Key extends keyof TaskOverviewDraft>(key: Key) => {
    if (normalizedDraftValue(draft[key]) !== normalizedDraftValue(baseline[key])) {
      Object.assign(patch, { [key]: draft[key] });
    }
  };

  if (permissions.canEditBrief) {
    assignWhenChanged("title");
    assignWhenChanged("problemStatement");
    assignWhenChanged("intendedOutcome");
    assignWhenChanged("scopeConstraints");
    assignWhenChanged("evidenceRequired");
  }
  if (permissions.canEditChecklist) {
    assignWhenChanged("acceptanceCriteria");
    assignWhenChanged("definitionOfDone");
  }
  if (permissions.canEditEvidence) assignWhenChanged("evidenceLink");
  if (permissions.canEditNotes) assignWhenChanged("note");

  return patch;
}

export function taskOverviewIsDirty(
  task: Task,
  draft: TaskOverviewDraft,
  permissions: TaskOverviewEditPermissions,
) {
  return Object.keys(taskOverviewPatch(task, draft, permissions)).length > 0;
}

export function partitionSubIssues(subIssues: Task[]) {
  const open: Task[] = [];
  const completed: Task[] = [];

  subIssues.forEach((task) => {
    if (normalizeStatus(task.status) === "Erledigt") completed.push(task);
    else open.push(task);
  });

  return { open, completed };
}

export function uniqueRelationshipCount(
  ...groups: Array<Array<{ relation: TaskRelation; task?: Task }>>
) {
  const ids = new Set<number>();
  groups.flat().forEach(({ relation }) => ids.add(relation.id));
  return ids.size;
}

export function repairTaskActivityText(value: string) {
  return value
    .replace(new RegExp("\u00c3\u00a4", "g"), "ä")
    .replace(new RegExp("\u00c3\u00b6", "g"), "ö")
    .replace(new RegExp("\u00c3\u00bc", "g"), "ü")
    .replace(new RegExp("\u00c3\u0084", "g"), "Ä")
    .replace(new RegExp("\u00c3\u0096", "g"), "Ö")
    .replace(new RegExp("\u00c3\u009c", "g"), "Ü")
    .replace(new RegExp("\u00c3\u009f", "g"), "ß")
    .replace(new RegExp("\u00c2\u00b7", "g"), "·");
}

export function isUsefulTaskActivity(message: string) {
  const normalized = repairTaskActivityText(message).trim();
  if (!normalized || normalized === "Aufgabe aktualisiert") return false;

  return [
    "Status geändert",
    "Review geändert",
    "Kommentar hinzugefügt",
    "GitHub-Sync",
    "GitHub-Kommentare importiert",
    "Blocker",
    "Relationship",
    "Sprint",
    "Priorität",
    "Evidence",
    "Zuständigkeit",
    "Assignee",
    "Owner",
    "Nacharbeit",
    "Anhang",
    "Aufgabenbrief",
    "Founder-Checkliste",
    "Fokus",
  ].some((prefix) => normalized.startsWith(prefix) || normalized.includes(prefix));
}

export function visibleTaskActivityCount({
  activities,
  comments,
  externalComments,
}: {
  activities: TaskActivity[];
  comments: TaskComment[];
  externalComments: TaskExternalComment[];
}) {
  return comments.length
    + externalComments.length
    + activities.filter((activity) => isUsefulTaskActivity(activity.message)).length;
}

export function safeEvidenceHost(value: string) {
  try {
    const url = new URL(value);
    if (url.protocol !== "http:" && url.protocol !== "https:") return "";
    return url.hostname.replace(/^www\./u, "");
  } catch {
    return "";
  }
}

export function buildQuickSubIssueCreationDraft({
  assignee,
  creationRequestId,
  parent,
  title,
}: QuickSubIssueDraft & {
  creationRequestId: string;
  parent: Task;
}) {
  return {
    creationRequestId,
    title: title.trim(),
    description: "",
    problemStatement: "",
    intendedOutcome: "",
    scopeConstraints: "",
    acceptanceCriteria: "",
    evidenceRequired: "",
    taskType: "sub_issue" as const,
    parentTaskId: parent.id,
    milestoneId: parent.milestoneId || "",
    packageId: parent.packageId,
    sprintId: "",
    assignee,
    priority: "P2",
    status: "Offen",
    workstream: parent.workstream || "",
    startDate: parent.startDate || "",
    endDate: parent.endDate || "",
    deadline: parent.deadline || "",
    hours: 2,
    definitionOfDone: "",
    createGitHubIssue: false,
    githubRepo: parent.githubRepo || "",
    approveNow: false,
    relationType: "blocked_by" as const,
    relatedTaskId: "",
    relationNote: "",
  };
}
