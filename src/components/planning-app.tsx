"use client";

import {
  AlertTriangle,
  ChevronRight,
  Circle,
  Columns3,
  Filter,
  GanttChart,
  Link2,
  ListTree,
  MessageSquare,
  Plus,
  Search,
  Table2,
  X,
} from "lucide-react";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type DragEvent } from "react";
import { AppBrand } from "@/components/app-brand";
import { AppSidebar, type AppWorkspace } from "@/components/app-sidebar";
import { AuthControl } from "@/components/auth-control";
import { CustomSelect } from "@/components/custom-select";
import { DecisionLogOverview } from "@/components/decision-log-overview";
import { DevRoleSwitch } from "@/components/dev-role-switch";
import { ExecutionLayerOverview } from "@/components/execution-layer-overview";
import { FeedbackDialog, type FeedbackDraft } from "@/components/feedback-dialog";
import { FmdToolsOverview } from "@/components/fmd-tools-overview";
import { GanttView } from "@/components/gantt-view";
import { persistLocalPlanningTasks, useLocalPlanningState } from "@/hooks/use-local-planning-state";
import { getProtectedPlanningDataCache, setProtectedPlanningDataCache, usePlanningAuth } from "@/hooks/use-planning-auth";
import { usePlanningWorkspace } from "@/hooks/use-planning-workspace";
import { InitiativeDialog, type InitiativeDraft } from "@/components/initiative-dialog";
import { NewTaskDialog, type NewTaskDraft } from "@/components/new-task-dialog";
import { MeetingFinderOverview } from "@/components/meeting-finder-overview";
import { NotificationInbox } from "@/components/notification-inbox";
import { ProjectsOverview } from "@/components/projects-overview";
import { SettingsOverview } from "@/components/settings-overview";
import { SprintScoreTableOverview } from "@/components/sprint-score-overview";
import type { SprintPlanningOptions } from "@/components/settings-sprint-planning";
import { EmptyColumn, GitHubMissingBadge, RelationBadge, TaskCard } from "@/components/task-card";
import { TaskDetailPanel } from "@/components/task-detail-panel";
import { TeamOverview } from "@/components/team-overview";
import { dateRange, initiativeMetaLabel, initiativeOptionLabel, taskOwnerOptions } from "@/lib/display";
import { getRememberedGitHubProviderToken, rememberGitHubProviderToken } from "@/lib/github-provider-token";
import { normalizeStatus, priorityTone, taskStatuses } from "@/lib/status";
import { getBrowserSupabase, hasSupabaseEnv } from "@/lib/supabase";
import { hasGitHubIssue, hasOpenWaitingRelation, taskRelationsFor } from "@/lib/platform";
import { TaskDetailPage } from "@/components/task-detail-page";
import type { AvailabilityEntry, DecisionTaskLink, FeedbackItem, Meeting, MeetingAttendance, NotificationEvent, NotificationPreference, Package, PlanningData, Profile, Sprint, SprintCommitment, Task, TaskActivity, TaskComment, TaskExternalComment, TaskFocusItem, TaskRelation, TaskRelationType, TaskStatus, ViewMode } from "@/lib/types";

type Props = {
  initialData: PlanningData;
  source: "seed" | "supabase";
  authRequired: boolean;
  initialTaskId?: string;
};

type Filters = {
  query: string;
  owner: string;
  status: string;
  priority: string;
  packageId: string;
  quick: string;
};

type Workspace = AppWorkspace;

type GoogleChatStatus = {
  webhookConfigured: boolean;
  apiConfigured: boolean;
  deliveryEnabled: boolean;
  ready: boolean;
  mode: "direct-dm" | "space-webhook" | "not-configured";
  pending: number;
};

type HeaderPrimaryAction = {
  label: string;
  onClick: () => void;
};

function normalizePlanningData(data: PlanningData): PlanningData {
  return {
    ...data,
    profiles: data.profiles || [],
    packages: data.packages || [],
    milestones: data.milestones || [],
    tasks: data.tasks || [],
    sprints: data.sprints || [],
    sprintCommitments: data.sprintCommitments || [],
    decisions: data.decisions || [],
    decisionComments: data.decisionComments || [],
    taskComments: data.taskComments || [],
    taskExternalComments: data.taskExternalComments || [],
    taskBlockers: data.taskBlockers || [],
    taskRelations: data.taskRelations || [],
    taskActivity: data.taskActivity || [],
    taskFocusItems: data.taskFocusItems || [],
    decisionTaskLinks: data.decisionTaskLinks || [],
    notificationEvents: data.notificationEvents || [],
    notificationDeliveries: data.notificationDeliveries || [],
    notificationPreferences: data.notificationPreferences || [],
    feedbackItems: data.feedbackItems || [],
    fmdTools: data.fmdTools || [],
    meetings: data.meetings || [],
    meetingAttendance: data.meetingAttendance || [],
    audit: data.audit || [],
    availability: data.availability || [],
  };
}

function isLocalDevHost() {
  if (typeof window === "undefined") return false;
  return ["localhost", "127.0.0.1", "::1"].includes(window.location.hostname);
}


const viewTabs: Array<{ id: ViewMode; label: string; icon: typeof Columns3 }> = [
  { id: "board", label: "Board", icon: Columns3 },
  { id: "structure", label: "Struktur", icon: ListTree },
  { id: "table", label: "Tabelle", icon: Table2 },
  { id: "gantt", label: "Gantt", icon: GanttChart },
];

const workspaceLabels: Record<Workspace, string> = {
  planning: "Projekt",
  execution: "Execution",
  mine: "Meine Aufgaben",
  sprint: "Sprint & Score",
  decisions: "Decision Log",
  meetings: "Meeting Finder",
  projects: "Meilensteine & Initiativen",
  tools: "FMD-Tools",
  team: "Team",
  settings: "Einstellungen",
};

const workspaceSubtitles: Record<Workspace, string> = {
  planning: "Gesamtplanung mit Board, Struktur, Tabelle und Gantt.",
  execution: "Heute-Modus, Hygiene-Alerts und Decision-Folgearbeit.",
  mine: "Fokus auf deine Aufgaben für die operative Steuerung.",
  sprint: "Review Queue, Punkte und Sprintabschluss.",
  decisions: "CEO-Entscheidungen mit Bestätigung und Locking.",
  meetings: "Freie Slots aus Arbeitszeiten und Abwesenheiten finden.",
  projects: "Epic-, Meilenstein- und Initiative-Überblick.",
  tools: "Interne Tools, Repos, Notion und Drive als zentraler Hub.",
  team: "Kapazitäten, Rollen und aktuelle Last pro Teammitglied.",
  settings: "Datenquelle, Auth-Status und Setup-Prüfungen.",
};

const planningWorkspaces: Workspace[] = ["planning", "mine"];

const quickFilters = [
  { id: "mine", label: "Meine Aufgaben" },
  { id: "open", label: "Offen" },
  { id: "blocked", label: "Blockiert" },
  { id: "week", label: "Diese Woche" },
  { id: "high", label: "Hohe Priorität" },
  { id: "evidence", label: "Ohne Evidence" },
];

const devProfileStateKey = "fmd-planning-dev-profile-v1";
function profileColor(profile?: Pick<Profile, "color"> | null) {
  return profile?.color || "#64748b";
}

function createTaskDragPreview(source: HTMLElement, pointerX: number, pointerY: number) {
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

function transparentDragImage() {
  const image = document.createElement("canvas");
  image.width = 1;
  image.height = 1;
  return image;
}

function packageById(packages: Package[], id: string) {
  return packages.find((item) => item.id === id);
}

function sprintNumber(value: string) {
  const match = value.match(/sprint\D*(\d+)/i) || value.match(/(\d+)$/);
  return match ? Number(match[1]) : 0;
}

function addDaysIso(value: string, days: number) {
  const date = value ? new Date(`${value}T00:00:00`) : new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function currentIsoDate() {
  const date = new Date();
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function findCurrentSprint(sprints: Sprint[], today = currentIsoDate()) {
  return sprints.find((sprint) => sprint.startDate <= today && sprint.endDate >= today)
    || sprints.find((sprint) => sprint.status === "active")
    || sprints.find((sprint) => sprint.status === "planning" || sprint.status === "review")
    || sprints[0];
}

function futureSprintDrafts(sprints: Sprint[], options: SprintPlanningOptions, protectedSprintIds = new Set<string>()) {
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

function taskText(task: Task) {
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

function isThisWeek(task: Task) {
  const now = new Date();
  const start = new Date(task.startDate);
  const end = new Date(task.endDate || task.startDate);
  const weekEnd = new Date(now);
  weekEnd.setDate(now.getDate() + 7);
  return start <= weekEnd && end >= now;
}

function sortTasks(tasks: Task[]) {
  const priorityRank: Record<string, number> = { P0: 0, P1: 1, P2: 2, P3: 3, P4: 4 };
  return [...tasks].sort((a, b) => {
    const priority = (priorityRank[a.priority] ?? 9) - (priorityRank[b.priority] ?? 9);
    if (priority) return priority;
    return a.order - b.order;
  });
}

function statusOptionsForRole(status: string, canManageTaskMeta: boolean) {
  if (canManageTaskMeta) return taskStatuses;
  if (normalizeStatus(status) === "Nacharbeit") return ["In Arbeit", "Review", "Blockiert"] as TaskStatus[];
  return taskStatuses.filter((item) => item !== "Erledigt");
}

function founderStatusGuardMessage(status: TaskStatus) {
  if (status !== "Erledigt") return "";
  return "Founder können Aufgaben nicht direkt auf Erledigt setzen. Wenn die Arbeit fertig ist, verschiebe sie in Review. Wenn du gerade nicht weiterkommst, nutze Blockiert und melde den konkreten Blocker.";
}

type HygieneAlert = {
  id: string;
  severity: "critical" | "warning" | "info";
  area: "focus" | "quality" | "blocker" | "review" | "evidence" | "dependency" | "decision" | "sync";
  title: string;
  description: string;
  recommendedAction: string;
  focusStatus?: TaskFocusItem["status"];
  taskId?: string;
  decisionId?: number;
};

function daysSinceIso(value: string, today = new Date()) {
  if (!value) return null;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return null;
  return Math.floor((today.getTime() - date.getTime()) / 86400000);
}

function latestTaskSignal(taskId: string, comments: TaskComment[], activities: TaskActivity[]) {
  const dates = [
    ...comments.filter((comment) => comment.taskId === taskId).map((comment) => comment.createdAt),
    ...activities.filter((activity) => activity.taskId === taskId).map((activity) => activity.createdAt),
  ];
  return dates.sort().at(-1) || "";
}

function buildHygieneAlerts(data: PlanningData) {
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
      alerts.push({ id: `criteria-${task.id}`, severity: "warning", area: "quality", title: "Acceptance Criteria fehlen", description: "Ohne Akzeptanzkriterien ist Review und Score schwammig.", recommendedAction: "Akzeptanzkriterien ergänzen, bevor weiter umgesetzt wird.", taskId: task.id });
    }
    if (!task.definitionOfDone?.trim()) {
      alerts.push({ id: `dod-${task.id}`, severity: "warning", area: "quality", title: "Definition of Done fehlt", description: "Die Aufgabe hat kein klares Fertig-Kriterium.", recommendedAction: "Definition of Done ergänzen und Review-Erwartung klären.", taskId: task.id });
    }
    if (status === "Blockiert" && !openBlockers.length) {
      alerts.push({ id: `blocker-comment-${task.id}`, severity: "critical", area: "blocker", title: "Blockiert ohne Blocker-Meldung", description: "Der Status ist blockiert, aber es fehlt eine konkrete Blocker-Meldung.", recommendedAction: "Blocker mit Ursache, Auswirkung und benötigter Hilfe erfassen.", focusStatus: "blocked", taskId: task.id });
    }
    if (status === "Review" && (daysSinceIso(task.endDate) || 0) >= 2) {
      alerts.push({ id: `review-aging-${task.id}`, severity: "warning", area: "review", title: "Review wartet zu lange", description: "Diese Aufgabe liegt mindestens zwei Tage in Review.", recommendedAction: "Review aktiv anstoßen oder Nacharbeit klar markieren.", taskId: task.id });
    }
    if (task.sprintId && status !== "Erledigt" && !task.evidenceLink && !task.githubIssueUrl && !task.issueUrl) {
      alerts.push({ id: `evidence-${task.id}`, severity: "info", area: "evidence", title: "Evidence fehlt", description: "Sprint-Arbeit sollte einen Evidence- oder GitHub-Link haben.", recommendedAction: "Evidence-Link oder GitHub-Issue ergänzen.", taskId: task.id });
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

  for (const decision of data.decisions) {
    const links = data.decisionTaskLinks.filter((link) => link.decisionId === decision.id);
    if (decision.status === "locked" && !links.length) {
      alerts.push({ id: `decision-followup-${decision.id}`, severity: "warning", area: "decision", title: "Decision ohne Folgeaufgabe", description: "Die Decision ist gelockt, aber noch mit keiner Aufgabe verknüpft.", recommendedAction: "Folgeaufgabe erstellen oder bestehende Aufgabe verknüpfen.", focusStatus: "needs_decision", decisionId: decision.id });
    }
  }

  return alerts;
}

export function PlanningApp({ initialData, source, authRequired, initialTaskId = "" }: Props) {
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const sidebarRef = useRef<HTMLElement | null>(null);
  const autoImportedGitHubCommentsRef = useRef<Set<string>>(new Set());
  const optimisticAvailabilityIdRef = useRef(-1);
  const safeInitialData = useMemo(() => normalizePlanningData(initialData), [initialData]);
  const initialClientData = useMemo(() => {
    return authRequired && source === "supabase" && getProtectedPlanningDataCache() ? getProtectedPlanningDataCache()! : safeInitialData;
  }, [authRequired, safeInitialData, source]);
  const [data, setData] = useState(initialClientData);
  const { localStateLoaded } = useLocalPlanningState({ source, setData });
  const { workspace, setWorkspace } = usePlanningWorkspace();
  const [view, setView] = useState<ViewMode>("board");
  const [expandedPackages, setExpandedPackages] = useState<Record<string, boolean>>({});
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(initialTaskId || null);
  const [taskDialogDefaults, setTaskDialogDefaults] = useState<Partial<NewTaskDraft> | null>(null);
  const [initiativeDialogDefaults, setInitiativeDialogDefaults] = useState<Partial<InitiativeDraft> | null>(null);
  const [feedbackDialogOpen, setFeedbackDialogOpen] = useState(false);
  const [selectedFeedbackId, setSelectedFeedbackId] = useState<number | null>(null);
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<TaskStatus | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [devProfileId, setDevProfileId] = useState("");
  const [saveError, setSaveError] = useState("");
  const [commentImportNotice, setCommentImportNotice] = useState("");
  const [commentImportPendingTaskIds, setCommentImportPendingTaskIds] = useState<Set<string>>(new Set());
  const [statusGuardNotice, setStatusGuardNotice] = useState("");
  const [statusGuardTaskId, setStatusGuardTaskId] = useState<string | null>(null);
  const [feedbackMessage, setFeedbackMessage] = useState("");
  const [notificationDispatchMessage, setNotificationDispatchMessage] = useState("");
  const [calendarSyncMessage, setCalendarSyncMessage] = useState("");
  const [meetingCreateMessage, setMeetingCreateMessage] = useState("");
  const [googleChatStatus, setGoogleChatStatus] = useState<GoogleChatStatus | null>(null);
  const [showNotifications, setShowNotifications] = useState(false);
  const [sprintLockMessage, setSprintLockMessage] = useState("");
  const [sprintPlanningOptions, setSprintPlanningOptions] = useState<SprintPlanningOptions>({
    firstSprintNumber: 2,
    anchorStartDate: addDaysIso(safeInitialData.sprints[0]?.startDate || new Date().toISOString().slice(0, 10), 7),
    rhythmWeeks: 2,
    horizonWeeks: 6,
    targetSprintNumber: 0,
  });
  const [filters, setFilters] = useState<Filters>({
    query: "",
    owner: "Alle",
    status: "Alle",
    priority: "Alle",
    packageId: "Alle",
    quick: "",
  });
  const clearSelectedTask = useCallback(() => setSelectedTaskId(null), []);
  const {
    authUser,
    authChecked,
    protectedDataLoaded,
    setProtectedDataLoaded,
    githubProviderTokenAvailable,
    authError,
    authNotice,
    authBusy,
    signIn,
    signOut,
  } = usePlanningAuth({
    authRequired,
    source,
    safeInitialData,
    taskCount: data.tasks.length,
    setData,
    normalizePlanningData,
    onSignedOut: clearSelectedTask,
  });

  const selectedTask = data.tasks.find((task) => task.id === selectedTaskId) || null;
  const selectedPackage = selectedTask ? packageById(data.packages, selectedTask.packageId) : undefined;
  const selectedTaskSubIssues = selectedTask ? sortTasks(data.tasks.filter((task) => task.parentTaskId === selectedTask.id)) : [];
  const selectedTaskComments = selectedTask ? data.taskComments.filter((comment) => comment.taskId === selectedTask.id) : [];
  const selectedTaskExternalComments = selectedTask ? data.taskExternalComments.filter((comment) => comment.taskId === selectedTask.id) : [];
  const selectedTaskActivity = selectedTask ? data.taskActivity.filter((activity) => activity.taskId === selectedTask.id) : [];
  const selectedTaskBlockers = selectedTask ? data.taskBlockers.filter((blocker) => blocker.taskId === selectedTask.id) : [];
  const fullTaskView = searchParams.get("view") === "full";
  const authAvailable = hasSupabaseEnv();
  const currentGithubLogin = String(authUser?.user_metadata?.user_name || authUser?.user_metadata?.preferred_username || "");
  const actualProfile = data.profiles.find((profile) => profile.githubLogin === currentGithubLogin) || null;
  const devRoleSwitchAvailable = source === "supabase" && process.env.NODE_ENV !== "production" && isLocalDevHost() && (actualProfile?.platformRole === "ceo" || actualProfile?.platformRole === "deputy");
  const devProfile = devRoleSwitchAvailable && devProfileId ? data.profiles.find((profile) => profile.id === devProfileId) || null : null;
  const currentProfile = devProfile || actualProfile;
  const mineOwnerName = currentProfile?.name || "Volkan";
  const canManageTaskMeta = source === "seed" || currentProfile?.platformRole === "ceo" || currentProfile?.platformRole === "deputy";
  const unreadNotifications = useMemo(() => {
    const pending = data.notificationEvents.filter((event) => event.status === "pending");
    if (!currentProfile) return pending;
    return pending.filter((event) => event.recipientProfileId === currentProfile.id);
  }, [currentProfile, data.notificationEvents]);
  const hygieneAlerts = useMemo(() => buildHygieneAlerts(data), [data]);
  const todayFocusDate = currentIsoDate();
  const currentProfileFocusItems = useMemo(() => {
    const profileId = currentProfile?.id || "volkan";
    return data.taskFocusItems
      .filter((item) => item.profileId === profileId && item.focusDate === todayFocusDate)
      .sort((left, right) => left.position - right.position)
      .slice(0, 3);
  }, [currentProfile?.id, data.taskFocusItems, todayFocusDate]);
  const requestHeaders = useCallback((token?: string, options: { json?: boolean; github?: boolean } = { json: true }) => {
    const githubProviderToken = options.github ? getRememberedGitHubProviderToken() : "";
    return {
      ...(options.json !== false ? { "content-type": "application/json" } : {}),
      ...(token ? { authorization: `Bearer ${token}` } : {}),
      ...(devRoleSwitchAvailable && devProfileId ? { "x-fmd-dev-profile-id": devProfileId } : {}),
      ...(githubProviderToken ? { "x-github-provider-token": githubProviderToken } : {}),
    };
  }, [devProfileId, devRoleSwitchAvailable]);

  const openTaskPanel = useCallback((taskId: string) => {
    setSelectedTaskId(taskId);
    router.push(`/tasks/${encodeURIComponent(taskId)}`);
  }, [router]);

  const closeTaskPanel = useCallback(() => {
    setSelectedTaskId(null);
    if (pathname?.startsWith("/tasks/")) {
      if (window.history.length > 1) {
        router.back();
      } else {
        router.push("/");
      }
    }
  }, [pathname, router]);

  useEffect(() => {
    const storedDevProfile = window.localStorage.getItem(devProfileStateKey) || "";
    if (storedDevProfile) window.queueMicrotask(() => setDevProfileId(storedDevProfile));
  }, []);

  useEffect(() => {
    if (!devRoleSwitchAvailable && devProfileId) {
      window.queueMicrotask(() => setDevProfileId(""));
      window.localStorage.removeItem(devProfileStateKey);
      return;
    }
    if (!devRoleSwitchAvailable) return;
    if (devProfileId) window.localStorage.setItem(devProfileStateKey, devProfileId);
    else window.localStorage.removeItem(devProfileStateKey);
  }, [devProfileId, devRoleSwitchAvailable]);

  useEffect(() => {
    if (!selectedTaskId) return;

    const closeOnBackspace = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      const isEditable = target?.closest("input, textarea, select, [contenteditable='true']");
      if (isEditable || event.altKey || event.ctrlKey || event.metaKey) return;
      if (event.key !== "Backspace") return;

      event.preventDefault();
      closeTaskPanel();
    };

    window.addEventListener("keydown", closeOnBackspace);
    return () => window.removeEventListener("keydown", closeOnBackspace);
  }, [closeTaskPanel, selectedTaskId]);

  const filteredTasks = useMemo(() => {
    return sortTasks(
      data.tasks.filter((task) => {
        if (task.taskType === "sub_issue") return false;
        const normalized = normalizeStatus(task.status);
        const matchesQuery = !filters.query || taskText(task).includes(filters.query.toLowerCase());
        const matchesOwner = filters.owner === "Alle" || task.owner === filters.owner;
        const matchesStatus = filters.status === "Alle" || normalized === filters.status;
        const matchesPriority = filters.priority === "Alle" || task.priority === filters.priority;
        const matchesPackage = filters.packageId === "Alle" || task.packageId === filters.packageId;
        const matchesQuick =
          !filters.quick ||
          (filters.quick === "mine" && task.owner === mineOwnerName) ||
          (filters.quick === "open" && normalized === "Offen") ||
          (filters.quick === "blocked" && (normalized === "Blockiert" || Boolean(task.dependsOn))) ||
          (filters.quick === "week" && isThisWeek(task)) ||
          (filters.quick === "high" && ["P0", "P1"].includes(task.priority)) ||
          (filters.quick === "evidence" && !task.evidenceLink && !task.issueUrl);

        return matchesQuery && matchesOwner && matchesStatus && matchesPriority && matchesPackage && matchesQuick;
      }),
    );
  }, [data.tasks, filters, mineOwnerName]);

  const visibleTasks = useMemo(() => {
    if (workspace === "mine") return filteredTasks.filter((task) => task.owner === mineOwnerName);
    return filteredTasks;
  }, [filteredTasks, mineOwnerName, workspace]);
  const activeSprint = findCurrentSprint(data.sprints) || data.sprints[0];
  const filtersAvailable = planningWorkspaces.includes(workspace);
  const headerPrimaryAction: HeaderPrimaryAction | null = (() => {
    if (workspace === "planning") {
      return {
        label: "Neue Aufgabe",
        onClick: () => setTaskDialogDefaults({ taskType: "deliverable" }),
      };
    }

    if (workspace === "mine") {
      return {
        label: "Vorschlag erstellen",
        onClick: () => setTaskDialogDefaults({ taskType: "proposal" }),
      };
    }

    if (workspace === "sprint") {
      return {
        label: "Aufgabe hinzufügen",
        onClick: () =>
          setTaskDialogDefaults({
            taskType: "deliverable",
            sprintId: activeSprint?.id || "",
            startDate: activeSprint?.startDate || "",
            endDate: activeSprint?.endDate || "",
          }),
      };
    }

    if (workspace === "decisions") {
      return {
        label: "Neue Decision",
        onClick: () => document.getElementById("decision-create")?.scrollIntoView({ behavior: "smooth", block: "start" }),
      };
    }

    if (workspace === "projects") {
      return {
        label: "Neue Initiative",
        onClick: () => setInitiativeDialogDefaults({}),
      };
    }

    if (workspace === "settings") {
      return {
        label: "Feedback erfassen",
        onClick: () => setFeedbackDialogOpen(true),
      };
    }

    return null;
  })();

  const updateTask = (task: Task, patch: Partial<Task>) => {
    setSaveError("");
    setStatusGuardNotice("");
    setStatusGuardTaskId(null);

    if (patch.status && !canManageTaskMeta) {
      const guardedMessage = founderStatusGuardMessage(patch.status as TaskStatus);
      if (guardedMessage) {
        setStatusGuardNotice(guardedMessage);
        setStatusGuardTaskId(task.id);
        return;
      }
    }

    setData((current) => {
      const nextData = {
        ...current,
        tasks: current.tasks.map((item) => (item.id === task.id ? { ...item, ...patch, githubSyncStatus: patch.githubSyncStatus || "not_synced", githubSyncError: patch.githubSyncStatus ? item.githubSyncError : "" } : item)),
      };

      if (source === "seed") {
        try {
          persistLocalPlanningTasks(nextData.tasks);
        } catch {
          // UI remains usable even if browser storage is unavailable.
        }
      }

      return nextData;
    });

    if (source !== "supabase") return;

    startTransition(async () => {
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;

      try {
        const response = await fetch(`/api/tasks/${task.id}`, {
          method: "PATCH",
          headers: requestHeaders(token),
          body: JSON.stringify({
            status: patch.status,
            owner: patch.owner,
            priority: patch.priority,
            packageId: patch.packageId,
            startDate: patch.startDate,
            endDate: patch.endDate,
            deadline: patch.deadline,
            note: patch.note,
            reviewStatus: patch.reviewStatus,
            scorePoints: patch.scorePoints,
            scoreFinal: patch.scoreFinal,
            githubSyncStatus: patch.githubSyncStatus,
            sprintId: patch.sprintId,
            milestoneId: patch.milestoneId,
            dependsOn: patch.dependsOn,
            evidenceLink: patch.evidenceLink,
            selfDodChecked: patch.selfDodChecked,
            selfEvidenceChecked: patch.selfEvidenceChecked,
            selfDocumentedChecked: patch.selfDocumentedChecked,
            selfBlockersChecked: patch.selfBlockersChecked,
          }),
        });

        const body = (await response.json().catch(() => null)) as { error?: string; activities?: TaskActivity[] } | null;
        if (!response.ok) {
          throw new Error(body?.error || "Änderung konnte nicht gespeichert werden.");
        }
        if (body?.activities?.length) {
          setData((current) => ({
            ...current,
            taskActivity: [...body.activities!, ...current.taskActivity],
          }));
        }
        if (patch.status && hasGitHubIssue(task) && githubProviderTokenAvailable && canManageTaskMeta) {
          syncTaskToGitHub({ ...task, ...patch }, { silent: true });
        }
      } catch (error) {
        setData((current) => ({
          ...current,
          tasks: current.tasks.map((item) => (item.id === task.id ? task : item)),
        }));
        setSaveError(error instanceof Error ? error.message : "Änderung konnte nicht gespeichert werden.");
      }
    });
  };

  const createTask = (draft: NewTaskDraft) => {
    setSaveError("");

    const owner = draft.owner || (draft.taskType === "proposal" ? "" : currentProfile?.name || data.profiles[0]?.name || "Volkan");
    const localTask: Task = {
      id: `local-${Date.now()}`,
      order: data.tasks.length + 1,
      title: draft.title,
      description: draft.description,
      problemStatement: draft.problemStatement,
      intendedOutcome: draft.intendedOutcome,
      scopeConstraints: draft.scopeConstraints,
      acceptanceCriteria: draft.acceptanceCriteria,
      evidenceRequired: draft.evidenceRequired,
      dodTemplateVersion: "founder-deliverable-v2",
      status: draft.taskType === "proposal" ? "Vorschlag" : draft.status || "Offen",
      priority: draft.priority || "P2",
      owner,
      assignee: owner,
      workstream: draft.workstream,
      packageId: draft.packageId,
      milestoneId: draft.milestoneId,
      deadline: draft.deadline,
      definitionOfDone: draft.definitionOfDone,
      dependsOn: "",
      evidenceLink: "",
      issueNumber: "",
      issueUrl: "",
      note: "",
      watched: false,
      hours: draft.hours,
      startDate: draft.startDate,
      endDate: draft.endDate,
      sprintId: draft.taskType === "proposal" || draft.taskType === "sub_issue" ? "" : draft.sprintId,
      reviewStatus: "not_requested",
      scorePoints: 0,
      scoreFinal: false,
      githubRepo: "findmydoc-platform/management",
      githubIssueNumber: null,
      githubIssueUrl: "",
      githubSyncStatus: "not_synced",
      githubLastSyncedAt: "",
      githubSyncError: "",
      taskType: draft.taskType,
      parentTaskId: draft.parentTaskId,
      scoreRelevant: draft.taskType === "deliverable",
      selfDodChecked: false,
      selfEvidenceChecked: false,
      selfDocumentedChecked: false,
      selfBlockersChecked: false,
    };

    const localDecisionLink: DecisionTaskLink | null = draft.decisionId
      ? {
        id: -Date.now() - 1,
        decisionId: draft.decisionId,
        taskId: localTask.id,
        linkType: "follows_from",
        note: draft.decisionLinkNote,
        createdBy: currentProfile?.id || "",
        createdAt: new Date().toISOString(),
      }
      : null;

    setData((current) => ({
      ...current,
      tasks: [...current.tasks, localTask],
      decisionTaskLinks: localDecisionLink ? [localDecisionLink, ...current.decisionTaskLinks] : current.decisionTaskLinks,
    }));
    setTaskDialogDefaults(null);

    if (source !== "supabase") return;

    startTransition(async () => {
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;
      let createdTaskCommitted = false;

      try {
        const response = await fetch("/api/tasks", {
          method: "POST",
          headers: requestHeaders(token),
          body: JSON.stringify(draft),
        });

        const body = (await response.json().catch(() => null)) as { error?: string; task?: Task } | null;
        if (!response.ok || !body?.task) throw new Error(body?.error || "Aufgabe konnte nicht erstellt werden.");

        setData((current) => ({
          ...current,
          tasks: current.tasks.map((task) => (task.id === localTask.id ? body.task! : task)),
          decisionTaskLinks: localDecisionLink
            ? current.decisionTaskLinks.map((link) => (link.id === localDecisionLink.id ? { ...link, taskId: body.task!.id } : link))
            : current.decisionTaskLinks,
        }));
        createdTaskCommitted = true;

        if (draft.decisionId) {
          const decisionResponse = await fetch(`/api/decisions/${draft.decisionId}/tasks`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              ...(token ? { authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({ taskId: body.task.id, linkType: "follows_from", note: draft.decisionLinkNote }),
          });
          const decisionBody = (await decisionResponse.json().catch(() => null)) as { error?: string; link?: DecisionTaskLink } | null;
          if (!decisionResponse.ok || !decisionBody?.link) throw new Error(decisionBody?.error || "Decision-Folgeaufgabe konnte nicht verknüpft werden.");
          setData((current) => ({
            ...current,
            decisionTaskLinks: localDecisionLink
              ? current.decisionTaskLinks.map((link) => (link.id === localDecisionLink.id ? decisionBody.link! : link))
              : [decisionBody.link!, ...current.decisionTaskLinks],
          }));
        }

        if (draft.relatedTaskId && draft.relatedTaskId !== body.task.id) {
          const relationResponse = await fetch(`/api/tasks/${body.task.id}/relationships`, {
            method: "POST",
            headers: {
              "content-type": "application/json",
              ...(token ? { authorization: `Bearer ${token}` } : {}),
            },
            body: JSON.stringify({
              relationType: draft.relationType,
              relatedTaskId: draft.relatedTaskId,
              note: draft.relationNote,
            }),
          });
          const relationBody = (await relationResponse.json().catch(() => null)) as { error?: string; relation?: TaskRelation } | null;
          if (!relationResponse.ok || !relationBody?.relation) throw new Error(relationBody?.error || "Relationship konnte nicht gespeichert werden.");
          setData((current) => ({
            ...current,
            taskRelations: [relationBody.relation!, ...current.taskRelations],
            tasks: current.tasks.map((task) =>
              task.id === body.task!.id || task.id === draft.relatedTaskId
                ? { ...task, githubSyncStatus: "not_synced", githubSyncError: "" }
                : task,
            ),
          }));
        }

        if (draft.createGitHubIssue && body.task.taskType === "deliverable") {
          rememberGitHubProviderToken(session?.data.session?.provider_token);
          const syncResponse = await fetch(`/api/tasks/${body.task.id}/sync-github`, {
            method: "POST",
            headers: requestHeaders(token, { github: true }),
            body: JSON.stringify({ createIfMissing: true }),
          });
          const syncBody = (await syncResponse.json().catch(() => null)) as { error?: string; task?: Task } | null;
          if (!syncResponse.ok || !syncBody?.task) throw new Error(syncBody?.error || "GitHub-Issue konnte nicht angelegt werden.");
          setData((current) => ({
            ...current,
            tasks: current.tasks.map((task) => (task.id === body.task!.id ? syncBody.task! : task)),
          }));
        }
      } catch (error) {
        if (!createdTaskCommitted) {
          setData((current) => ({
            ...current,
            tasks: current.tasks.filter((task) => task.id !== localTask.id),
            decisionTaskLinks: localDecisionLink ? current.decisionTaskLinks.filter((link) => link.id !== localDecisionLink.id) : current.decisionTaskLinks,
          }));
        }
        setSaveError(error instanceof Error ? error.message : "Aufgabe konnte nicht erstellt werden.");
      }
    });
  };

  const saveInitiative = (draft: InitiativeDraft) => {
    setSaveError("");

    const localInitiative: Package = {
      id: draft.id || `local-initiative-${Date.now()}`,
      milestoneId: draft.milestoneId,
      ownerId: draft.ownerId,
      accountableProfileId: draft.accountableProfileId,
      responsibleProfileIds: draft.responsibleProfileIds,
      consultedProfileIds: draft.consultedProfileIds,
      informedProfileIds: draft.informedProfileIds,
      title: draft.title,
      goal: draft.goal,
      priority: draft.priority || "P2",
      status: draft.status || "planned",
      targetDate: draft.targetDate,
      successCriteria: draft.successCriteria,
      scopeConstraints: draft.scopeConstraints,
      sortOrder: draft.id ? data.packages.find((pack) => pack.id === draft.id)?.sortOrder || data.packages.length + 1 : data.packages.length + 1,
    };
    const isEdit = Boolean(draft.id);

    setData((current) => ({
      ...current,
      packages: isEdit
        ? current.packages.map((pack) => (pack.id === draft.id ? { ...pack, ...localInitiative } : pack))
        : [...current.packages, localInitiative],
    }));
    setInitiativeDialogDefaults(null);

    if (source !== "supabase") return;

    startTransition(async () => {
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;

      try {
        const response = await fetch(isEdit ? `/api/initiatives/${draft.id}` : "/api/initiatives", {
          method: isEdit ? "PATCH" : "POST",
          headers: requestHeaders(token),
          body: JSON.stringify(draft),
        });
        const body = (await response.json().catch(() => null)) as { error?: string; initiative?: Package } | null;
        if (!response.ok || !body?.initiative) throw new Error(body?.error || "Initiative konnte nicht gespeichert werden.");

        setData((current) => ({
          ...current,
          packages: isEdit
            ? current.packages.map((pack) => (pack.id === draft.id ? body.initiative! : pack))
            : current.packages.map((pack) => (pack.id === localInitiative.id ? body.initiative! : pack)),
        }));
      } catch (error) {
        setData((current) => ({
          ...current,
          packages: isEdit
            ? current.packages.map((pack) => (pack.id === draft.id ? data.packages.find((original) => original.id === draft.id) || pack : pack))
            : current.packages.filter((pack) => pack.id !== localInitiative.id),
        }));
        setSaveError(error instanceof Error ? error.message : "Initiative konnte nicht gespeichert werden.");
      }
    });
  };

  const upsertFocusItem = (task: Task, nextStep: string, status: TaskFocusItem["status"] = "planned") => {
    setSaveError("");
    const profileId = currentProfile?.id || "volkan";
    const existing = data.taskFocusItems.find((item) => item.profileId === profileId && item.taskId === task.id && item.focusDate === todayFocusDate);
    const position = existing?.position || Math.min(currentProfileFocusItems.length + 1, 3);
    const localItem: TaskFocusItem = {
      id: existing?.id || -Date.now(),
      profileId,
      taskId: task.id,
      focusDate: todayFocusDate,
      position,
      nextStep,
      status,
      createdAt: existing?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    };

    setData((current) => ({
      ...current,
      taskFocusItems: existing
        ? current.taskFocusItems.map((item) => (item.id === existing.id ? localItem : item))
        : [localItem, ...current.taskFocusItems],
    }));

    if (source !== "supabase") return;

    startTransition(async () => {
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;
      try {
        const response = await fetch("/api/focus", {
          method: "POST",
          headers: requestHeaders(token),
          body: JSON.stringify({ taskId: task.id, profileId, focusDate: todayFocusDate, position, nextStep, status }),
        });
        const body = (await response.json().catch(() => null)) as { error?: string; focusItem?: TaskFocusItem } | null;
        if (!response.ok || !body?.focusItem) throw new Error(body?.error || "Fokus konnte nicht gespeichert werden.");
        setData((current) => ({
          ...current,
          taskFocusItems: current.taskFocusItems.map((item) => (item.id === localItem.id ? body.focusItem! : item)),
        }));
      } catch (error) {
        setData((current) => ({
          ...current,
          taskFocusItems: existing ? current.taskFocusItems.map((item) => (item.id === existing.id ? existing : item)) : current.taskFocusItems.filter((item) => item.id !== localItem.id),
        }));
        setSaveError(error instanceof Error ? error.message : "Fokus konnte nicht gespeichert werden.");
      }
    });
  };

  const removeFocusItem = (focusItem: TaskFocusItem) => {
    setSaveError("");
    setData((current) => ({
      ...current,
      taskFocusItems: current.taskFocusItems.filter((item) => item.id !== focusItem.id),
    }));

    if (source !== "supabase") return;

    startTransition(async () => {
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;
      try {
        const response = await fetch(`/api/focus?id=${encodeURIComponent(String(focusItem.id))}`, {
          method: "DELETE",
          headers: requestHeaders(token, { json: false }),
        });
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        if (!response.ok) throw new Error(body?.error || "Fokus konnte nicht entfernt werden.");
      } catch (error) {
        setData((current) => ({ ...current, taskFocusItems: [focusItem, ...current.taskFocusItems] }));
        setSaveError(error instanceof Error ? error.message : "Fokus konnte nicht entfernt werden.");
      }
    });
  };

  const linkDecisionTask = (decisionId: number, taskId: string, note: string) => {
    setSaveError("");
    const localLink: DecisionTaskLink = {
      id: -Date.now(),
      decisionId,
      taskId,
      linkType: "follows_from",
      note,
      createdBy: currentProfile?.id || "",
      createdAt: new Date().toISOString(),
    };

    setData((current) => {
      const exists = current.decisionTaskLinks.some((link) => link.decisionId === decisionId && link.taskId === taskId);
      return exists ? current : { ...current, decisionTaskLinks: [localLink, ...current.decisionTaskLinks] };
    });

    if (source !== "supabase") return;

    startTransition(async () => {
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;
      try {
        const response = await fetch(`/api/decisions/${decisionId}/tasks`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ taskId, linkType: "follows_from", note }),
        });
        const body = (await response.json().catch(() => null)) as { error?: string; link?: DecisionTaskLink } | null;
        if (!response.ok || !body?.link) throw new Error(body?.error || "Decision-Link konnte nicht gespeichert werden.");
        setData((current) => ({
          ...current,
          decisionTaskLinks: current.decisionTaskLinks.map((link) => (link.id === localLink.id ? body.link! : link)),
        }));
      } catch (error) {
        setData((current) => ({ ...current, decisionTaskLinks: current.decisionTaskLinks.filter((link) => link.id !== localLink.id) }));
        setSaveError(error instanceof Error ? error.message : "Decision-Link konnte nicht gespeichert werden.");
      }
    });
  };

  const removeDecisionTaskLink = (link: DecisionTaskLink) => {
    setSaveError("");
    setData((current) => ({
      ...current,
      decisionTaskLinks: current.decisionTaskLinks.filter((item) => item.id !== link.id),
    }));

    if (source !== "supabase") return;

    startTransition(async () => {
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;
      try {
        const response = await fetch(`/api/decisions/${link.decisionId}/tasks?linkId=${encodeURIComponent(String(link.id))}`, {
          method: "DELETE",
          headers: {
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
        });
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        if (!response.ok) throw new Error(body?.error || "Decision-Link konnte nicht entfernt werden.");
      } catch (error) {
        setData((current) => ({ ...current, decisionTaskLinks: [link, ...current.decisionTaskLinks] }));
        setSaveError(error instanceof Error ? error.message : "Decision-Link konnte nicht entfernt werden.");
      }
    });
  };

  const startTaskDrag = (task: Task, event: DragEvent<HTMLElement>) => {
    setDraggedTaskId(task.id);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", task.id);
    event.dataTransfer.setDragImage(transparentDragImage(), 0, 0);

    const preview = createTaskDragPreview(event.currentTarget, event.clientX, event.clientY);
    document.body.style.cursor = "none";

    const movePreview = (dragEvent: globalThis.DragEvent) => {
      if (dragEvent.clientX === 0 && dragEvent.clientY === 0) return;
      preview.style.left = `${dragEvent.clientX - 24}px`;
      preview.style.top = `${dragEvent.clientY - 18}px`;
    };
    const cleanupPreview = () => {
      preview.remove();
      document.body.style.cursor = "";
      window.removeEventListener("dragover", movePreview);
      window.removeEventListener("drop", cleanupPreview);
      window.removeEventListener("dragend", cleanupPreview);
    };

    window.addEventListener("dragover", movePreview);
    window.addEventListener("drop", cleanupPreview, { once: true });
    window.addEventListener("dragend", cleanupPreview, { once: true });
  };

  const dropTaskOnStatus = (status: TaskStatus, event: DragEvent<HTMLElement>) => {
    event.preventDefault();
    const taskId = event.dataTransfer.getData("text/plain") || draggedTaskId;
    const task = data.tasks.find((item) => item.id === taskId);
    setDraggedTaskId(null);
    setDragOverStatus(null);
    if (!task || normalizeStatus(task.status) === status) return;
    updateTask(task, { status });
  };

  const endTaskDrag = () => {
    setDraggedTaskId(null);
    setDragOverStatus(null);
  };

  const togglePackageCollapse = (packageId: string) => {
    setExpandedPackages((current) => ({ ...current, [packageId]: !current[packageId] }));
  };

  const setAllPackageCollapse = (collapsed: boolean) => {
    setExpandedPackages(Object.fromEntries(data.packages.map((pack) => [pack.id, !collapsed])));
  };

  const updateSprint = (sprint: Sprint, patch: Partial<Sprint>) => {
    setSaveError("");

    setData((current) => ({
      ...current,
      sprints: current.sprints.map((item) => (item.id === sprint.id ? { ...item, ...patch } : item)),
    }));

    if (source !== "supabase") return;

    startTransition(async () => {
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;

      try {
        const response = await fetch(`/api/sprints/${sprint.id}`, {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            name: patch.name,
            status: patch.status,
            startDate: patch.startDate,
            endDate: patch.endDate,
            reviewDueAt: patch.reviewDueAt,
          }),
        });

        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error || "Sprint konnte nicht gespeichert werden.");
        }

        const body = (await response.json()) as { sprint?: Sprint };
        if (body.sprint) {
          setData((current) => ({
            ...current,
            sprints: current.sprints.map((item) => (item.id === sprint.id ? body.sprint! : item)),
          }));
        }
      } catch (error) {
        setData((current) => ({
          ...current,
          sprints: current.sprints.map((item) => (item.id === sprint.id ? sprint : item)),
        }));
        setSaveError(error instanceof Error ? error.message : "Sprint konnte nicht gespeichert werden.");
      }
    });
  };

  const createSprintPlanAsync = async (options: SprintPlanningOptions, silent = false) => {
    const protectedSprintIds = new Set(data.tasks.filter((task) => task.sprintId).map((task) => task.sprintId));
    const drafts = futureSprintDrafts(data.sprints, options, protectedSprintIds);
    if (!drafts.length) {
      if (!silent) setSprintLockMessage("Die Sprint-Zeiträume entsprechen bereits der aktuellen Logik. Sprints mit Aufgabenbezug werden nicht automatisch umgeplant.");
      return 0;
    }

    const draftIds = new Set(drafts.map((sprint) => sprint.id));
    setData((current) => ({
      ...current,
      sprints: [
        ...current.sprints.filter((sprint) => !draftIds.has(sprint.id)),
        ...drafts,
      ].sort((a, b) => (a.startDate || "").localeCompare(b.startDate || "")),
    }));

    if (source !== "supabase") {
      if (!silent) setSprintLockMessage(`${drafts.length} Sprint${drafts.length === 1 ? "" : "s"} lokal aktualisiert.`);
      return drafts.length;
    }

    const session = await getBrowserSupabase()?.auth.getSession();
    const token = session?.data.session?.access_token;

    try {
      const response = await fetch("/api/sprints", {
        method: "POST",
        headers: {
          "content-type": "application/json",
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify(options),
      });

      const body = (await response.json().catch(() => null)) as { error?: string; sprints?: Sprint[] } | null;
      if (!response.ok) throw new Error(body?.error || "Sprints konnten nicht angelegt werden.");

      if (body?.sprints) {
        setData((current) => ({
          ...current,
          sprints: [
            ...current.sprints.filter((sprint) => !draftIds.has(sprint.id)),
            ...body.sprints!,
          ].sort((a, b) => (a.startDate || "").localeCompare(b.startDate || "")),
        }));
      }

      if (!silent) setSprintLockMessage(`${body?.sprints?.length || drafts.length} Sprint${(body?.sprints?.length || drafts.length) === 1 ? "" : "s"} aktualisiert. Sprints mit Aufgabenbezug bleiben geschützt.`);
      return body?.sprints?.length || drafts.length;
    } catch (error) {
      setData((current) => ({
        ...current,
        sprints: current.sprints.filter((sprint) => !draftIds.has(sprint.id)),
      }));
      setSaveError(error instanceof Error ? error.message : "Sprints konnten nicht angelegt werden.");
      return 0;
    }
  };

  const createSprintPlan = (options: SprintPlanningOptions) => {
    setSaveError("");
    setSprintLockMessage("");
    startTransition(async () => {
      await createSprintPlanAsync(options);
    });
  };

  const updateSprintCommitment = (commitment: SprintCommitment) => {
    setSaveError("");

    setData((current) => {
      const exists = current.sprintCommitments.some((item) => item.sprintId === commitment.sprintId && item.profileId === commitment.profileId);
      return {
        ...current,
        sprintCommitments: exists
          ? current.sprintCommitments.map((item) => (item.sprintId === commitment.sprintId && item.profileId === commitment.profileId ? commitment : item))
          : [commitment, ...current.sprintCommitments],
      };
    });

    if (source !== "supabase") return;

    startTransition(async () => {
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;

      try {
        const response = await fetch("/api/sprint-commitments", {
          method: "PUT",
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(commitment),
        });

        const body = (await response.json().catch(() => null)) as { error?: string; commitment?: SprintCommitment } | null;
        if (!response.ok || !body?.commitment) throw new Error(body?.error || "Commitment konnte nicht gespeichert werden.");

        setData((current) => ({
          ...current,
          sprintCommitments: current.sprintCommitments.map((item) =>
            item.sprintId === commitment.sprintId && item.profileId === commitment.profileId ? body.commitment! : item,
          ),
        }));
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : "Commitment konnte nicht gespeichert werden.");
      }
    });
  };

  const updateProfile = (profile: Profile, patch: Partial<Profile>) => {
    setSaveError("");

    setData((current) => ({
      ...current,
      profiles: current.profiles.map((item) => {
        if (item.id === profile.id) return { ...item, ...patch };
        if (patch.platformRole === "ceo" && item.platformRole === "ceo") {
          return { ...item, platformRole: "founder", orgRole: item.orgRole === "CEO" ? "Founder" : item.orgRole };
        }
        return item;
      }),
    }));

    if (source !== "supabase") return;

    startTransition(async () => {
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;

      try {
        const response = await fetch(`/api/profiles/${profile.id}`, {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            githubLogin: patch.githubLogin,
            platformRole: patch.platformRole,
            orgRole: patch.orgRole,
            deputyFor: patch.deputyFor,
            deputyActiveFrom: patch.deputyActiveFrom,
            deputyActiveUntil: patch.deputyActiveUntil,
            focus: patch.focus,
            weeklyCapacity: patch.weeklyCapacity,
            color: patch.color,
            googleChatUserId: patch.googleChatUserId,
            googleChatDmSpace: patch.googleChatDmSpace,
            notificationsEnabled: patch.notificationsEnabled,
            googleCalendarEmail: patch.googleCalendarEmail,
            googleCalendarSyncEnabled: patch.googleCalendarSyncEnabled,
          }),
        });

        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error || "Profil konnte nicht gespeichert werden.");
        }
      } catch (error) {
        setData((current) => ({
          ...current,
          profiles: current.profiles.map((item) => (item.id === profile.id ? profile : item)),
        }));
        setSaveError(error instanceof Error ? error.message : "Profil konnte nicht gespeichert werden.");
      }
    });
  };

  const updateNotificationPreference = (profileId: string, eventType: string, enabled: boolean) => {
    setSaveError("");

    const previousPreferences = data.notificationPreferences;
    const localPreference: NotificationPreference = {
      id: previousPreferences.find((item) => item.profileId === profileId && item.channel === "google_chat" && item.eventType === eventType)?.id || Date.now(),
      profileId,
      channel: "google_chat",
      eventType,
      enabled,
    };

    setData((current) => {
      const exists = current.notificationPreferences.some((item) => item.profileId === profileId && item.channel === "google_chat" && item.eventType === eventType);
      return {
        ...current,
        notificationPreferences: exists
          ? current.notificationPreferences.map((item) =>
            item.profileId === profileId && item.channel === "google_chat" && item.eventType === eventType ? { ...item, enabled } : item
          )
          : [localPreference, ...current.notificationPreferences],
      };
    });

    if (source !== "supabase") return;

    startTransition(async () => {
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;

      try {
        const response = await fetch("/api/notification-preferences", {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ profileId, eventType, enabled }),
        });
        const body = (await response.json().catch(() => null)) as { error?: string; preference?: NotificationPreference } | null;
        if (!response.ok || !body?.preference) throw new Error(body?.error || "Benachrichtigungseinstellung konnte nicht gespeichert werden.");

        setData((current) => ({
          ...current,
          notificationPreferences: current.notificationPreferences.map((item) =>
            item.profileId === profileId && item.channel === "google_chat" && item.eventType === eventType ? body.preference! : item
          ),
        }));
      } catch (error) {
        setData((current) => ({ ...current, notificationPreferences: previousPreferences }));
        setSaveError(error instanceof Error ? error.message : "Benachrichtigungseinstellung konnte nicht gespeichert werden.");
      }
    });
  };

  const updateMeetingAttendance = (meeting: Meeting, attendance: MeetingAttendance) => {
    setSaveError("");

    const previousData = data;
    setData((current) => {
      const exists = current.meetingAttendance.some((item) => item.meetingId === attendance.meetingId && item.profileId === attendance.profileId);
      return {
        ...current,
        meetingAttendance: exists
          ? current.meetingAttendance.map((item) => (item.meetingId === attendance.meetingId && item.profileId === attendance.profileId ? attendance : item))
          : [attendance, ...current.meetingAttendance],
      };
    });

    if (source !== "supabase") return;

    startTransition(async () => {
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;

      try {
        const response = await fetch(`/api/meetings/${meeting.id}/attendance`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            profileId: attendance.profileId,
            status: attendance.status,
            absenceReason: attendance.absenceReason,
            reasonAccepted: attendance.reasonAccepted,
            writtenUpdate: attendance.writtenUpdate,
            points: attendance.points,
          }),
        });

        const body = (await response.json().catch(() => null)) as { error?: string; attendance?: MeetingAttendance } | null;
        if (!response.ok || !body?.attendance) throw new Error(body?.error || "Meeting-Rückmeldung konnte nicht gespeichert werden.");

        setData((current) => ({
          ...current,
          meetingAttendance: current.meetingAttendance.map((item) =>
            item.meetingId === attendance.meetingId && item.profileId === attendance.profileId ? body.attendance! : item,
          ),
        }));
      } catch (error) {
        setData(previousData);
        setSaveError(error instanceof Error ? error.message : "Meeting-Rückmeldung konnte nicht gespeichert werden.");
      }
    });
  };

  const createMeetingFromSlot = (payload: {
    title: string;
    agenda: string;
    sprintId: string;
    meetingAt: string;
    durationMinutes: number;
    profileIds: string[];
  }) => {
    setSaveError("");
    setMeetingCreateMessage("");

    const localMeetingId = Date.now();
    const now = new Date().toISOString();
    const localMeeting: Meeting = {
      id: localMeetingId,
      sprintId: payload.sprintId,
      title: payload.title,
      meetingAt: payload.meetingAt,
      durationMinutes: payload.durationMinutes,
      status: "planned",
      agenda: payload.agenda,
      googleCalendarSyncStatus: "not_synced",
    };
    const localAttendance: MeetingAttendance[] = payload.profileIds.map((profileId, index) => ({
      id: localMeetingId + index + 1,
      meetingId: localMeetingId,
      profileId,
      status: "pending",
      absenceReason: "",
      reasonAccepted: false,
      writtenUpdate: "",
      points: 0,
      createdAt: now,
      updatedAt: now,
    }));
    const previousData = data;

    setData((current) => ({
      ...current,
      meetings: [localMeeting, ...current.meetings],
      meetingAttendance: [...localAttendance, ...current.meetingAttendance],
    }));
    setMeetingCreateMessage(`Meeting vorgemerkt: ${payload.title}`);

    if (source !== "supabase") return;

    startTransition(async () => {
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;

      try {
        const response = await fetch("/api/meetings", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(payload),
        });

        const body = (await response.json().catch(() => null)) as { error?: string; meeting?: Meeting; attendance?: MeetingAttendance[]; calendarSync?: { status: "synced" | "skipped" | "failed"; htmlLink?: string; error?: string } } | null;
        if (!response.ok || !body?.meeting) throw new Error(body?.error || "Meeting konnte nicht vorgemerkt werden.");

        setData((current) => ({
          ...current,
          meetings: current.meetings.map((item) => (item.id === localMeetingId ? body.meeting! : item)),
          meetingAttendance: [
            ...(body.attendance || []),
            ...current.meetingAttendance.filter((item) => item.meetingId !== localMeetingId),
          ],
        }));
        setMeetingCreateMessage(body.calendarSync?.status === "synced"
          ? `Meeting angelegt und mit Google Kalender synchronisiert: ${body.meeting.title}`
          : body.calendarSync?.status === "failed"
            ? `Meeting angelegt. Google Kalender Sync fehlgeschlagen: ${body.calendarSync.error}`
            : `Meeting in der App angelegt: ${body.meeting.title}`);
      } catch (error) {
        setData(previousData);
        setMeetingCreateMessage("");
        setSaveError(error instanceof Error ? error.message : "Meeting konnte nicht vorgemerkt werden.");
      }
    });
  };

  const updateMeeting = (meeting: Meeting, patch: Partial<Pick<Meeting, "title" | "agenda" | "meetingAt" | "status">>) => {
    setSaveError("");
    setMeetingCreateMessage("");

    const previousData = data;
    const nextMeeting = { ...meeting, ...patch };
    setData((current) => ({
      ...current,
      meetings: current.meetings.map((item) => (item.id === meeting.id ? nextMeeting : item)),
    }));
    setMeetingCreateMessage(nextMeeting.status === "cancelled" ? `Meeting abgesagt: ${nextMeeting.title}` : `Meeting aktualisiert: ${nextMeeting.title}`);

    if (source !== "supabase") return;

    startTransition(async () => {
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;

      try {
        const response = await fetch("/api/meetings", {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            id: meeting.id,
            title: patch.title,
            agenda: patch.agenda,
            meetingAt: patch.meetingAt,
            status: patch.status,
          }),
        });

        const body = (await response.json().catch(() => null)) as { error?: string; meeting?: Meeting } | null;
        if (!response.ok || !body?.meeting) throw new Error(body?.error || "Meeting konnte nicht aktualisiert werden.");

        setData((current) => ({
          ...current,
          meetings: current.meetings.map((item) => (item.id === meeting.id ? body.meeting! : item)),
        }));
        setMeetingCreateMessage(body.meeting.status === "cancelled" ? `Meeting abgesagt: ${body.meeting.title}` : `Meeting aktualisiert: ${body.meeting.title}`);
      } catch (error) {
        setData(previousData);
        setMeetingCreateMessage("");
        setSaveError(error instanceof Error ? error.message : "Meeting konnte nicht aktualisiert werden.");
      }
    });
  };

  const createAvailability = (entry: Omit<AvailabilityEntry, "id">) => {
    setSaveError("");

    const localEntry: AvailabilityEntry = { ...entry, id: optimisticAvailabilityIdRef.current };
    optimisticAvailabilityIdRef.current -= 1;
    const previousData = data;
    setData((current) => ({
      ...current,
      availability: [localEntry, ...current.availability],
    }));

    if (source !== "supabase") return;

    startTransition(async () => {
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;

      try {
        const response = await fetch("/api/availability", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(entry),
        });
        const body = (await response.json().catch(() => null)) as { error?: string; availability?: AvailabilityEntry } | null;
        if (!response.ok || !body?.availability) throw new Error(body?.error || "Verfügbarkeit konnte nicht gespeichert werden.");

        setData((current) => ({
          ...current,
          availability: current.availability.map((item) => (item.id === localEntry.id ? body.availability! : item)),
        }));
      } catch (error) {
        setData(previousData);
        setSaveError(error instanceof Error ? error.message : "Verfügbarkeit konnte nicht gespeichert werden.");
      }
    });
  };

  const deleteAvailability = (entry: AvailabilityEntry) => {
    setSaveError("");

    const previousData = data;
    setData((current) => ({
      ...current,
      availability: current.availability.filter((item) => item.id !== entry.id),
    }));

    if (source !== "supabase") return;

    startTransition(async () => {
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;

      try {
        const response = await fetch("/api/availability", {
          method: "DELETE",
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ id: entry.id }),
        });
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        if (!response.ok) throw new Error(body?.error || "Verfügbarkeit konnte nicht gelöscht werden.");
      } catch (error) {
        setData(previousData);
        setSaveError(error instanceof Error ? error.message : "Verfügbarkeit konnte nicht gelöscht werden.");
      }
    });
  };

  const updateAvailability = (entry: AvailabilityEntry, patch: Partial<Omit<AvailabilityEntry, "id" | "source" | "externalId" | "externalCalendarId" | "syncedAt">>) => {
    setSaveError("");

    const updatedEntry: AvailabilityEntry = { ...entry, ...patch };
    const previousData = data;
    setData((current) => ({
      ...current,
      availability: current.availability.map((item) => (item.id === entry.id ? updatedEntry : item)),
    }));

    if (source !== "supabase") return;

    startTransition(async () => {
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;

      try {
        const response = await fetch("/api/availability", {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ id: entry.id, ...patch }),
        });
        const body = (await response.json().catch(() => null)) as { error?: string; availability?: AvailabilityEntry } | null;
        if (!response.ok || !body?.availability) throw new Error(body?.error || "Verfügbarkeit konnte nicht aktualisiert werden.");

        setData((current) => ({
          ...current,
          availability: current.availability.map((item) => (item.id === entry.id ? body.availability! : item)),
        }));
      } catch (error) {
        setData(previousData);
        setSaveError(error instanceof Error ? error.message : "Verfügbarkeit konnte nicht aktualisiert werden.");
      }
    });
  };

  const syncGoogleCalendar = () => {
    setSaveError("");
    setCalendarSyncMessage("Google Calendar Sync wird geprüft...");

    if (source !== "supabase") {
      setCalendarSyncMessage("Google Calendar Sync ist nur mit Supabase-Datenquelle aktiv.");
      return;
    }

    startTransition(async () => {
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;

      try {
        const response = await fetch("/api/calendar-sync", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
        });
        const body = (await response.json().catch(() => null)) as {
          error?: string;
          ready?: boolean;
          skipped?: boolean;
          reason?: string;
          imported?: number;
          removed?: number;
          syncedAt?: string;
          availability?: AvailabilityEntry[];
          results?: Array<{ profileId: string; email: string; imported: number; removed?: number; error?: string }>;
        } | null;

        if (!response.ok) throw new Error(body?.error || "Google Calendar Sync konnte nicht ausgeführt werden.");

        if (body?.availability) {
          setData((current) => ({ ...current, availability: body.availability! }));
        }

        const failedProfiles = body?.results?.filter((result) => result.error).length || 0;
        if (body?.skipped) {
          setCalendarSyncMessage(body.reason || "Google Calendar Sync wurde übersprungen.");
        } else {
          setCalendarSyncMessage(`Google Calendar Sync abgeschlossen: ${body?.imported || 0} Kalenderblöcke importiert, ${body?.removed || 0} alte Blöcke entfernt${failedProfiles ? `, ${failedProfiles} Profil(e) mit Fehler` : ""}.`);
        }
      } catch (error) {
        const message = error instanceof Error ? error.message : "Google Calendar Sync konnte nicht ausgeführt werden.";
        setCalendarSyncMessage(message);
        setSaveError(message);
      }
    });
  };

  const createDecision = (payload: { title: string; context: string; decision: string; requiredProfileIds: string[] }) => {
    setSaveError("");

    startTransition(async () => {
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;

      try {
        const response = await fetch("/api/decisions", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(payload),
        });

        const body = (await response.json().catch(() => null)) as { error?: string; decision?: PlanningData["decisions"][number] } | null;
        if (!response.ok || !body?.decision) {
          throw new Error(body?.error || "Decision konnte nicht erstellt werden.");
        }

        setData((current) => ({
          ...current,
          decisions: [body.decision!, ...current.decisions],
          audit: [
            {
              id: Date.now(),
              entityType: "decision",
              entityId: String(body.decision!.id),
              action: "create",
              actorProfileId: currentProfile?.id || "",
              createdAt: new Date().toISOString(),
            },
            ...current.audit,
          ],
        }));
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : "Decision konnte nicht erstellt werden.");
      }
    });
  };

  const confirmDecision = (decisionId: number) => {
    if (!currentProfile) {
      setSaveError("GitHub-User ist keinem Teamprofil zugeordnet.");
      return;
    }

    setSaveError("");

    startTransition(async () => {
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;

      try {
        const response = await fetch(`/api/decisions/${decisionId}/confirm`, {
          method: "POST",
          headers: {
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
        });

        const body = (await response.json().catch(() => null)) as { error?: string; locked?: boolean; confirmedProfileIds?: string[] } | null;
        if (!response.ok) throw new Error(body?.error || "Bestätigung konnte nicht gespeichert werden.");

        setData((current) => ({
          ...current,
          decisions: current.decisions.map((decision) => {
            if (decision.id !== decisionId) return decision;
            const confirmedProfileIds = body?.confirmedProfileIds || [...new Set([...decision.confirmedProfileIds, currentProfile.id])];
            return {
              ...decision,
              confirmedProfileIds,
              status: body?.locked ? "locked" : decision.status,
              lockedAt: body?.locked ? new Date().toISOString() : decision.lockedAt,
            };
          }),
          audit: [
            {
              id: Date.now(),
              entityType: "decision",
              entityId: String(decisionId),
              action: body?.locked ? "confirm_and_lock" : "confirm",
              actorProfileId: currentProfile.id,
              createdAt: new Date().toISOString(),
            },
            ...current.audit,
          ],
        }));
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : "Bestätigung konnte nicht gespeichert werden.");
      }
    });
  };

  const editDecision = (decisionId: number, payload: { title: string; context: string; decision: string; requiredProfileIds: string[] }) => {
    setSaveError("");

    startTransition(async () => {
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;

      try {
        const response = await fetch(`/api/decisions/${decisionId}`, {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(payload),
        });

        const body = (await response.json().catch(() => null)) as { error?: string; decision?: PlanningData["decisions"][number] } | null;
        if (!response.ok || !body?.decision) throw new Error(body?.error || "Decision konnte nicht aktualisiert werden.");

        setData((current) => ({
          ...current,
          decisions: current.decisions.map((decision) => (decision.id === decisionId ? body.decision! : decision)),
          audit: [
            {
              id: Date.now(),
              entityType: "decision",
              entityId: String(decisionId),
              action: "decision.update",
              actorProfileId: currentProfile?.id || "",
              createdAt: new Date().toISOString(),
              beforeData: current.decisions.find((decision) => decision.id === decisionId) || null,
              afterData: body.decision,
            },
            ...current.audit,
          ],
        }));
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : "Decision konnte nicht aktualisiert werden.");
      }
    });
  };

  const objectDecision = (decisionId: number, comment: string) => {
    if (!currentProfile) {
      setSaveError("GitHub-User ist keinem Teamprofil zugeordnet.");
      return;
    }

    setSaveError("");

    startTransition(async () => {
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;

      try {
        const response = await fetch(`/api/decisions/${decisionId}/objections`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ comment }),
        });

        const body = (await response.json().catch(() => null)) as { error?: string; comment?: PlanningData["decisionComments"][number] } | null;
        if (!response.ok || !body?.comment) throw new Error(body?.error || "Einwand konnte nicht gespeichert werden.");

        setData((current) => ({
          ...current,
          decisionComments: [body.comment!, ...current.decisionComments],
          audit: [
            {
              id: Date.now(),
              entityType: "decision",
              entityId: String(decisionId),
              action: "decision.objection",
              actorProfileId: currentProfile.id,
              createdAt: new Date().toISOString(),
            },
            ...current.audit,
          ],
        }));
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : "Einwand konnte nicht gespeichert werden.");
      }
    });
  };

  const reviewTask = (
    task: Task,
    reviewStatus: "accepted" | "partial" | "changes_requested",
    scorePoints: number,
    checklist?: { acceptanceCriteriaMet?: boolean; dodMet?: boolean; evidenceProvided?: boolean; communicationClear?: boolean; blockerHandled?: boolean },
    comment?: string,
  ) => {
    setSaveError("");

    const nextStatus = reviewStatus === "accepted" ? "Erledigt" : reviewStatus === "changes_requested" ? "Nacharbeit" : "Review";
    const scoreFinal = reviewStatus !== "changes_requested";
    const previousTask = task;

    setData((current) => ({
      ...current,
      tasks: current.tasks.map((item) =>
        item.id === task.id ? { ...item, status: nextStatus, reviewStatus, scorePoints, scoreFinal } : item,
      ),
    }));

    if (source !== "supabase") return;

    startTransition(async () => {
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;

      try {
        const response = await fetch(`/api/tasks/${task.id}/review`, {
          method: "POST",
          headers: requestHeaders(token),
          body: JSON.stringify({ decision: reviewStatus, points: scorePoints, checklist, comment }),
        });

        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        if (!response.ok) throw new Error(body?.error || "Review konnte nicht gespeichert werden.");
        if (hasGitHubIssue(task) && githubProviderTokenAvailable) {
          syncTaskToGitHub({ ...task, status: nextStatus, reviewStatus, scorePoints, scoreFinal }, { silent: true });
        }
      } catch (error) {
        setData((current) => ({
          ...current,
          tasks: current.tasks.map((item) => (item.id === task.id ? previousTask : item)),
        }));
        setSaveError(error instanceof Error ? error.message : "Review konnte nicht gespeichert werden.");
      }
    });
  };

  const addTaskComment = (task: Task, comment: string) => {
    if (!currentProfile) {
      setSaveError("GitHub-User ist keinem Teamprofil zugeordnet.");
      return;
    }

    setSaveError("");

    if (source !== "supabase") {
      setData((current) => ({
        ...current,
        taskComments: [
          {
            id: Date.now(),
            taskId: task.id,
            profileId: currentProfile.id,
            comment,
            createdAt: new Date().toISOString(),
          },
          ...current.taskComments,
        ],
      }));
      return;
    }

    setCommentImportPendingTaskIds((current) => new Set(current).add(task.id));
    startTransition(async () => {
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;
      rememberGitHubProviderToken(session?.data.session?.provider_token);

      try {
        const response = await fetch(`/api/tasks/${task.id}/comments`, {
          method: "POST",
          headers: requestHeaders(token, { github: true }),
          body: JSON.stringify({ comment }),
        });

        const body = (await response.json().catch(() => null)) as { error?: string; githubSyncError?: string; comment?: PlanningData["taskComments"][number] } | null;
        if (!response.ok || !body?.comment) throw new Error(body?.error || "Kommentar konnte nicht gespeichert werden.");

        setData((current) => ({
          ...current,
          tasks: current.tasks.map((item) => (item.id === task.id ? {
            ...item,
            githubSyncStatus: body.githubSyncError ? "failed" : "not_synced",
            githubSyncError: body.githubSyncError || "",
          } : item)),
          taskComments: [body.comment!, ...current.taskComments],
        }));
        if (body.githubSyncError) {
          setSaveError(`Kommentar gespeichert, aber GitHub-Sync ist fehlgeschlagen: ${body.githubSyncError}`);
        }
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : "Kommentar konnte nicht gespeichert werden.");
      }
    });
  };

  const uploadTaskAttachment = async (task: Task, file: File) => {
    setSaveError("");

    if (source !== "supabase") {
      throw new Error("Anhänge können nur mit Supabase- und GitHub-Login hochgeladen werden.");
    }

    const session = await getBrowserSupabase()?.auth.getSession();
    const token = session?.data.session?.access_token;
    rememberGitHubProviderToken(session?.data.session?.provider_token);
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch(`/api/tasks/${task.id}/attachments`, {
      method: "POST",
      headers: requestHeaders(token, { json: false, github: true }),
      body: formData,
    });

    const body = (await response.json().catch(() => null)) as { error?: string; markdown?: string } | null;
    if (!response.ok || !body?.markdown) throw new Error(body?.error || "Anhang konnte nicht hochgeladen werden.");
    setData((current) => ({
      ...current,
      tasks: current.tasks.map((item) => (item.id === task.id ? { ...item, githubSyncStatus: "not_synced", githubSyncError: "" } : item)),
      taskActivity: [
        {
          id: Date.now(),
          taskId: task.id,
          message: `Anhang hochgeladen: ${file.name}`,
          createdAt: new Date().toISOString(),
        },
        ...current.taskActivity,
      ],
    }));
    return body.markdown;
  };

  const importGitHubComments = useCallback((task: Task, options: { silent?: boolean } = {}) => {
    if (!options.silent) {
      setSaveError("");
      setCommentImportNotice("");
    }

    if (source !== "supabase") {
      if (!options.silent) setSaveError("GitHub-Kommentarimport ist nur mit Supabase-Datenquelle verfügbar.");
      return;
    }

    startTransition(async () => {
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;
      rememberGitHubProviderToken(session?.data.session?.provider_token);

      try {
        const response = await fetch(`/api/tasks/${task.id}/github-comments`, {
          method: "POST",
          headers: requestHeaders(token, { github: true }),
        });

        const body = (await response.json().catch(() => null)) as { error?: string; imported?: number; evidenceLink?: string; comments?: TaskExternalComment[] } | null;
        if (!response.ok || !body?.comments) throw new Error(body?.error || "GitHub-Kommentare konnten nicht aktualisiert werden.");

        setData((current) => ({
          ...current,
          tasks: body.evidenceLink
            ? current.tasks.map((item) => (item.id === task.id ? { ...item, evidenceLink: body.evidenceLink || item.evidenceLink, githubSyncStatus: "not_synced" } : item))
            : current.tasks,
          taskExternalComments: [
            ...current.taskExternalComments.filter((comment) => comment.taskId !== task.id),
            ...body.comments!,
          ],
        }));
        const total = body.comments.length;
        if (!options.silent) {
          setCommentImportNotice(
            total > 0
              ? `GitHub-Kommentare geladen: ${total} Kommentar${total === 1 ? "" : "e"}.`
              : "GitHub wurde geprüft, aber für dieses Issue wurden keine externen Kommentare gefunden.",
          );
        }
      } catch (error) {
        if (!options.silent) setSaveError(error instanceof Error ? error.message : "GitHub-Kommentare konnten nicht aktualisiert werden.");
      } finally {
        setCommentImportPendingTaskIds((current) => {
          const next = new Set(current);
          next.delete(task.id);
          return next;
        });
      }
    });
  }, [requestHeaders, source, startTransition]);

  useEffect(() => {
    if (!selectedTask) return;
    if (source !== "supabase") return;
    if (!githubProviderTokenAvailable) return;
    if (!hasGitHubIssue(selectedTask)) return;
    if (autoImportedGitHubCommentsRef.current.has(selectedTask.id)) return;

    autoImportedGitHubCommentsRef.current.add(selectedTask.id);
    importGitHubComments(selectedTask, { silent: true });
  }, [githubProviderTokenAvailable, importGitHubComments, selectedTask, source]);

  const reportTaskBlocker = (task: Task, payload: { reason: string; impact: string; needsHelpFrom: string }) => {
    if (!currentProfile) {
      setSaveError("GitHub-User ist keinem Teamprofil zugeordnet.");
      return;
    }

    setSaveError("");

    const localBlocker = {
      id: Date.now(),
      taskId: task.id,
      profileId: currentProfile.id,
      reason: payload.reason,
      impact: payload.impact,
      needsHelpFrom: payload.needsHelpFrom,
      status: "open" as const,
      createdAt: new Date().toISOString(),
      resolvedAt: "",
    };
    const previousTask = task;

    setData((current) => ({
      ...current,
      tasks: current.tasks.map((item) => (item.id === task.id ? { ...item, status: "Blockiert", githubSyncStatus: "not_synced", githubSyncError: "" } : item)),
      taskBlockers: [localBlocker, ...current.taskBlockers],
    }));

    if (source !== "supabase") return;

    startTransition(async () => {
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;

      try {
        const response = await fetch(`/api/tasks/${task.id}/blockers`, {
          method: "POST",
          headers: requestHeaders(token),
          body: JSON.stringify(payload),
        });

        const body = (await response.json().catch(() => null)) as { error?: string; blocker?: PlanningData["taskBlockers"][number] } | null;
        if (!response.ok || !body?.blocker) throw new Error(body?.error || "Blocker konnte nicht gespeichert werden.");

        setData((current) => ({
          ...current,
          taskBlockers: [body.blocker!, ...current.taskBlockers.filter((blocker) => blocker.id !== localBlocker.id)],
        }));
      } catch (error) {
        setData((current) => ({
          ...current,
          tasks: current.tasks.map((item) => (item.id === task.id ? previousTask : item)),
          taskBlockers: current.taskBlockers.filter((blocker) => blocker.id !== localBlocker.id),
        }));
        setSaveError(error instanceof Error ? error.message : "Blocker konnte nicht gespeichert werden.");
      }
    });
  };

  const addTaskRelation = (task: Task, payload: { relationType: TaskRelationType; relatedTaskId: string; note: string }) => {
    setSaveError("");
    if (!payload.relatedTaskId || payload.relatedTaskId === task.id) return;

    const localRelation: TaskRelation = {
      id: Date.now(),
      taskId: task.id,
      relatedTaskId: payload.relatedTaskId,
      relationType: payload.relationType,
      note: payload.note,
      createdBy: currentProfile?.id || "",
      createdAt: new Date().toISOString(),
    };

    setData((current) => ({ ...current, taskRelations: [localRelation, ...current.taskRelations] }));
    setData((current) => ({
      ...current,
      tasks: current.tasks.map((item) =>
        item.id === task.id || item.id === payload.relatedTaskId
          ? { ...item, githubSyncStatus: "not_synced", githubSyncError: "" }
          : item,
      ),
    }));
    if (source !== "supabase") return;

    startTransition(async () => {
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;

      try {
        const response = await fetch(`/api/tasks/${task.id}/relationships`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(payload),
        });
        const body = (await response.json().catch(() => null)) as { error?: string; relation?: TaskRelation } | null;
        if (!response.ok || !body?.relation) throw new Error(body?.error || "Relationship konnte nicht gespeichert werden.");

        setData((current) => ({
          ...current,
          taskRelations: current.taskRelations.map((relation) => (relation.id === localRelation.id ? body.relation! : relation)),
        }));
      } catch (error) {
        setData((current) => ({
          ...current,
          taskRelations: current.taskRelations.filter((relation) => relation.id !== localRelation.id),
        }));
        setSaveError(error instanceof Error ? error.message : "Relationship konnte nicht gespeichert werden.");
      }
    });
  };

  const removeTaskRelation = (task: Task, relation: TaskRelation) => {
    setSaveError("");
    setData((current) => ({
      ...current,
      taskRelations: current.taskRelations.filter((item) => item.id !== relation.id),
      tasks: current.tasks.map((item) =>
        item.id === relation.taskId || item.id === relation.relatedTaskId
          ? { ...item, githubSyncStatus: "not_synced", githubSyncError: "" }
          : item,
      ),
    }));
    if (source !== "supabase") return;

    startTransition(async () => {
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;

      try {
        const response = await fetch(`/api/tasks/${task.id}/relationships`, {
          method: "DELETE",
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ relationId: relation.id }),
        });
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        if (!response.ok) throw new Error(body?.error || "Relationship konnte nicht entfernt werden.");
      } catch (error) {
        setData((current) => ({
          ...current,
          taskRelations: [relation, ...current.taskRelations],
        }));
        setSaveError(error instanceof Error ? error.message : "Relationship konnte nicht entfernt werden.");
      }
    });
  };

  const syncTaskToGitHub = (task: Task, options: { createIfMissing?: boolean; silent?: boolean } = {}) => {
    if (!options.silent) setSaveError("");

    const previousTask = task;
    setData((current) => ({
      ...current,
      tasks: current.tasks.map((item) => (item.id === task.id ? { ...item, githubSyncStatus: "pending", githubSyncError: "" } : item)),
    }));

    if (source !== "supabase") {
      setSaveError("GitHub Sync ist nur mit Supabase-Datenquelle verfügbar.");
      setData((current) => ({
        ...current,
        tasks: current.tasks.map((item) => (item.id === task.id ? previousTask : item)),
      }));
      return;
    }

    startTransition(async () => {
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;
      rememberGitHubProviderToken(session?.data.session?.provider_token);

      try {
        const response = await fetch(`/api/tasks/${task.id}/sync-github`, {
          method: "POST",
          headers: requestHeaders(token, { github: true }),
          body: JSON.stringify({ createIfMissing: Boolean(options.createIfMissing) }),
        });

        const body = (await response.json().catch(() => null)) as { error?: string; task?: Partial<Task> } | null;
        if (!response.ok || !body?.task) throw new Error(body?.error || "GitHub Sync konnte nicht ausgeführt werden.");

        setData((current) => ({
          ...current,
          tasks: current.tasks.map((item) => (item.id === task.id ? { ...item, ...body.task } : item)),
        }));
      } catch (error) {
        const message = error instanceof Error ? error.message : "GitHub Sync konnte nicht ausgeführt werden.";
        setData((current) => ({
          ...current,
          tasks: current.tasks.map((item) => (item.id === task.id ? { ...previousTask, githubSyncStatus: "failed", githubSyncError: message } : item)),
        }));
        if (!options.silent) setSaveError(message);
      }
    });
  };

  const syncLinkedGitHubTasks = () => {
    setSaveError("");

    if (source !== "supabase") {
      setSaveError("GitHub Sync ist nur mit Supabase-Datenquelle verfügbar.");
      return;
    }

    const queueTasks = data.tasks.filter((task) =>
      task.taskType === "deliverable" &&
      hasGitHubIssue(task) &&
      task.githubSyncStatus !== "synced"
    );

    if (!queueTasks.length) return;

    const previousTasks = new Map(queueTasks.map((task) => [task.id, task]));
    setData((current) => ({
      ...current,
      tasks: current.tasks.map((item) => queueTasks.some((task) => task.id === item.id) ? { ...item, githubSyncStatus: "pending", githubSyncError: "" } : item),
    }));

    startTransition(async () => {
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;
      rememberGitHubProviderToken(session?.data.session?.provider_token);

      for (const task of queueTasks) {
        try {
          const response = await fetch(`/api/tasks/${task.id}/sync-github`, {
            method: "POST",
            headers: requestHeaders(token, { github: true }),
            body: JSON.stringify({ createIfMissing: false }),
          });

          const body = (await response.json().catch(() => null)) as { error?: string; task?: Partial<Task> } | null;
          if (!response.ok || !body?.task) throw new Error(body?.error || "GitHub Sync konnte nicht ausgeführt werden.");

          setData((current) => ({
            ...current,
            tasks: current.tasks.map((item) => (item.id === task.id ? { ...item, ...body.task } : item)),
          }));
        } catch (error) {
          const message = error instanceof Error ? error.message : "GitHub Sync konnte nicht ausgeführt werden.";
          const previousTask = previousTasks.get(task.id) || task;
          setData((current) => ({
            ...current,
            tasks: current.tasks.map((item) => (item.id === task.id ? { ...previousTask, githubSyncStatus: "failed", githubSyncError: message } : item)),
          }));
          setSaveError(message);
        }
      }
    });
  };

  const deleteTask = (task: Task) => {
    if (!canManageTaskMeta) {
      setSaveError("Nur CEO oder Deputy können Aufgaben löschen.");
      return;
    }
    const confirmed = window.confirm(
      hasGitHubIssue(task)
        ? "Aufgabe aus der App löschen und das verknüpfte GitHub-Issue schließen?"
        : "Aufgabe aus der App löschen?",
    );
    if (!confirmed) return;

    setSaveError("");
    const previousTask = task;
    const previousRelations = data.taskRelations;
    const previousComments = data.taskComments;
    const previousActivity = data.taskActivity;

    setData((current) => ({
      ...current,
      tasks: current.tasks.filter((item) => item.id !== task.id && item.parentTaskId !== task.id),
      taskRelations: current.taskRelations.filter((relation) => relation.taskId !== task.id && relation.relatedTaskId !== task.id),
      taskComments: current.taskComments.filter((comment) => comment.taskId !== task.id),
      taskActivity: current.taskActivity.filter((activity) => activity.taskId !== task.id),
    }));
    closeTaskPanel();

    if (source !== "supabase") return;

    startTransition(async () => {
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;
      rememberGitHubProviderToken(session?.data.session?.provider_token);

      try {
        const response = await fetch(`/api/tasks/${task.id}`, {
          method: "DELETE",
          headers: requestHeaders(token, { json: false, github: true }),
        });
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        if (!response.ok) throw new Error(body?.error || "Aufgabe konnte nicht gelöscht werden.");
      } catch (error) {
        setData((current) => ({
          ...current,
          tasks: [previousTask, ...current.tasks],
          taskRelations: previousRelations,
          taskComments: previousComments,
          taskActivity: previousActivity,
        }));
        setSaveError(error instanceof Error ? error.message : "Aufgabe konnte nicht gelöscht werden.");
      }
    });
  };

  const refreshGoogleChatStatus = useCallback(async () => {
    if (source !== "supabase") return;

    const session = await getBrowserSupabase()?.auth.getSession();
    const token = session?.data.session?.access_token;

    try {
      const response = await fetch("/api/notifications/deliver", {
        headers: {
          ...(token ? { authorization: `Bearer ${token}` } : {}),
        },
      });
      const body = (await response.json().catch(() => null)) as {
        googleChat?: { webhookConfigured?: boolean; apiConfigured?: boolean; deliveryEnabled?: boolean; ready?: boolean; mode?: GoogleChatStatus["mode"] };
        googleChatConfigured?: boolean;
        pending?: number;
      } | null;
      if (!response.ok || !body) return;

      setGoogleChatStatus({
        webhookConfigured: Boolean(body.googleChat?.webhookConfigured ?? body.googleChatConfigured),
        apiConfigured: Boolean(body.googleChat?.apiConfigured),
        deliveryEnabled: Boolean(body.googleChat?.deliveryEnabled),
        ready: Boolean(body.googleChat?.ready),
        mode: body.googleChat?.mode || "not-configured",
        pending: body.pending || 0,
      });
    } catch {
      // Settings can still show local queue counts when the status endpoint is unavailable.
    }
  }, [source]);

  useEffect(() => {
    if (workspace !== "settings") return;
    const timeout = window.setTimeout(() => {
      void refreshGoogleChatStatus();
    }, 0);
    return () => window.clearTimeout(timeout);
  }, [refreshGoogleChatStatus, workspace]);

  const dispatchNotifications = () => {
    setSaveError("");
    setNotificationDispatchMessage("");

    if (source !== "supabase") {
      setNotificationDispatchMessage("Notification Dispatch braucht Supabase als Datenquelle.");
      return;
    }

    startTransition(async () => {
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;

      try {
        const response = await fetch("/api/notifications/deliver", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ limit: 20 }),
        });

        const body = (await response.json().catch(() => null)) as { error?: string; sent?: number; failed?: number; skipped?: number } | null;
        if (!response.ok) throw new Error(body?.error || "Google-Chat-Dispatch konnte nicht ausgeführt werden.");

        setNotificationDispatchMessage(`${body?.sent || 0} gesendet, ${body?.failed || 0} fehlgeschlagen, ${body?.skipped || 0} übersprungen.`);
        await refreshGoogleChatStatus();
      } catch (error) {
        setNotificationDispatchMessage(error instanceof Error ? error.message : "Google-Chat-Dispatch konnte nicht ausgeführt werden.");
      }
      });
    };

  const createFeedback = (draft: FeedbackDraft) => {
    if (!currentProfile) {
      setFeedbackMessage("GitHub-User ist keinem Teamprofil zugeordnet.");
      return;
    }

    setFeedbackMessage("");
    setSaveError("");

    const localFeedback: FeedbackItem = {
      id: Date.now(),
      type: draft.type,
      status: "open",
      severity: draft.severity,
      profileId: currentProfile.id,
      title: draft.title.trim(),
      description: draft.description.trim(),
      pageUrl: draft.pageUrl.trim(),
      createdAt: new Date().toISOString(),
    };

    setData((current) => ({
      ...current,
      feedbackItems: [localFeedback, ...current.feedbackItems],
    }));
    setSelectedFeedbackId(localFeedback.id);

    if (source !== "supabase") {
      setFeedbackMessage("Feedback wurde lokal erfasst. Mit Supabase wird es als Notification an CEO/Deputy gesendet.");
      setFeedbackDialogOpen(false);
      return;
    }

    startTransition(async () => {
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;

      try {
        const response = await fetch("/api/feedback", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(draft),
        });

        const body = (await response.json().catch(() => null)) as { error?: string; feedback?: FeedbackItem } | null;
        if (!response.ok || !body?.feedback) throw new Error(body?.error || "Feedback konnte nicht gespeichert werden.");

        setData((current) => ({
          ...current,
          feedbackItems: [body.feedback!, ...current.feedbackItems.filter((item) => item.id !== localFeedback.id)],
        }));
        setSelectedFeedbackId(body.feedback.id);
        setFeedbackMessage("Feedback wurde gesendet und als Notification zugestellt.");
        setFeedbackDialogOpen(false);
      } catch (error) {
        setData((current) => ({
          ...current,
          feedbackItems: current.feedbackItems.filter((item) => item.id !== localFeedback.id),
        }));
        setSelectedFeedbackId(null);
        setFeedbackMessage(error instanceof Error ? error.message : "Feedback konnte nicht gespeichert werden.");
      }
    });
  };

  const openNotification = (event: NotificationEvent) => {
    if (event.entityType === "task") {
      const task = data.tasks.find((item) => item.id === event.entityId);
      if (!task) {
        setSaveError("Die verknüpfte Aufgabe wurde nicht gefunden. Der Hinweis kann geschlossen werden.");
        setShowNotifications(false);
        return;
      }
      openTaskPanel(task.id);
    } else if (event.entityType === "feedback") {
      setSelectedFeedbackId(Number(event.entityId) || null);
      setWorkspace("settings");
    } else if (event.entityType === "decision") {
      setWorkspace("decisions");
    } else if (event.entityType === "meeting") {
      setWorkspace("meetings");
    }
    setShowNotifications(false);
  };

  const dismissNotification = (eventId: number) => {
    setData((current) => ({
      ...current,
      notificationEvents: current.notificationEvents.map((event) => (event.id === eventId ? { ...event, status: "dismissed" } : event)),
    }));

    if (source !== "supabase") return;

    startTransition(async () => {
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;

      try {
        const response = await fetch(`/api/notifications/${eventId}`, {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ status: "dismissed" }),
        });
        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        if (!response.ok) throw new Error(body?.error || "Notification konnte nicht geschlossen werden.");
      } catch (error) {
        setData((current) => ({
          ...current,
          notificationEvents: current.notificationEvents.map((event) => (event.id === eventId ? { ...event, status: "pending" } : event)),
        }));
        setSaveError(error instanceof Error ? error.message : "Notification konnte nicht geschlossen werden.");
      }
    });
  };

  const statusGuardTask = statusGuardTaskId ? data.tasks.find((task) => task.id === statusGuardTaskId) : null;

  const lockSprint = (sprintId: string) => {
    setSaveError("");
    setSprintLockMessage("");

    const previousData = data;
    setData((current) => ({
      ...current,
      sprints: current.sprints.map((sprint) => (sprint.id === sprintId ? { ...sprint, status: "closed", scoreLocked: true } : sprint)),
      tasks: current.tasks.map((task) => (task.sprintId === sprintId && !task.scoreFinal ? { ...task, scorePoints: 0, scoreFinal: true } : task)),
    }));

    if (source !== "supabase") return;

    startTransition(async () => {
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;

      try {
        const response = await fetch(`/api/sprints/${sprintId}/lock`, {
          method: "POST",
          headers: {
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
        });

        const body = (await response.json().catch(() => null)) as { error?: string; carryover?: { created?: number; evaluated?: number; nextSprintId?: string } } | null;
        if (!response.ok) throw new Error(body?.error || "Sprint konnte nicht gelockt werden.");
        if (body?.carryover) {
          setSprintLockMessage(`${body.carryover.evaluated || 0} offene Deliverables bewertet, ${body.carryover.created || 0} Carry-over-Aufgaben erstellt.`);
        }
        const refreshResponse = await fetch("/api/planning-data", {
          headers: {
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
        });
        const refreshPayload = await refreshResponse.json().catch(() => null) as { data?: PlanningData; error?: string } | null;
        if (refreshResponse.ok && refreshPayload?.data) {
          const nextData = normalizePlanningData(refreshPayload.data);
          setProtectedPlanningDataCache(nextData);
          setData(nextData);
          setProtectedDataLoaded(true);
        }
        await createSprintPlanAsync(sprintPlanningOptions, true);
      } catch (error) {
        setData(previousData);
        setSaveError(error instanceof Error ? error.message : "Sprint konnte nicht gelockt werden.");
      }
    });
  };

  const metrics = {
    total: visibleTasks.length,
    open: visibleTasks.filter((task) => normalizeStatus(task.status) !== "Erledigt").length,
    blocked: visibleTasks.filter((task) => task.dependsOn || hasOpenWaitingRelation(task.id, data.tasks, data.taskRelations) || normalizeStatus(task.status) === "Blockiert").length,
    done: visibleTasks.filter((task) => normalizeStatus(task.status) === "Erledigt").length,
  };

  const releaseSidebarFocus = () => {
    const activeElement = document.activeElement;
    if (activeElement instanceof HTMLElement && sidebarRef.current?.contains(activeElement)) {
      activeElement.blur();
    }
  };

  if (authRequired && (!authChecked || !authUser)) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f4f7fb] px-4 text-slate-900">
        <section className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-7 shadow-xl">
          <div className="grid gap-5">
            <AppBrand />
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Geschützter Teamzugriff</div>
              <h1 className="mt-1 text-xl font-semibold text-slate-950">findmydoc Founder Execution</h1>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Bitte melde dich mit GitHub an. Ohne gültige Supabase-Session werden keine Planungsdaten geladen.
              </p>
            </div>
          </div>
          {authNotice && <p className="mt-5 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{authNotice}</p>}
          {authError && <p className="mt-5 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{authError}</p>}
          <div className="mt-6">
            {authChecked ? (
              <AuthControl
                user={authUser}
                error={authError}
                busy={authBusy}
                githubProviderTokenAvailable={githubProviderTokenAvailable}
                onSignIn={signIn}
                onSignOut={signOut}
                variant="gate"
              />
            ) : (
              <div className="h-9 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-600">Session wird geprüft...</div>
            )}
          </div>
        </section>
      </main>
    );
  }

  if (authRequired && authUser && !protectedDataLoaded && !data.tasks.length) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f4f7fb] px-4 text-slate-900">
        <section className="w-full max-w-lg rounded-lg border border-slate-200 bg-white p-7 shadow-xl">
          <div className="grid gap-5">
            <AppBrand />
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Session aktiv</div>
              <h1 className="mt-1 text-xl font-semibold text-slate-950">{authError ? "Planungsdaten konnten nicht geladen werden" : "Planungsdaten werden geladen"}</h1>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                {authError ? "Die Session ist aktiv, aber die geschützte Daten-API hat nicht erfolgreich geantwortet." : "Die Session ist gültig. Die Daten werden jetzt über die geschützte API geladen."}
              </p>
            </div>
          </div>
          {authError && <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{authError}</p>}
          <div className="mt-5">
            <AuthControl
              user={authUser}
              error={authError}
              busy={authBusy}
              githubProviderTokenAvailable={githubProviderTokenAvailable}
              onSignIn={signIn}
              onSignOut={signOut}
              variant="gate"
            />
          </div>
        </section>
      </main>
    );
  }

  if (fullTaskView && selectedTask) {
    return (
      <TaskDetailPage
        task={selectedTask}
        pack={selectedPackage}
        packages={data.packages}
        sprint={data.sprints.find((sprint) => sprint.id === selectedTask.sprintId)}
        subIssues={selectedTaskSubIssues}
        comments={selectedTaskComments}
        externalComments={selectedTaskExternalComments}
        activities={selectedTaskActivity}
        blockers={selectedTaskBlockers}
        taskRelations={data.taskRelations}
        allTasks={data.tasks}
        profiles={data.profiles}
        sprints={data.sprints}
        milestones={data.milestones}
        decisions={data.decisions}
        decisionTaskLinks={data.decisionTaskLinks}
        source={source}
        commentImportNotice={commentImportNotice}
      />
    );
  }

  return (
    <div className="min-h-screen bg-[#f4f7fb] text-slate-900">
      <AppSidebar
        ref={sidebarRef}
        onMouseLeave={releaseSidebarFocus}
        activeWorkspace={workspace}
        onSelect={setWorkspace}
        source={source}
        localStateLoaded={localStateLoaded}
        authAvailable={authAvailable}
        authUserEmail={authUser?.email || ""}
      />

      <main className="lg:pl-16">
        <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
          {saveError && (
            <div className="border-b border-red-200 bg-red-50 px-4 py-2 text-sm font-medium text-red-700 lg:px-6">
              {saveError}
            </div>
          )}
          {authNotice && (
            <div className="border-b border-emerald-200 bg-emerald-50 px-4 py-2 text-sm font-medium text-emerald-800 lg:px-6">
              {authNotice}
            </div>
          )}
          {statusGuardNotice && (
            <div className="flex items-start justify-between gap-3 border-b border-amber-200 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-800 lg:px-6">
              <span>{statusGuardNotice}</span>
              <button type="button" onClick={() => { setStatusGuardNotice(""); setStatusGuardTaskId(null); }} className="grid h-6 w-6 shrink-0 place-items-center rounded-md text-amber-700 hover:bg-amber-100" aria-label="Hinweis schließen">
                <X size={14} />
              </button>
            </div>
          )}
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 lg:px-6">
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{workspaceLabels[workspace]}</div>
              <h1 className="truncate text-xl font-semibold text-slate-950">{workspace === "planning" ? data.project.name : workspaceLabels[workspace]}</h1>
              <div className="mt-1 text-sm text-slate-500">
                {workspace === "planning"
                  ? data.project.range
                  : workspace === "mine"
                    ? `Fokus auf die Aufgaben von ${mineOwnerName} für die operative Steuerung.`
                    : workspaceSubtitles[workspace]}
              </div>
            </div>
            <div className="flex items-center gap-2">
              {devRoleSwitchAvailable && (
                <DevRoleSwitch
                  profiles={data.profiles}
                  actualProfile={actualProfile}
                  value={devProfileId}
                  onChange={setDevProfileId}
                />
              )}
              <NotificationInbox
                notifications={unreadNotifications}
                profiles={data.profiles}
                open={showNotifications}
                onToggle={() => setShowNotifications((value) => !value)}
                onOpen={openNotification}
                onDismiss={dismissNotification}
              />
              {authAvailable && (
                <AuthControl
                  user={authUser}
                  error={authError}
                  busy={authBusy}
                  githubProviderTokenAvailable={githubProviderTokenAvailable}
                  onSignIn={signIn}
                  onSignOut={signOut}
                />
              )}
              <button
                type="button"
                onClick={() => setFeedbackDialogOpen(true)}
                className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700"
              >
                <MessageSquare size={16} />
                Feedback
              </button>
              {headerPrimaryAction && (
                <button
                  type="button"
                  onClick={headerPrimaryAction.onClick}
                  className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700"
                >
                  <Plus size={16} />
                  {headerPrimaryAction.label}
                </button>
              )}
              {filtersAvailable && (
                <button
                  type="button"
                  onClick={() => setShowFilters((value) => !value)}
                  className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700"
                >
                  <Filter size={16} />
                  Filter
                </button>
              )}
            </div>
          </div>

          {filtersAvailable && <div className="flex items-center gap-2 overflow-x-auto px-4 pb-3 lg:px-6">
            {viewTabs.map((tab) => {
              const Icon = tab.icon;
              const active = view === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => setView(tab.id)}
                  className={`inline-flex h-9 shrink-0 items-center gap-2 border-b-2 px-2 text-sm font-semibold ${
                    active ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500 hover:text-slate-800"
                  }`}
                >
                  <Icon size={16} />
                  {tab.label}
                </button>
              );
            })}
          </div>}
        </header>

        {statusGuardNotice && statusGuardTask && (
          <div className="fixed inset-x-4 top-24 z-50 mx-auto max-w-md rounded-lg border border-amber-200 bg-white p-4 text-sm shadow-xl">
            <div className="flex items-start gap-3">
              <span className="grid h-9 w-9 shrink-0 place-items-center rounded-md bg-amber-50 text-amber-600">
                <AlertTriangle size={18} />
              </span>
              <div className="min-w-0 flex-1">
                <h2 className="font-semibold text-slate-950">Status geschützt</h2>
                <p className="mt-1 leading-5 text-slate-600">{statusGuardNotice}</p>
                <p className="mt-2 truncate text-xs font-semibold text-slate-500">{statusGuardTask.title}</p>
                <div className="mt-4 flex flex-wrap gap-2">
                  <button type="button" onClick={() => updateTask(statusGuardTask, { status: "Review" })} className="h-9 rounded-md bg-blue-600 px-3 text-sm font-semibold text-white hover:bg-blue-700">
                    In Review verschieben
                  </button>
                  <button type="button" onClick={() => updateTask(statusGuardTask, { status: "Blockiert" })} className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50">
                    Als blockiert markieren
                  </button>
                  <button type="button" onClick={() => { setStatusGuardNotice(""); setStatusGuardTaskId(null); }} className="h-9 rounded-md px-3 text-sm font-semibold text-slate-500 hover:bg-slate-50">
                    Abbrechen
                  </button>
                </div>
              </div>
            </div>
          </div>
        )}

        {filtersAvailable && <section className="grid gap-3 px-4 py-4 sm:grid-cols-2 xl:grid-cols-4 lg:px-6">
          {[
            ["Alle Aufgaben", metrics.total],
            ["Offen", metrics.open],
            ["Blockiert/abhängig", metrics.blocked],
            ["Erledigt", metrics.done],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
              <div className="text-xs font-medium text-slate-500">{label}</div>
              <div className="mt-1 text-2xl font-semibold text-slate-950">{value}</div>
            </div>
          ))}
        </section>}

        {showFilters && filtersAvailable && (
          <section className="mx-4 mb-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm lg:mx-6">
            <div className="grid gap-3 xl:grid-cols-[minmax(260px,1fr)_repeat(4,180px)]">
              <label className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                <input
                  value={filters.query}
                  onChange={(event) => setFilters({ ...filters, query: event.target.value })}
                  className="h-10 w-full rounded-md border border-slate-200 pl-9 pr-3 text-sm outline-none focus:border-blue-400"
                  placeholder="Nach Aufgabe, DoD, Workstream oder GitHub-Issue suchen"
                />
              </label>
              <CustomSelect value={filters.owner} onChange={(value) => setFilters({ ...filters, owner: value })} className="h-10 text-sm" options={[{ value: "Alle", label: "Alle" }, ...data.profiles.map((profile) => ({ value: profile.name, label: profile.name }))]} />
              <CustomSelect value={filters.status} onChange={(value) => setFilters({ ...filters, status: value })} className="h-10 text-sm" options={[{ value: "Alle", label: "Alle" }, ...taskStatuses.map((status) => ({ value: status, label: status }))]} />
              <CustomSelect value={filters.priority} onChange={(value) => setFilters({ ...filters, priority: value })} className="h-10 text-sm" options={[{ value: "Alle", label: "Alle" }, ...["P0", "P1", "P2", "P3", "P4"].map((priority) => ({ value: priority, label: priority }))]} />
              <CustomSelect value={filters.packageId} onChange={(value) => setFilters({ ...filters, packageId: value })} className="h-10 text-sm" options={[{ value: "Alle", label: "Alle Initiativen" }, ...data.packages.map((pack) => ({ value: pack.id, label: initiativeOptionLabel(pack) }))]} />
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              {quickFilters.map((filter) => (
                <button
                  key={filter.id}
                  type="button"
                  onClick={() => setFilters({ ...filters, quick: filters.quick === filter.id ? "" : filter.id })}
                  className={`h-8 rounded-md border px-3 text-xs font-semibold ${
                    filters.quick === filter.id ? "border-blue-300 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-600"
                  }`}
                >
                  {filter.label}
                </button>
              ))}
            </div>
          </section>
        )}

        <section className="px-4 pb-8 pt-4 lg:px-6">
          {workspace === "projects" && (
            <ProjectsOverview
              data={data}
              tasks={data.tasks}
              currentProfile={currentProfile}
              canManageInitiatives={canManageTaskMeta}
              onEditInitiative={(initiative) => setInitiativeDialogDefaults({
                id: initiative.id,
                title: initiative.title,
                milestoneId: initiative.milestoneId || "",
                ownerId: initiative.ownerId || "",
                accountableProfileId: initiative.accountableProfileId || initiative.ownerId || "",
                responsibleProfileIds: initiative.responsibleProfileIds?.length ? initiative.responsibleProfileIds : initiative.ownerId ? [initiative.ownerId] : [],
                consultedProfileIds: initiative.consultedProfileIds || [],
                informedProfileIds: initiative.informedProfileIds || [],
                priority: initiative.priority,
                status: initiative.status || "planned",
                targetDate: initiative.targetDate || "",
                goal: initiative.goal,
                successCriteria: initiative.successCriteria || "",
                scopeConstraints: initiative.scopeConstraints || "",
              })}
            />
          )}
          {workspace === "execution" && (
            <ExecutionLayerOverview
              data={data}
              currentProfile={currentProfile}
              focusItems={currentProfileFocusItems}
              hygieneAlerts={hygieneAlerts}
              pending={isPending}
              onOpenTask={(task) => openTaskPanel(task.id)}
              onSetFocus={upsertFocusItem}
              onRemoveFocus={removeFocusItem}
              onLinkDecisionTask={linkDecisionTask}
              onRemoveDecisionTaskLink={removeDecisionTaskLink}
              onCreateTask={(draft) => setTaskDialogDefaults(draft)}
            />
          )}
          {workspace === "tools" && <FmdToolsOverview tools={data.fmdTools} />}
          {workspace === "team" && (
            <TeamOverview
              data={data}
              tasks={data.tasks}
              pending={isPending}
              canManageTeam={source === "seed" || currentProfile?.platformRole === "ceo"}
              currentProfileId={currentProfile?.id || ""}
              onUpdateProfile={updateProfile}
              onUpdateNotificationPreference={updateNotificationPreference}
            />
          )}
          {workspace === "sprint" && (
            <SprintScoreTableOverview
              data={data}
              pending={isPending}
              onOpen={(task) => openTaskPanel(task.id)}
              onReview={reviewTask}
              onRequestReview={(task) => updateTask(task, { status: "Review", reviewStatus: "requested", scoreFinal: false })}
              onChangeStatus={(task, status) => updateTask(task, { status })}
              onLockSprint={lockSprint}
              onUpdateSprint={updateSprint}
              onUpdateCommitment={updateSprintCommitment}
              onUpdateMeetingAttendance={updateMeetingAttendance}
              onAssignSprint={(task, sprintId) => updateTask(task, { sprintId })}
              currentProfile={currentProfile}
              canManageSprint={currentProfile?.platformRole === "ceo" || currentProfile?.platformRole === "deputy"}
              sprintLockMessage={sprintLockMessage}
            />
          )}
          {workspace === "decisions" && (
            <DecisionLogOverview
              data={data}
              currentProfileId={currentProfile?.id || ""}
              pending={isPending}
              onCreate={createDecision}
              onConfirm={confirmDecision}
              onEdit={editDecision}
              onObject={objectDecision}
              onRemoveDecisionTaskLink={removeDecisionTaskLink}
              onCreateFollowUp={(decision) => setTaskDialogDefaults({
                taskType: "deliverable",
                title: `${decision.title} umsetzen`,
                description: decision.context,
                problemStatement: decision.context,
                intendedOutcome: decision.decision,
                acceptanceCriteria: decision.decision,
                definitionOfDone: decision.decision,
                decisionId: decision.id,
                decisionLinkNote: "Folgeaufgabe aus Decision Log",
              })}
            />
          )}
          {workspace === "meetings" && (
            <MeetingFinderOverview
              data={data}
              pending={isPending}
              currentProfile={currentProfile}
              canManageAvailability={source === "seed" || currentProfile?.platformRole === "ceo" || currentProfile?.platformRole === "deputy"}
              canCreateMeeting={source === "seed" || currentProfile?.platformRole === "ceo" || currentProfile?.platformRole === "deputy" || currentProfile?.platformRole === "founder"}
              calendarSyncMessage={calendarSyncMessage}
              meetingCreateMessage={meetingCreateMessage}
              onCreateAvailability={createAvailability}
              onUpdateAvailability={updateAvailability}
              onDeleteAvailability={deleteAvailability}
              onSyncGoogleCalendar={syncGoogleCalendar}
              onCreateMeeting={createMeetingFromSlot}
              onUpdateMeeting={updateMeeting}
            />
          )}
          {workspace === "settings" && (
            <SettingsOverview
              data={data}
              source={source}
              authAvailable={authAvailable}
              authUserEmail={authUser?.email || ""}
              githubProviderTokenAvailable={githubProviderTokenAvailable}
              pending={isPending}
              feedbackMessage={feedbackMessage}
              selectedFeedbackId={selectedFeedbackId}
              notificationDispatchMessage={notificationDispatchMessage}
              googleChatStatus={googleChatStatus}
              sprintPlanningOptions={sprintPlanningOptions}
              plannedSprintCount={futureSprintDrafts(data.sprints, sprintPlanningOptions, new Set(data.tasks.filter((task) => task.sprintId).map((task) => task.sprintId))).length}
              onUpdateSprintPlanning={setSprintPlanningOptions}
              onCreateSprintPlan={createSprintPlan}
              onDispatchNotifications={dispatchNotifications}
              onReconnectGitHub={signIn}
              onSyncLinkedGitHubTasks={syncLinkedGitHubTasks}
              onCreateGitHubIssue={(task) => syncTaskToGitHub(task, { createIfMissing: true })}
              onSelectFeedback={setSelectedFeedbackId}
            />
          )}

          {filtersAvailable && (
          <>
          {view === "board" && (
            <div className="flex min-w-0 gap-4 overflow-x-auto pb-3">
              {taskStatuses.map((status) => {
                const tasks = visibleTasks.filter((task) => normalizeStatus(task.status) === status);
                return (
                  <section
                    key={status}
                    onDragOver={(event) => {
                      event.preventDefault();
                      event.dataTransfer.dropEffect = "move";
                      setDragOverStatus(status);
                    }}
                    onDragLeave={(event) => {
                      if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setDragOverStatus(null);
                    }}
                    onDrop={(event) => dropTaskOnStatus(status, event)}
                    className={`min-w-[360px] max-w-[360px] basis-[360px] shrink-0 grow-0 overflow-hidden rounded-lg border bg-blue-50/60 transition ${dragOverStatus === status ? "border-blue-400 ring-2 ring-blue-200" : "border-blue-100"}`}
                  >
                    <div className="flex min-w-0 items-center justify-between border-b border-blue-100 px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Circle size={15} className="text-blue-600" />
                        <h2 className="text-sm font-semibold text-slate-800">{status}</h2>
                        <span className="text-xs text-slate-500">({tasks.length})</span>
                      </div>
                      <button type="button" onClick={() => setTaskDialogDefaults({ status, taskType: status === "Vorschlag" ? "proposal" : "deliverable" })} className="grid h-7 w-7 place-items-center rounded-md text-slate-500 hover:bg-white" aria-label="Aufgabe hinzufügen">
                        <Plus size={15} />
                      </button>
                    </div>
                    <div className="grid min-w-0 gap-3 p-3">
                      {tasks.length ? tasks.map((task) => (
                        <TaskCard
                          key={task.id}
                          task={task}
                          pack={packageById(data.packages, task.packageId)}
                          ownerColor={profileColor(data.profiles.find((profile) => profile.name === task.owner))}
                          relations={data.taskRelations}
                          allTasks={data.tasks}
                          statusOptions={statusOptionsForRole(task.status, canManageTaskMeta)}
                          onOpen={(nextTask) => openTaskPanel(nextTask.id)}
                          onStatusChange={(nextTask, nextStatus) => updateTask(nextTask, { status: nextStatus })}
                          onDragStart={startTaskDrag}
                          onDragEnd={endTaskDrag}
                          isDragging={draggedTaskId === task.id}
                        />
                      )) : <EmptyColumn />}
                    </div>
                  </section>
                );
              })}
            </div>
          )}

          {view === "structure" && (
            <div className="grid gap-4">
              <div className="flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setAllPackageCollapse(true)}
                  className="h-8 rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Alle einklappen
                </button>
                <button
                  type="button"
                  onClick={() => setAllPackageCollapse(false)}
                  className="h-8 rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                >
                  Alle ausklappen
                </button>
              </div>
              {data.packages.map((pack) => {
                const tasks = visibleTasks.filter((task) => task.packageId === pack.id);
                const expanded = Boolean(expandedPackages[pack.id]);
                return (
                  <section key={pack.id} className="rounded-lg border border-slate-200 bg-white shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
                      <button
                        type="button"
                        onClick={() => togglePackageCollapse(pack.id)}
                        className="flex min-w-0 flex-1 items-start gap-3 rounded-md text-left outline-none focus:ring-2 focus:ring-blue-100"
                        aria-expanded={expanded}
                      >
                        <span className="mt-1 grid h-7 w-7 shrink-0 place-items-center rounded-md border border-slate-200 bg-white text-slate-500">
                          <ChevronRight size={16} className={`transition-transform ${expanded ? "rotate-90" : ""}`} />
                        </span>
                        <span className="min-w-0">
                          <span className="block text-xs font-semibold text-blue-700">{initiativeMetaLabel(pack)}</span>
                          <span className="mt-0.5 block text-base font-semibold text-slate-950">{pack.title}</span>
                          <span className="mt-1 block text-sm text-slate-500">{pack.goal}</span>
                        </span>
                      </button>
                      <span className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600">{tasks.length} Aufgaben</span>
                    </div>
                    {expanded && (
                      <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
                        {tasks.map((task) => (
                          <TaskCard
                            key={task.id}
                            task={task}
                            pack={pack}
                            ownerColor={profileColor(data.profiles.find((profile) => profile.name === task.owner))}
                            relations={data.taskRelations}
                            allTasks={data.tasks}
                            statusOptions={statusOptionsForRole(task.status, canManageTaskMeta)}
                            onOpen={(nextTask) => openTaskPanel(nextTask.id)}
                            onStatusChange={(nextTask, nextStatus) => updateTask(nextTask, { status: nextStatus })}
                          />
                        ))}
                      </div>
                    )}
                  </section>
                );
              })}
            </div>
          )}

          {view === "table" && (
            <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
              <table className="min-w-[1320px] w-full border-collapse text-sm">
                <thead className="bg-slate-50 text-left text-xs font-semibold uppercase tracking-wide text-slate-500">
                  <tr>
                    {["Status", "GitHub", "Assignee", "Priorität", "Workstream", "Aufgabe", "Aufwand", "Zeitraum", "Zieltermin", "Abhängigkeit", "Definition of Done"].map((head) => (
                      <th key={head} className="border-b border-slate-200 px-3 py-3">{head}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleTasks.map((task) => {
                    const relationGroups = taskRelationsFor(task.id, data.taskRelations);
                    const hasOpenWait = hasOpenWaitingRelation(task.id, data.tasks, data.taskRelations);
                    return (
                    <tr key={task.id} className="border-b border-slate-100 align-top hover:bg-slate-50">
                      <td className="px-3 py-3">
                        <CustomSelect value={normalizeStatus(task.status)} onChange={(value) => updateTask(task, { status: value })} className="h-8 w-32 text-xs" options={statusOptionsForRole(task.status, canManageTaskMeta).map((status) => ({ value: status, label: status }))} />
                      </td>
                      <td className="px-3 py-3">
                        {hasGitHubIssue(task) ? (
                          <span className="inline-flex items-center gap-1 rounded-full border border-blue-100 bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">
                            <Link2 size={13} />
                            verknüpft
                          </span>
                        ) : (
                          <GitHubMissingBadge />
                        )}
                      </td>
                      <td className="px-3 py-3">
                        <CustomSelect value={task.owner} onChange={(value) => updateTask(task, { owner: value })} className="h-8 w-36 text-xs" options={taskOwnerOptions(task.taskType, data.profiles)} />
                      </td>
                      <td className="px-3 py-3"><span className={`rounded-full border px-2 py-1 text-xs font-semibold ${priorityTone(task.priority)}`}>{task.priority}</span></td>
                      <td className="px-3 py-3 text-slate-600">{task.workstream}</td>
                      <td className="max-w-sm px-3 py-3">
                        <button type="button" onClick={() => openTaskPanel(task.id)} className="inline-flex items-start gap-1.5 text-left font-semibold text-slate-900 hover:text-blue-700">
                          {!hasGitHubIssue(task) && <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-500" aria-hidden="true" />}
                          <span>{task.title}</span>
                        </button>
                        <p className="mt-1 line-clamp-2 text-xs text-slate-500">{task.description}</p>
                      </td>
                      <td className="px-3 py-3">{task.hours}h</td>
                      <td className="px-3 py-3">{dateRange(task)}</td>
                      <td className="px-3 py-3">{task.deadline}</td>
                      <td className="max-w-52 px-3 py-3">
                        <div className="flex flex-wrap gap-1.5">
                          <RelationBadge label="Wartet auf" count={relationGroups.waitsOn.length} tone={hasOpenWait ? "amber" : "slate"} />
                          <RelationBadge label="Blockiert" count={relationGroups.blocks.length} tone="blue" />
                          {!relationGroups.waitsOn.length && !relationGroups.blocks.length && <span className="text-xs text-slate-400">-</span>}
                        </div>
                      </td>
                      <td className="max-w-sm px-3 py-3 text-xs leading-5 text-slate-600">{task.definitionOfDone}</td>
                    </tr>
                  );})}
                </tbody>
              </table>
            </div>
          )}

          {view === "gantt" && (
            <GanttView tasks={visibleTasks} packages={data.packages} sprints={data.sprints} relations={data.taskRelations} onOpen={(task) => openTaskPanel(task.id)} />
          )}
          </>
          )}
        </section>
      </main>

      {selectedTask && (
        <TaskDetailPanel
          key={selectedTask.id}
          task={selectedTask}
          pack={selectedPackage}
          comments={selectedTaskComments}
          externalComments={selectedTaskExternalComments}
          activities={selectedTaskActivity}
          commentImportNotice={commentImportNotice}
          blockers={selectedTaskBlockers}
          subIssues={selectedTaskSubIssues}
          teamProfiles={data.profiles}
          packages={data.packages}
          sprints={data.sprints}
          milestones={data.milestones}
          decisions={data.decisions}
          decisionTaskLinks={data.decisionTaskLinks}
          focusItems={data.taskFocusItems}
          canManageTaskMeta={canManageTaskMeta}
          allTasks={data.tasks}
          relations={data.taskRelations}
          pending={isPending}
          githubProviderTokenAvailable={githubProviderTokenAvailable}
          commentImportPending={commentImportPendingTaskIds.has(selectedTask.id)}
          onClose={closeTaskPanel}
          onUpdate={(patch) => updateTask(selectedTask, patch)}
          onAddComment={(comment) => addTaskComment(selectedTask, comment)}
          onUploadAttachment={(file) => uploadTaskAttachment(selectedTask, file)}
          onImportGitHubComments={() => importGitHubComments(selectedTask)}
          onReportBlocker={(payload) => reportTaskBlocker(selectedTask, payload)}
          onCreateSubIssue={() => setTaskDialogDefaults({ taskType: "sub_issue", parentTaskId: selectedTask.id, milestoneId: selectedTask.milestoneId, packageId: selectedTask.packageId, owner: selectedTask.owner, status: "Offen" })}
          onReconnectGitHub={signIn}
          onSyncGitHub={(options) => syncTaskToGitHub(selectedTask, options)}
          onDelete={() => deleteTask(selectedTask)}
          onAddRelation={(payload) => addTaskRelation(selectedTask, payload)}
          onRemoveRelation={(relation) => removeTaskRelation(selectedTask, relation)}
        />
      )}
      {taskDialogDefaults && (
        <NewTaskDialog
          defaults={taskDialogDefaults}
          data={data}
          pending={isPending}
          onClose={() => setTaskDialogDefaults(null)}
          onCreate={createTask}
        />
      )}
      {initiativeDialogDefaults && (
        <InitiativeDialog
          defaults={initiativeDialogDefaults}
          data={data}
          pending={isPending}
          onClose={() => setInitiativeDialogDefaults(null)}
          onSave={saveInitiative}
        />
      )}
      {feedbackDialogOpen && (
        <FeedbackDialog
          pending={isPending}
          onClose={() => setFeedbackDialogOpen(false)}
          onSubmit={createFeedback}
        />
      )}
    </div>
  );
}
