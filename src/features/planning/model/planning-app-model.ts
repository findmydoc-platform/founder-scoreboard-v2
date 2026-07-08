import { Columns3, GanttChart, ListTree, Table2 } from "lucide-react";
import type { AppWorkspace } from "@/features/planning/organisms/app-sidebar";
import type { SprintPlanningOptions } from "@/features/settings/molecules/settings-sprint-planning";
import { mapScoreObjection as mapScoreObjectionResponse } from "@/lib/planning-data-mappers";
import { addDaysIso, sprintNumber } from "@/lib/planning-schedule";
import { hasOpenWaitingRelation, taskRelationsFor } from "@/lib/platform";
import { normalizeStatus, taskStatuses } from "@/lib/status";
export { profileColor } from "@/lib/profile-style";
import type { Package, PlanningData, Profile, Sprint, Task, TaskActivity, TaskComment, TaskFocusItem, TaskStatus, ViewMode } from "@/lib/types";

type Workspace = AppWorkspace;

export function normalizePlanningData(data: PlanningData): PlanningData {
  return {
    ...data,
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
    taskFocusItems: data.taskFocusItems || [],
    notificationEvents: data.notificationEvents || [],
    notificationDeliveries: data.notificationDeliveries || [],
    notificationPreferences: data.notificationPreferences || [],
    profileUiPreferences: data.profileUiPreferences || [],
    profileFeatureTourAcknowledgements: data.profileFeatureTourAcknowledgements || [],
    feedbackItems: data.feedbackItems || [],
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
  execution: "Execution",
  mine: "Meine Aufgaben",
  reviews: "Reviews",
  events: "Events",
  sprint: "Sprint & Score",
  projects: "Meilensteine & Initiativen",
  tools: "FMD-Tools",
  team: "Team",
  settings: "Einstellungen",
  "ceo-intake": "CEO Intake",
  profile: "Mein Profil",
};

export const workspaceSubtitles: Record<Workspace, string> = {
  planning: "Gesamtplanung mit Board, Struktur, Tabelle und Gantt.",
  execution: "Heute-Modus, Hygiene-Alerts und Review-Steuerung.",
  mine: "Fokus auf deine Aufgaben für die operative Steuerung.",
  reviews: "Offene, abgeschlossene und wieder geöffnete Reviews.",
  events: "Wichtige Termine, Zielgruppen und Erinnerungen.",
  sprint: "Weekly Updates, Punkte und Sprintabschluss.",
  projects: "Epic-, Meilenstein- und Initiative-Überblick.",
  tools: "Interne Tools, Repos, Notion und Drive als zentraler Hub.",
  team: "Kapazitäten, Rollen und aktuelle Last pro Teammitglied.",
  settings: "Teamzugriff und Benachrichtigungen.",
  "ceo-intake": "CEO-only Import für freigegebene Aufgabenpakete.",
  profile: "Deine persönlichen Einstellungen für Profil, Hinweise und Board-Defaults.",
};

export const planningWorkspaces: Workspace[] = ["planning", "mine"];

export const quickFilters = [
  { id: "mine", label: "Meine Aufgaben" },
  { id: "open", label: "Offen" },
  { id: "blocked", label: "Blockiert" },
  { id: "week", label: "Diese Woche" },
  { id: "high", label: "Hohe Priorität" },
  { id: "evidence", label: "Ohne Evidence" },
];

export function profileForOwnerValue(profiles: Profile[], value?: string) {
  return profiles.find((profile) => profile.id === value || profile.name === value) || null;
}

export function taskOwnerPatch(ownerValue: string, profiles: Profile[]): Partial<Task> {
  const profile = profileForOwnerValue(profiles, ownerValue);
  const ownerId = profile?.id || "";
  const owner = profile?.name || ownerValue || "";
  return {
    ownerId,
    owner,
    assigneeId: ownerId,
    assignee: owner,
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

export function futureSprintDrafts(sprints: Sprint[], options: SprintPlanningOptions, protectedSprintIds = new Set<string>()) {
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
      reviewDueAt: `${addDaysIso(endDate, -2)}T12:00`,
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
    task.owner,
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

export function statusOptionsForRole(status: string, canManageTaskMeta: boolean) {
  if (canManageTaskMeta) return taskStatuses;
  if (normalizeStatus(status) === "Nacharbeit") return ["In Arbeit", "Review", "Blockiert"] as TaskStatus[];
  return taskStatuses.filter((item) => item !== "Erledigt");
}

export function founderStatusGuardMessage(status: TaskStatus) {
  if (status !== "Erledigt") return "";
  return "Founder können Aufgaben nicht direkt auf Erledigt setzen. Wenn die Arbeit fertig ist, verschiebe sie in Review. Wenn du gerade nicht weiterkommst, nutze Blockiert und melde den konkreten Blocker.";
}

export function founderTaskOwnershipGuardMessage() {
  return "Founder können nur den Status ihrer eigenen Aufgaben ändern.";
}

export function reviewOwnerForTask(task: Pick<Task, "packageId">, packages: Package[]) {
  const initiative = packages.find((item) => item.id === task.packageId);
  return initiative?.accountableProfileId || initiative?.ownerId || "";
}

export type HygieneAlert = {
  id: string;
  severity: "critical" | "warning" | "info";
  area: "focus" | "quality" | "blocker" | "review" | "evidence" | "dependency" | "sync";
  title: string;
  description: string;
  recommendedAction: string;
  focusStatus?: TaskFocusItem["status"];
  taskId?: string;
};

export function daysSinceIso(value: string, today = new Date()) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Math.floor((today.getTime() - date.getTime()) / 86400000);
}

export function latestTaskSignal(taskId: string, comments: TaskComment[], activities: TaskActivity[]) {
  const dates = [
    ...comments.filter((comment) => comment.taskId === taskId).map((comment) => comment.createdAt),
    ...activities.filter((activity) => activity.taskId === taskId).map((activity) => activity.createdAt),
  ];
  return dates.sort().at(-1) || "";
}

export function buildHygieneAlerts(data: PlanningData) {
  const alerts: HygieneAlert[] = [];
  const openStatuses = new Set(["Vorschlag", "Offen", "In Arbeit", "Review", "Nacharbeit", "Blockiert"]);

  for (const task of data.tasks) {
    const status = normalizeStatus(task.status);
    if (!openStatuses.has(status)) continue;
    const relationGroups = taskRelationsFor(task.id, data.taskRelations);
    const openBlockers = data.taskBlockers.filter((blocker) => blocker.taskId === task.id && blocker.status === "open");
    const latestSignal = latestTaskSignal(task.id, data.taskComments, data.taskActivity);
    const staleDays = daysSinceIso(latestSignal || task.startDate || task.endDate);

    if (task.priority === "P0" && !task.owner && task.taskType !== "proposal") {
      alerts.push({ id: `p0-owner-${task.id}`, severity: "critical", area: "focus", title: "P0 ohne Assignee", description: "Diese Aufgabe braucht sofort eine klare Verantwortung.", recommendedAction: "Assignee festlegen und nächsten Schritt notieren.", taskId: task.id });
    }
    if (!task.acceptanceCriteria?.trim()) {
      alerts.push({ id: `criteria-${task.id}`, severity: "warning", area: "quality", title: "Abnahmekriterien fehlen", description: "Ohne Abnahmekriterien ist Review und Score schwammig.", recommendedAction: "Abnahmekriterien ergänzen, bevor weiter umgesetzt wird.", taskId: task.id });
    }
    if (!task.definitionOfDone?.trim()) {
      alerts.push({ id: `dod-${task.id}`, severity: "warning", area: "quality", title: "Qualitätsstandard fehlt", description: "Die Aufgabe hat kein klares Fertig-Kriterium.", recommendedAction: "Qualitätsstandard ergänzen und Review-Erwartung klären.", taskId: task.id });
    }
    if (status === "Blockiert" && !openBlockers.length) {
      alerts.push({ id: `blocker-comment-${task.id}`, severity: "critical", area: "blocker", title: "Blockiert ohne Blocker-Meldung", description: "Der Status ist blockiert, aber es fehlt eine konkrete Blocker-Meldung.", recommendedAction: "Blocker mit Ursache, Auswirkung und benötigter Hilfe erfassen.", focusStatus: "blocked", taskId: task.id });
    }
    if (status === "Review" && (daysSinceIso(task.endDate) || 0) >= 2) {
      alerts.push({ id: `review-aging-${task.id}`, severity: "warning", area: "review", title: "Review wartet zu lange", description: "Diese Aufgabe liegt mindestens zwei Tage in Review.", recommendedAction: "Review aktiv anstoßen oder Nacharbeit klar markieren.", taskId: task.id });
    }
    if (task.sprintId && status !== "Erledigt" && !task.evidenceLink && !task.githubIssueUrl && !task.issueUrl) {
      alerts.push({ id: `evidence-${task.id}`, severity: "info", area: "evidence", title: "Nachweis fehlt", description: "Sprint-Arbeit sollte einen Nachweis-Link haben.", recommendedAction: "Nachweis-Link oder externe Ablage ergänzen.", taskId: task.id });
    }
    if (relationGroups.waitsOn.length && hasOpenWaitingRelation(task.id, data.tasks, data.taskRelations)) {
      alerts.push({ id: `waits-on-${task.id}`, severity: "warning", area: "dependency", title: "Wartet auf offene Aufgabe", description: "Eine Abhängigkeit ist noch offen und kann den Abschluss verschieben.", recommendedAction: "Abhängigkeit prüfen und Blocker oder Folgeaktion klären.", focusStatus: "blocked", taskId: task.id });
    }
    if (staleDays !== null && staleDays >= 2 && status !== "Erledigt") {
      alerts.push({ id: `stale-${task.id}`, severity: "info", area: "focus", title: "Kein Update seit 48 Stunden", description: "Es gibt seit mindestens zwei Tagen keinen Kommentar oder Aktivitätseintrag.", recommendedAction: "Kurzstatus oder nächsten Schritt ergänzen.", taskId: task.id });
    }
    if (task.githubSyncStatus === "failed") {
      alerts.push({ id: `sync-${task.id}`, severity: "warning", area: "sync", title: "GitHub-Sync fehlgeschlagen", description: task.githubSyncError || "Die Aufgabe konnte nicht sauber nach GitHub gespiegelt werden.", recommendedAction: "GitHub-Sync prüfen und Aufgabe erneut spiegeln.", taskId: task.id });
    }
  }

  return alerts;
}
