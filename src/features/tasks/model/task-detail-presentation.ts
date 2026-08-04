import { normalizeStatus } from "@/lib/status";
import type {
  Task,
  TaskActivity,
  TaskComment,
  TaskExternalComment,
  TaskRelation,
} from "@/lib/types";

export type TaskDetailTabId = "overview" | "relationships" | "activity";

export type TaskOverviewDraft = {
  title: string;
  description: string;
  problemStatement: string;
  intendedOutcome: string;
  scopeConstraints: string;
  acceptanceCriteria: string;
  evidenceRequired: string;
  evidenceLinks: string[];
  definitionOfDone: string;
  note: string;
  strategyGoal: string;
  strategySuccessCriteria: string;
  strategyScopeConstraints: string;
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

function normalizedEvidenceLinks(values: string[]) {
  return values.map((value) => value.trim()).filter(Boolean);
}

export function buildTaskOverviewDraft(task: Task): TaskOverviewDraft {
  return {
    title: task.title,
    description: task.description || "",
    problemStatement: task.problemStatement || (task.taskType === "deliverable" ? task.description || "" : ""),
    intendedOutcome: task.intendedOutcome || "",
    scopeConstraints: task.scopeConstraints || "",
    acceptanceCriteria: task.acceptanceCriteria || "",
    evidenceRequired: task.evidenceRequired || "",
    evidenceLinks: task.evidenceLinks?.length ? [...task.evidenceLinks] : task.evidenceLink ? [task.evidenceLink] : [],
    definitionOfDone: task.definitionOfDone || "",
    note: task.note || "",
    strategyGoal: task.strategy?.goal || "",
    strategySuccessCriteria: task.strategy?.successCriteria || "",
    strategyScopeConstraints: task.strategy?.scopeConstraints || "",
  };
}

export function taskOverviewPatch(
  task: Task,
  draft: TaskOverviewDraft,
  permissions: TaskOverviewEditPermissions,
): Partial<Task> {
  const baseline = buildTaskOverviewDraft(task);
  const patch: Partial<Task> = {};

  const assignWhenChanged = <Key extends Exclude<keyof TaskOverviewDraft, "evidenceLinks">>(key: Key) => {
    if (normalizedDraftValue(draft[key]) !== normalizedDraftValue(baseline[key])) {
      Object.assign(patch, { [key]: draft[key] });
    }
  };

  if (permissions.canEditBrief) {
    assignWhenChanged("title");
    if (task.taskType === "epic") {
      assignWhenChanged("description");
    } else if (task.taskType === "initiative") {
      assignWhenChanged("description");
      const baselineStrategy = buildTaskOverviewDraft(task);
      if (
        normalizedDraftValue(draft.strategyGoal) !== normalizedDraftValue(baselineStrategy.strategyGoal)
        || normalizedDraftValue(draft.strategySuccessCriteria) !== normalizedDraftValue(baselineStrategy.strategySuccessCriteria)
        || normalizedDraftValue(draft.strategyScopeConstraints) !== normalizedDraftValue(baselineStrategy.strategyScopeConstraints)
      ) {
        patch.strategy = {
          goal: draft.strategyGoal,
          successCriteria: draft.strategySuccessCriteria,
          scopeConstraints: draft.strategyScopeConstraints,
        };
      }
    } else if (task.taskType === "sub_issue") {
      assignWhenChanged("description");
      assignWhenChanged("problemStatement");
      assignWhenChanged("intendedOutcome");
      assignWhenChanged("scopeConstraints");
      assignWhenChanged("acceptanceCriteria");
      assignWhenChanged("evidenceRequired");
      assignWhenChanged("definitionOfDone");
    } else {
      assignWhenChanged("problemStatement");
      assignWhenChanged("intendedOutcome");
      assignWhenChanged("scopeConstraints");
      assignWhenChanged("evidenceRequired");
    }
  }
  if (permissions.canEditChecklist && task.taskType === "deliverable") {
    assignWhenChanged("acceptanceCriteria");
    assignWhenChanged("definitionOfDone");
  }
  if (permissions.canEditEvidence && task.taskType === "deliverable") {
    const nextEvidenceLinks = normalizedEvidenceLinks(draft.evidenceLinks);
    const baselineEvidenceLinks = normalizedEvidenceLinks(baseline.evidenceLinks);
    if (JSON.stringify(nextEvidenceLinks) !== JSON.stringify(baselineEvidenceLinks)) {
      patch.evidenceLinks = nextEvidenceLinks;
    }
  }
  if (permissions.canEditNotes && task.taskType === "deliverable") assignWhenChanged("note");

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
  groups: {
    waitsOn: Array<{ relation: TaskRelation; linkedTaskId: string; task?: Task }>;
    blocks: Array<{ relation: TaskRelation; linkedTaskId: string; task?: Task }>;
    related: Array<{ relation: TaskRelation; linkedTaskId: string; task?: Task }>;
  },
) {
  return groups.waitsOn.length + groups.blocks.length + groups.related.length;
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
    workstream: "",
    startDate: "",
    endDate: "",
    deadline: "",
    targetDate: "",
    hours: 0,
    definitionOfDone: "",
    createGitHubIssue: false,
    githubRepo: parent.githubRepo || "",
    approveNow: false,
    relationType: "blocked_by" as const,
    relatedTaskId: "",
    relationNote: "",
  };
}
