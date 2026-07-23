import { Columns3, GanttChart, ListTree, Table2 } from "lucide-react";
import type { AppWorkspace } from "@/features/planning/model/workspace-routes";
import type { SprintPlanningOptions } from "@/features/sprint/model/sprint-planning-options";
import { mapScoreObjection as mapScoreObjectionResponse } from "@/lib/planning-data-mappers";
import { addDaysIso, sprintNumber } from "@/lib/planning-schedule";
import { DEFAULT_REVIEW_OBJECTION_WINDOW_HOURS, MAX_REVIEW_OBJECTION_WINDOW_HOURS, sprintReviewDueAt } from "@/lib/sprint-review-window";
import { DEFAULT_GITHUB_PROJECT_NUMBER, DEFAULT_GITHUB_PROJECT_OWNER, validGitHubProjectNumber, validGitHubProjectOwner } from "@/lib/github-project-config";
import { normalizeStatus, taskStatuses } from "@/lib/status";
export { profileColor } from "@/lib/profile-style";
import type { Package, PlanningData, Profile, Sprint, Task, TaskStatus, ViewMode } from "@/lib/types";

type Workspace = AppWorkspace;

export function normalizePlanningData(data: PlanningData): PlanningData {
  const storedReviewWindowHours = Number(data.project?.reviewObjectionWindowHours);
  const reviewObjectionWindowHours = Number.isInteger(storedReviewWindowHours)
    && storedReviewWindowHours >= 1
    && storedReviewWindowHours <= MAX_REVIEW_OBJECTION_WINDOW_HOURS
    ? storedReviewWindowHours
    : DEFAULT_REVIEW_OBJECTION_WINDOW_HOURS;
  const githubProjectOwner = validGitHubProjectOwner(data.project?.githubProjectOwner)
    ? data.project.githubProjectOwner
    : DEFAULT_GITHUB_PROJECT_OWNER;
  const githubProjectNumber = validGitHubProjectNumber(data.project?.githubProjectNumber)
    ? data.project.githubProjectNumber
    : DEFAULT_GITHUB_PROJECT_NUMBER;

  return {
    ...data,
    project: {
      ...data.project,
      reviewObjectionWindowHours,
      githubProjectOwner,
      githubProjectNumber,
    },
    profiles: data.profiles || [],
    packages: data.packages || [],
    milestones: data.milestones || [],
    tasks: data.tasks || [],
    sprints: data.sprints || [],
    sprintCommitments: data.sprintCommitments || [],
    founderSprintScores: data.founderSprintScores || [],
    founderStrikeStates: data.founderStrikeStates || [],
    strikeEvents: data.strikeEvents || [],
    scoreObjections: data.scoreObjections || [],
    taskComments: data.taskComments || [],
    taskExternalComments: data.taskExternalComments || [],
    taskBlockers: data.taskBlockers || [],
    taskRelations: data.taskRelations || [],
    taskActivity: data.taskActivity || [],
    taskReviews: data.taskReviews || [],
    taskFocusItems: data.taskFocusItems || [],
    notificationEvents: data.notificationEvents || [],
    notificationDeliveries: data.notificationDeliveries || [],
    notificationPreferences: data.notificationPreferences || [],
    profileUiPreferences: data.profileUiPreferences || [],
    profileFeatureTourAcknowledgements: data.profileFeatureTourAcknowledgements || [],
    fmdTools: data.fmdTools || [],
    events: data.events || [],
    meetings: data.meetings || [],
    meetingAttendance: data.meetingAttendance || [],
    audit: data.audit || [],
  };
}

export { mapScoreObjectionResponse };

export const viewTabs: Array<{ id: ViewMode; label: string; icon: typeof Columns3 }> = [
  { id: "board", label: "Board", icon: Columns3 },
  { id: "structure", label: "Struktur", icon: ListTree },
  { id: "table", label: "Tabelle", icon: Table2 },
  { id: "gantt", label: "Gantt", icon: GanttChart },
];

export const workspaceLabels: Record<Workspace, string> = {
  planning: "Projekt",
  backlog: "Backlog",
  "decision-log": "Decision Log",
  events: "Events",
  sprint: "Sprint & Score",
  projects: "Meilensteine & Initiativen",
  tools: "Quicklinks",
  team: "Team",
  notifications: "Notifications",
  profile: "Mein Profil",
};

export const workspaceDescriptions: Record<Workspace, string> = {
  planning: "Zeigt die Gesamtplanung mit Board, Struktur, Tabelle und Gantt.",
  backlog: "Priorisiert Aufgaben, bereitet Vorschläge vor und ordnet freigegebene Deliverables Sprints zu.",
  "decision-log": "Unternehmensentscheidungen · Notion ist die Quelle der Wahrheit.",
  events: "Zeigt wichtige Termine, Zielgruppen und Erinnerungen.",
  sprint: "Zeigt Weekly Updates, Punkte, Review-Reife und Sprintabschluss.",
  projects: "Zeigt Epics, Meilensteine, Initiativen und deren Fortschritt.",
  tools: "Zeigt kuratierte externe Links und weitere Linkziele für das Team.",
  team: "Zeigt Kapazitäten, Rollen und aktuelle Last pro Teammitglied.",
  notifications: "Persönliche Hinweise und Ausgang.",
  profile: "Zeigt deine persönlichen Einstellungen für Profil, Hinweise und Planungs-Defaults.",
};

export const planningWorkspaces: Workspace[] = ["planning"];

export const quickFilters = [
  { id: "my-reviews", label: "Meine Reviews" },
  { id: "open", label: "Offen" },
  { id: "critical", label: "Kritisch" },
  { id: "blocked", label: "Blockiert" },
  { id: "week", label: "Nächste 7 Tage" },
  { id: "high", label: "Hohe Priorität" },
  { id: "evidence", label: "Ohne Evidence" },
];

export function profileForAssigneeValue(profiles: Profile[], value?: string) {
  return profiles.find((profile) => profile.id === value || profile.name === value) || null;
}

export function taskAssigneePatch(assigneeValue: string, profiles: Profile[]): Partial<Task> {
  const profile = profileForAssigneeValue(profiles, assigneeValue);
  const assigneeId = profile?.id || "";
  const assignee = profile?.name || assigneeValue || "";
  return {
    assigneeId,
    assignee,
    ownerId: assigneeId,
    owner: assignee,
  };
}

export function createTaskDragPreview(source: HTMLElement, pointerX: number, pointerY: number) {
  const rect = source.getBoundingClientRect();
  const preview = source.cloneNode(true) as HTMLElement;
  preview.style.position = "fixed";
  preview.style.top = `${pointerY - 18}px`;
  preview.style.left = `${pointerX - 24}px`;
  preview.style.width = `${rect.width}px`;
  preview.style.boxSizing = "border-box";
  preview.style.pointerEvents = "none";
  preview.style.transform = "rotate(-1.5deg) scale(1.03)";
  preview.style.opacity = "1";
  preview.style.filter = "drop-shadow(0 18px 28px rgba(15, 23, 42, 0.22))";
  preview.style.zIndex = "9999";
  document.body.appendChild(preview);
  return preview;
}

export function transparentDragImage() {
  const image = document.createElement("canvas");
  image.width = 1;
  image.height = 1;
  return image;
}

export function packageById(packages: Package[], id: string) {
  return packages.find((item) => item.id === id);
}

export function futureSprintDrafts(
  sprints: Sprint[],
  options: SprintPlanningOptions,
  protectedSprintIds = new Set<string>(),
  reviewObjectionWindowHours = DEFAULT_REVIEW_OBJECTION_WINDOW_HOURS,
) {
  const rhythmWeeks = Math.min(Math.max(Number(options.rhythmWeeks) || 2, 1), 12);
  const horizonWeeks = Math.min(Math.max(Number(options.horizonWeeks) || 6, 1), 52);
  const targetSprintNumber = Math.max(Number(options.targetSprintNumber) || 0, 0);
  const firstSprintNumber = Math.max(Number(options.firstSprintNumber) || 1, 1);
  const anchorStartDate = options.anchorStartDate || sprints[0]?.startDate || new Date().toISOString().slice(0, 10);
  const existingIds = new Set(sprints.map((sprint) => sprint.id));
  const sprintByNumber = new Map<number, Sprint>();
  for (const sprint of sprints) {
    const number = Math.max(sprintNumber(sprint.name), sprintNumber(sprint.id));
    if (number > 0) sprintByNumber.set(number, sprint);
  }
  const horizonEnd = addDaysIso(new Date().toISOString().slice(0, 10), horizonWeeks * 7);
  let nextNumber = firstSprintNumber;
  let nextStart = anchorStartDate;
  const drafts: Sprint[] = [];

  while (nextStart <= horizonEnd || (targetSprintNumber > 0 && nextNumber <= targetSprintNumber)) {
    const endDate = addDaysIso(nextStart, rhythmWeeks * 7 - 1);
    const existing = sprintByNumber.get(nextNumber);
    const baseId = `sprint-${nextNumber}`;
    const id = existing?.id || (existingIds.has(baseId) ? `${baseId}-${nextStart.replaceAll("-", "")}` : baseId);
    existingIds.add(id);
    const draft = {
      id,
      name: `Sprint ${nextNumber}`,
      status: existing?.status || "planning",
      startDate: nextStart,
      endDate,
      reviewDueAt: sprintReviewDueAt(endDate, reviewObjectionWindowHours),
      scoreLocked: existing?.scoreLocked || false,
    } satisfies Sprint;
    const changed = existing && (
      existing.name !== draft.name
      || existing.startDate !== draft.startDate
      || existing.endDate !== draft.endDate
      || existing.reviewDueAt.slice(0, 16) !== draft.reviewDueAt
    );
    if (!existing || (!existing.scoreLocked && !protectedSprintIds.has(existing.id) && changed)) {
      drafts.push(draft);
    }
    nextNumber += 1;
    nextStart = addDaysIso(endDate, 1);
  }

  return drafts;
}

export function taskText(task: Task) {
  const githubIssueNumber = task.githubIssueNumber ? String(task.githubIssueNumber) : "";
  const legacyIssueNumber = task.issueNumber ? String(task.issueNumber) : "";
  return [
    task.title,
    task.description,
    task.assignee,
    task.workstream,
    task.priority,
    task.definitionOfDone,
    task.deadline,
    task.githubRepo,
    task.githubIssueUrl,
    task.issueUrl,
    githubIssueNumber,
    githubIssueNumber ? `#${githubIssueNumber}` : "",
    legacyIssueNumber,
    legacyIssueNumber ? `#${legacyIssueNumber}` : "",
  ]
    .join(" ")
    .toLowerCase();
}

export function isThisWeek(task: Task) {
  const now = new Date();
  const start = new Date(task.startDate);
  const end = new Date(task.endDate || task.startDate);
  const weekEnd = new Date(now);
  weekEnd.setDate(now.getDate() + 7);
  return start <= weekEnd && end >= now;
}

export function sortTasks(tasks: Task[]) {
  const priorityRank: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3, P4: 4 };
  return [...tasks].sort((a, b) => {
    const priority = (priorityRank[a.priority] ?? 9) - (priorityRank[b.priority] ?? 9);
    if (priority) return priority;
    return a.order - b.order;
  });
}

export function statusOptionsForRole(status: string, canManageTaskMeta: boolean, canManageFinalTaskStatus = canManageTaskMeta) {
  if (canManageFinalTaskStatus) return taskStatuses;
  const normalized = normalizeStatus(status);
  if (normalized === "Erledigt") return ["Erledigt"] as TaskStatus[];
  if (normalized === "Nacharbeit") return ["In Arbeit", "Review", "Blockiert"] as TaskStatus[];
  return taskStatuses.filter((item) => item !== "Erledigt");
}

export function founderStatusGuardMessage(status: TaskStatus, currentStatus?: string) {
  if (currentStatus && normalizeStatus(currentStatus) === "Erledigt" && status !== "Erledigt") {
    return founderCompletedTaskGuardMessage();
  }
  if (status !== "Erledigt") return "";
  return "Founder können Aufgaben nicht direkt auf Erledigt setzen. Wenn die Arbeit fertig ist, verschiebe sie in Review. Wenn du gerade nicht weiterkommst, nutze Blockiert und melde den konkreten Blocker.";
}

export function founderCompletedTaskGuardMessage() {
  return "Diese Aufgabe ist final erledigt. Nur CEO kann sie wieder öffnen.";
}

export function founderTaskAssignmentGuardMessage() {
  return "Founder können nur den Status ihrer eigenen Aufgaben ändern.";
}

export function reviewOwnerForTask(task: Pick<Task, "packageId"> & Pick<Partial<Task>, "reviewOwnerProfileId">, packages: Package[]) {
  if (task.reviewOwnerProfileId) return task.reviewOwnerProfileId;
  const initiative = packages.find((item) => item.id === task.packageId);
  return initiative?.accountableProfileId || initiative?.ownerId || "";
}
