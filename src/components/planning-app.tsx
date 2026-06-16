"use client";

import {
  AlertTriangle,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Circle,
  CircleHelp,
  Columns3,
  ExternalLink,
  Filter,
  GanttChart,
  Lock,
  Maximize2,
  Link2,
  ListTree,
  Menu,
  MessageSquare,
  Plus,
  Search,
  Table2,
  Users,
  X,
} from "lucide-react";
import Link from "next/link";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useRef, useState, useTransition, type DragEvent } from "react";
import type { User } from "@supabase/supabase-js";
import { AppBrand } from "@/components/app-brand";
import { AppSidebar, type AppWorkspace } from "@/components/app-sidebar";
import { AuthControl as CurrentAuthControl } from "@/components/auth-control";
import { CeoTaskIntake } from "@/components/ceo-task-intake";
import { CommentBody } from "@/components/task-comment-body";
import { CustomDatePicker } from "@/components/custom-date-picker";
import { CustomSelect } from "@/components/custom-select";
import { DecisionLogOverview as CurrentDecisionLogOverview } from "@/components/decision-log-overview";
import { DevRoleSwitch } from "@/components/dev-role-switch";
import { ExecutionLayerOverview } from "@/components/execution-layer-overview";
import { FeedbackDialog as CurrentFeedbackDialog, type FeedbackDraft } from "@/components/feedback-dialog";
import { FmdToolsOverview as CurrentFmdToolsOverview } from "@/components/fmd-tools-overview";
import { GanttView as CurrentGanttView } from "@/components/gantt-view";
import { persistLocalPlanningTasks, useLocalPlanningState } from "@/hooks/use-local-planning-state";
import { setProtectedPlanningDataCache, usePlanningAuth } from "@/hooks/use-planning-auth";
import { usePlanningRequestContext } from "@/hooks/use-planning-request-context";
import { usePlanningWorkspace } from "@/hooks/use-planning-workspace";
import { InitiativeDialog, type InitiativeDraft } from "@/components/initiative-dialog";
import { NewTaskDialog as CurrentNewTaskDialog, type NewTaskDraft } from "@/components/new-task-dialog";
import { MeetingFinderOverview as CurrentMeetingFinderOverview } from "@/components/meeting-finder-overview";
import { NotificationInbox } from "@/components/notification-inbox";
import { ProjectsOverview as CurrentProjectsOverview } from "@/components/projects-overview";
import { SettingsOverview } from "@/components/settings-overview";
import { SprintScoreTableOverview as CurrentSprintScoreTableOverview } from "@/components/sprint-score-overview";
import type { SprintPlanningOptions } from "@/components/settings-sprint-planning";
import { EmptyColumn, GitHubMissingBadge, RelationBadge, TaskCard } from "@/components/task-card";
import { TaskChecklist } from "@/components/task-checklist";
import { TaskCommentThread } from "@/components/task-comment-thread";
import { TaskDetailPanel as CurrentTaskDetailPanel } from "@/components/task-detail-panel";
import { TeamOverview as CurrentTeamOverview } from "@/components/team-overview";
import { dateRange, focusStatusLabel, formatDate, initiativeMetaLabel, initiativeOptionLabel, relationshipHelpText, relationTypeLabel, taskOwnerOptions } from "@/lib/display";
import { decisionStatusLabel } from "@/lib/execution-layer-view-model";
import { rememberGitHubProviderToken } from "@/lib/github-provider-token";
import { googleChatDigestEventTypes, notificationChannelLabel, notificationEventLabel, shouldSendToGoogleChatDigest } from "@/lib/notification-policy";
import { founderScore, hasGitHubIssue, hasOpenWaitingRelation, reviewLabel, roleLabel, syncLabel, taskBelongsToProfile, taskRelationsFor } from "@/lib/platform";
import { reviewChecklistItems, reviewChecklistScore } from "@/lib/sprint-score-view-model";
import { normalizeStatus, priorityTone, statusTone, taskStatuses } from "@/lib/status";
import { getBrowserSupabase, hasSupabaseEnv } from "@/lib/supabase";
import { TaskDetailPage } from "@/components/task-detail-page";
import type { AvailabilityEntry, CommitmentLevel, DecisionTaskLink, FeedbackItem, FmdTool, Meeting, MeetingAttendance, Milestone, NotificationDelivery, NotificationEvent, NotificationPreference, Package, PlanningData, PlanningDataResponse, PlatformRole, Profile, ScoreObjection, Sprint, SprintCommitment, Task, TaskActivity, TaskBlocker, TaskComment, TaskExternalComment, TaskFocusItem, TaskRelation, TaskRelationType, TaskStatus, ViewMode } from "@/lib/types";

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
    founderSprintScores: data.founderSprintScores || [],
    founderStrikeStates: data.founderStrikeStates || [],
    strikeEvents: data.strikeEvents || [],
    scoreObjections: data.scoreObjections || [],
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

function mapScoreObjectionResponse(row: {
  id: number;
  sprint_id: string;
  profile_id: string;
  founder_sprint_score_id: number | null;
  status: ScoreObjection["status"];
  comment: string;
  resolution_comment?: string | null;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  second_reviewer_profile_id?: string | null;
  second_review_decision?: string | null;
  second_reviewed_at?: string | null;
  created_at: string;
}): ScoreObjection {
  return {
    id: row.id,
    sprintId: row.sprint_id,
    profileId: row.profile_id,
    founderSprintScoreId: row.founder_sprint_score_id,
    status: row.status,
    comment: row.comment,
    resolutionComment: row.resolution_comment || "",
    reviewedBy: row.reviewed_by || "",
    reviewedAt: row.reviewed_at || "",
    secondReviewerProfileId: row.second_reviewer_profile_id || "",
    secondReviewDecision: row.second_review_decision || "",
    secondReviewedAt: row.second_reviewed_at || "",
    createdAt: row.created_at,
  };
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
  "ceo-intake": "CEO Intake",
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
  "ceo-intake": "CEO-only Task Intake für Codex-generierte Aufgaben.",
};

const planningWorkspaces: Workspace[] = ["planning", "mine"];

const setupChecks = [
  "Supabase-Projekt angelegt",
  "supabase/seed.sql ausgeführt",
  ".env.local gesetzt",
  "npm run verify:supabase grün",
  "Team-User in Supabase Auth angelegt",
  "profiles.auth_user_id verknüpft",
  "npm run verify:auth grün",
  "REQUIRE_SUPABASE_AUTH=true aktiviert",
  "supabase/0008_google_chat_delivery.sql ausgeführt",
  "supabase/0009_sprint_carryover.sql ausgeführt",
  "Health-Check zeigt status ready",
];

const productionReadinessItems = [
  {
    title: "Release-Gate lokal",
    description: "`npm run build` und `npm run verify:release` müssen vor jedem Deployment grün sein.",
    status: "bereit",
  },
  {
    title: "GitHub OAuth",
    description: "OAuth-App gehört zur Organisation und nutzt den angemeldeten GitHub-User für Kommentare, Anhänge und Sync.",
    status: "bereit",
  },
  {
    title: "GitHub Actions",
    description: "Noch offen: Deploy-Workflows und GitHub Environments prüfen, damit Preview und Production über Actions laufen.",
    status: "manuell offen",
  },
  {
    title: "Supabase Auth Redirects",
    description: "Nach Domain-Cutover die Produktions-URL als Site URL und Redirect URL in Supabase eintragen.",
    status: "nach Domain",
  },
  {
    title: "Google Chat",
    description: "`GOOGLE_CHAT_DELIVERY_ENABLED=false` bleibt sicherer Standard, bis Webhook, Domain und Test-Digest geprüft sind.",
    status: "vorbereitet",
  },
  {
    title: "GitHub Maintenance",
    description: "Dependabot ist aktiv. GitHub-Sicherheitsmeldungen werden separat geprüft, lokale Audits bleiben Teil des Release-Gates.",
    status: "aktiv",
  },
];

const quickFilters = [
  { id: "mine", label: "Meine Aufgaben" },
  { id: "open", label: "Offen" },
  { id: "blocked", label: "Blockiert" },
  { id: "week", label: "Diese Woche" },
  { id: "high", label: "Hohe Priorität" },
  { id: "evidence", label: "Ohne Evidence" },
];

const platformRoleOptions: PlatformRole[] = ["ceo", "founder", "deputy", "viewer"];
const profileColorOptions = [
  { value: "#22c55e", label: "Mint" },
  { value: "#3b82f6", label: "Blau" },
  { value: "#f59e0b", label: "Gelb" },
  { value: "#8b5cf6", label: "Lila" },
  { value: "#ec4899", label: "Pink" },
  { value: "#14b8a6", label: "Türkis" },
  { value: "#ef4444", label: "Rot" },
  { value: "#64748b", label: "Schiefer" },
];

function profileColor(profile?: Pick<Profile, "color"> | null) {
  return profile?.color || "#64748b";
}

function profileForOwnerValue(profiles: Profile[], value?: string) {
  return profiles.find((profile) => profile.id === value || profile.name === value) || null;
}

function taskOwnerPatch(ownerValue: string, profiles: Profile[]): Partial<Task> {
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

function parseIsoDate(value: string) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function relationshipRows(task: Task, tasks: Task[], relations: TaskRelation[]) {
  const taskById = new Map(tasks.map((item) => [item.id, item]));
  const groups = taskRelationsFor(task.id, relations);
  return {
    waitsOn: groups.waitsOn.map((relation) => ({ relation, task: taskById.get(relation.relatedTaskId) })),
    blocks: groups.blocks.map((relation) => ({ relation, task: taskById.get(relation.taskId === task.id ? relation.relatedTaskId : relation.taskId) })),
    related: groups.related.map((relation) => ({ relation, task: taskById.get(relation.taskId === task.id ? relation.relatedTaskId : relation.taskId) })),
  };
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

function founderTaskOwnershipGuardMessage() {
  return "Founder können nur den Status ihrer eigenen Aufgaben ändern.";
}

function reviewOwnerForTask(task: Pick<Task, "packageId">, packages: Package[]) {
  const initiative = packages.find((item) => item.id === task.packageId);
  return initiative?.accountableProfileId || initiative?.ownerId || "";
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
  const initialClientData = useMemo(() => safeInitialData, [safeInitialData]);
  const [data, setData] = useState(initialClientData);
  const { localStateLoaded } = useLocalPlanningState({ source, setData });
  const { workspace, setWorkspace } = usePlanningWorkspace();
  const [view, setView] = useState<ViewMode>("board");
  const [expandedPackages, setExpandedPackages] = useState<Record<string, boolean>>({});
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(initialTaskId || null);
  const [focusedReviewTaskId, setFocusedReviewTaskId] = useState("");
  const [taskDialogDefaults, setTaskDialogDefaults] = useState<Partial<NewTaskDraft> | null>(null);
  const [initiativeDialogDefaults, setInitiativeDialogDefaults] = useState<Partial<InitiativeDraft> | null>(null);
  const [feedbackDialogOpen, setFeedbackDialogOpen] = useState(false);
  const [selectedFeedbackId, setSelectedFeedbackId] = useState<number | null>(null);
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<TaskStatus | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [isPending, startTransition] = useTransition();
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
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
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
    serverCurrentProfile,
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
  const {
    actualProfile,
    currentProfile,
    devProfileId,
    setDevProfileId,
    devRoleSwitchAvailable,
    requestHeaders,
  } = usePlanningRequestContext({
    source,
    profiles: data.profiles,
    currentGithubLogin,
    currentProfileId: serverCurrentProfile?.id || "",
  });
  const mineOwnerName = currentProfile?.name || "deinem Profil";
  const currentProfileId = currentProfile?.id || "";
  const canUseCeoIntake = currentProfile?.platformRole === "ceo";
  const canManageTaskMeta = source === "seed" || currentProfile?.platformRole === "ceo" || currentProfile?.platformRole === "deputy";
  const canChangeTaskStatus = (task: Task) => canManageTaskMeta || taskBelongsToProfile(task, currentProfile);
  const unreadNotifications = useMemo(() => {
    const pending = data.notificationEvents.filter((event) => event.status === "pending");
    if (!currentProfile) return pending;
    return pending.filter((event) => event.recipientProfileId === currentProfile.id);
  }, [currentProfile, data.notificationEvents]);
  const hygieneAlerts = useMemo(() => buildHygieneAlerts(data), [data]);
  const todayFocusDate = currentIsoDate();
  const currentProfileFocusItems = useMemo(() => {
    if (!currentProfileId) return [];
    return data.taskFocusItems
      .filter((item) => item.profileId === currentProfileId && item.focusDate === todayFocusDate)
      .sort((left, right) => left.position - right.position)
      .slice(0, 3);
  }, [currentProfileId, data.taskFocusItems, todayFocusDate]);
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

  const openReviewSheet = useCallback((task: Task) => {
    setSelectedTaskId(null);
    setFocusedReviewTaskId(task.id);
    setWorkspace("sprint");
    if (pathname?.startsWith("/tasks/")) router.push("/");
  }, [pathname, router, setWorkspace]);

  useEffect(() => {
    if (workspace === "ceo-intake" && authChecked && !canUseCeoIntake) {
      setWorkspace("planning");
    }
  }, [authChecked, canUseCeoIntake, setWorkspace, workspace]);

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
          (filters.quick === "mine" && taskBelongsToProfile(task, currentProfile)) ||
          (filters.quick === "open" && normalized === "Offen") ||
          (filters.quick === "blocked" && (normalized === "Blockiert" || Boolean(task.dependsOn))) ||
          (filters.quick === "week" && isThisWeek(task)) ||
          (filters.quick === "high" && ["P0", "P1"].includes(task.priority)) ||
          (filters.quick === "evidence" && !task.evidenceLink && !task.issueUrl);

        return matchesQuery && matchesOwner && matchesStatus && matchesPriority && matchesPackage && matchesQuick;
      }),
    );
  }, [currentProfile, data.tasks, filters]);

  const visibleTasks = useMemo(() => {
    if (workspace === "mine") return filteredTasks.filter((task) => taskBelongsToProfile(task, currentProfile));
    return filteredTasks;
  }, [currentProfile, filteredTasks, workspace]);
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
    let normalizedPatch = patch.owner !== undefined || patch.ownerId !== undefined
      ? { ...patch, ...taskOwnerPatch(patch.ownerId || patch.owner || "", data.profiles) }
      : patch;

    if (normalizedPatch.status === "Review" || normalizedPatch.reviewStatus === "requested") {
      if (task.scoreFinal) {
        setSaveError("Final bewertete Aufgaben können nicht erneut in Review gegeben werden.");
        return;
      }
      const nextTask = { ...task, ...normalizedPatch };
      normalizedPatch = {
        ...normalizedPatch,
        status: "Review",
        reviewStatus: "requested",
        scoreFinal: false,
        reviewOwnerProfileId: reviewOwnerForTask(nextTask, data.packages),
        reviewRequestedAt: new Date().toISOString(),
      };
    }

    if (normalizedPatch.status && !canChangeTaskStatus(task)) {
      setStatusGuardNotice(founderTaskOwnershipGuardMessage());
      setStatusGuardTaskId(task.id);
      return;
    }

    if (normalizedPatch.status && !canManageTaskMeta) {
      const guardedMessage = founderStatusGuardMessage(normalizedPatch.status as TaskStatus);
      if (guardedMessage) {
        setStatusGuardNotice(guardedMessage);
        setStatusGuardTaskId(task.id);
        return;
      }
    }

    setData((current) => {
      const nextData = {
        ...current,
        tasks: current.tasks.map((item) => (item.id === task.id ? { ...item, ...normalizedPatch, githubSyncStatus: normalizedPatch.githubSyncStatus || "not_synced", githubSyncError: normalizedPatch.githubSyncStatus ? item.githubSyncError : "" } : item)),
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
            status: normalizedPatch.status,
            owner: normalizedPatch.ownerId || normalizedPatch.owner,
            priority: normalizedPatch.priority,
            packageId: normalizedPatch.packageId,
            startDate: normalizedPatch.startDate,
            endDate: normalizedPatch.endDate,
            deadline: normalizedPatch.deadline,
            note: normalizedPatch.note,
            reviewStatus: normalizedPatch.reviewStatus,
            reviewOwnerProfileId: normalizedPatch.reviewOwnerProfileId,
            scorePoints: normalizedPatch.scorePoints,
            scoreFinal: normalizedPatch.scoreFinal,
            githubSyncStatus: normalizedPatch.githubSyncStatus,
            sprintId: normalizedPatch.sprintId,
            milestoneId: normalizedPatch.milestoneId,
            dependsOn: normalizedPatch.dependsOn,
            evidenceLink: normalizedPatch.evidenceLink,
            selfDodChecked: normalizedPatch.selfDodChecked,
            selfEvidenceChecked: normalizedPatch.selfEvidenceChecked,
            selfDocumentedChecked: normalizedPatch.selfDocumentedChecked,
            selfBlockersChecked: normalizedPatch.selfBlockersChecked,
          }),
        });

        const body = (await response.json().catch(() => null)) as { error?: string; activities?: TaskActivity[]; task?: Partial<Task> } | null;
        if (!response.ok) {
          throw new Error(body?.error || "Änderung konnte nicht gespeichert werden.");
        }
        if (body?.activities?.length) {
          setData((current) => ({
            ...current,
            taskActivity: [...body.activities!, ...current.taskActivity],
          }));
        }
        if (body?.task) {
          setData((current) => ({
            ...current,
            tasks: current.tasks.map((item) => (item.id === task.id ? { ...item, ...body.task } : item)),
          }));
        }
        if (normalizedPatch.status && hasGitHubIssue(task) && githubProviderTokenAvailable && canManageTaskMeta) {
          syncTaskToGitHub({ ...task, ...normalizedPatch }, { silent: true });
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

    const ownerProfile = profileForOwnerValue(data.profiles, draft.owner || currentProfile?.id || "");
    const ownerId = draft.taskType === "proposal" && !draft.owner ? "" : ownerProfile?.id || "";
    const owner = ownerId ? ownerProfile?.name || "" : "";
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
      ownerId,
      owner,
      assigneeId: ownerId,
      assignee: owner,
      createdById: currentProfile?.id || "",
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
      reviewOwnerProfileId: reviewOwnerForTask({ packageId: draft.packageId }, data.packages),
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
          body: JSON.stringify({ ...draft, owner: ownerId || draft.owner }),
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
    if (!currentProfile) {
      setSaveError("Profil konnte nicht bestimmt werden. Bitte erneut anmelden.");
      return;
    }
    const profileId = currentProfile.id;
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
    if (!canChangeTaskStatus(task)) {
      event.preventDefault();
      setStatusGuardNotice(founderTaskOwnershipGuardMessage());
      setStatusGuardTaskId(task.id);
      return;
    }
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
    if (!canChangeTaskStatus(task)) {
      setStatusGuardNotice(founderTaskOwnershipGuardMessage());
      setStatusGuardTaskId(task.id);
      return;
    }
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

  const saveProfileSettings = async (profile: Profile, patch: Partial<Profile>, notificationEvents: Record<string, boolean>) => {
    setSaveError("");
    const previousData = data;
    const changedNotificationEvents = Object.entries(notificationEvents).filter(([eventType, enabled]) => {
      const currentPreference = data.notificationPreferences.find((item) => item.profileId === profile.id && item.channel === "google_chat" && item.eventType === eventType);
      return (currentPreference?.enabled !== false) !== enabled;
    });

    setData((current) => {
      const nextPreferences = changedNotificationEvents.reduce((preferences, [eventType, enabled]) => {
        const existing = preferences.find((item) => item.profileId === profile.id && item.channel === "google_chat" && item.eventType === eventType);
        if (existing) {
          return preferences.map((item) =>
            item.profileId === profile.id && item.channel === "google_chat" && item.eventType === eventType ? { ...item, enabled } : item
          );
        }
        return [
          {
            id: Date.now() + preferences.length,
            profileId: profile.id,
            channel: "google_chat",
            eventType,
            enabled,
          } satisfies NotificationPreference,
          ...preferences,
        ];
      }, current.notificationPreferences);

      return {
        ...current,
        profiles: current.profiles.map((item) => {
          if (item.id === profile.id) return { ...item, ...patch };
          if (patch.platformRole === "ceo" && item.platformRole === "ceo") {
            return { ...item, platformRole: "founder", orgRole: item.orgRole === "CEO" ? "Founder" : item.orgRole };
          }
          return item;
        }),
        notificationPreferences: nextPreferences,
      };
    });

    if (source !== "supabase") return;

    const session = await getBrowserSupabase()?.auth.getSession();
    const token = session?.data.session?.access_token;

    try {
      const profileResponse = await fetch(`/api/profiles/${profile.id}`, {
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
      const profileBody = (await profileResponse.json().catch(() => null)) as { error?: string; profile?: Profile } | null;
      if (!profileResponse.ok) throw new Error(profileBody?.error || "Profil konnte nicht gespeichert werden.");

      const savedPreferences: NotificationPreference[] = [];
      for (const [eventType, enabled] of changedNotificationEvents) {
        const preferenceResponse = await fetch("/api/notification-preferences", {
          method: "PATCH",
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ profileId: profile.id, eventType, enabled }),
        });
        const preferenceBody = (await preferenceResponse.json().catch(() => null)) as { error?: string; preference?: NotificationPreference } | null;
        if (!preferenceResponse.ok || !preferenceBody?.preference) throw new Error(preferenceBody?.error || "Benachrichtigungseinstellung konnte nicht gespeichert werden.");
        savedPreferences.push(preferenceBody.preference);
      }

      setData((current) => ({
        ...current,
        profiles: profileBody?.profile
          ? current.profiles.map((item) => (item.id === profile.id ? { ...item, ...profileBody.profile } : item))
          : current.profiles,
        notificationPreferences: savedPreferences.length
          ? current.notificationPreferences.map((item) => {
            const saved = savedPreferences.find((preference) => preference.profileId === item.profileId && preference.channel === item.channel && preference.eventType === item.eventType);
            return saved || item;
          })
          : current.notificationPreferences,
      }));
    } catch (error) {
      setData(previousData);
      setSaveError(error instanceof Error ? error.message : "Profil konnte nicht gespeichert werden.");
      throw error;
    }
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
        item.id === task.id ? { ...item, status: nextStatus, reviewStatus, scorePoints, scoreFinal, reviewOwnerProfileId: "", reviewRequestedAt: "" } : item,
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

  const refreshPlanningData = useCallback(async (token?: string) => {
    if (source !== "supabase" || !authUser?.id) return;
    const refreshResponse = await fetch("/api/planning-data", {
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
    });
    const refreshPayload = await refreshResponse.json().catch(() => null) as (Partial<PlanningDataResponse> & { error?: string }) | null;
    if (!refreshResponse.ok || !refreshPayload?.data) return;
    const nextData = normalizePlanningData(refreshPayload.data);
    setProtectedPlanningDataCache({ authUserId: authUser.id, data: nextData, currentProfile: refreshPayload.currentProfile || serverCurrentProfile });
    setData(nextData);
    setProtectedDataLoaded(true);
  }, [authUser, serverCurrentProfile, setProtectedDataLoaded, source]);

  const runNotificationDelivery = useCallback((payload: Record<string, unknown>, fallbackError: string) => {
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
          body: JSON.stringify(payload),
        });

        const body = (await response.json().catch(() => null)) as { error?: string; sent?: number; failed?: number; skipped?: number } | null;
        if (!response.ok && !body?.error) throw new Error(fallbackError);
        if (!response.ok) throw new Error(body?.error || "Google-Chat-Dispatch konnte nicht ausgeführt werden.");

        setNotificationDispatchMessage(`${body?.sent || 0} gesendet, ${body?.failed || 0} fehlgeschlagen, ${body?.skipped || 0} übersprungen.`);
        await refreshGoogleChatStatus();
        await refreshPlanningData(token);
      } catch (error) {
        setNotificationDispatchMessage(error instanceof Error ? error.message : "Google-Chat-Dispatch konnte nicht ausgeführt werden.");
      }
      });
  }, [refreshGoogleChatStatus, refreshPlanningData, source]);

  const dispatchNotifications = () => {
    runNotificationDelivery({ limit: 20 }, "Google-Chat-Dispatch konnte nicht ausgeführt werden.");
  };

  const retryNotificationDelivery = (delivery: NotificationDelivery) => {
    runNotificationDelivery({ eventIds: [delivery.eventId], limit: 1 }, "Google-Chat-Retry konnte nicht ausgeführt werden.");
  };

  const sendGoogleChatTest = (testDelivery: "webhook_digest" | "direct_dm", profileId?: string) => {
    runNotificationDelivery(
      { testDelivery, ...(profileId ? { profileId } : {}), limit: 1 },
      "Google-Chat-Testversand konnte nicht ausgeführt werden.",
    );
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

  const createScoreObjection = (sprint: Sprint, comment: string) => {
    if (!currentProfile) {
      setSaveError("GitHub-User ist keinem Teamprofil zugeordnet.");
      return;
    }
    setSaveError("");

    const localObjection: ScoreObjection = {
      id: Date.now(),
      sprintId: sprint.id,
      profileId: currentProfile.id,
      founderSprintScoreId: null,
      status: "open",
      comment,
      resolutionComment: "",
      reviewedBy: "",
      reviewedAt: "",
      secondReviewerProfileId: "",
      secondReviewDecision: "",
      secondReviewedAt: "",
      createdAt: new Date().toISOString(),
    };
    const previousData = data;
    setData((current) => ({ ...current, scoreObjections: [localObjection, ...current.scoreObjections] }));

    if (source !== "supabase") return;

    startTransition(async () => {
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;
      try {
        const response = await fetch(`/api/sprints/${sprint.id}/score-objections`, {
          method: "POST",
          headers: requestHeaders(token),
          body: JSON.stringify({ comment }),
        });
        const body = (await response.json().catch(() => null)) as { error?: string; objection?: Parameters<typeof mapScoreObjectionResponse>[0] } | null;
        if (!response.ok || !body?.objection) throw new Error(body?.error || "Score-Einwand konnte nicht gespeichert werden.");
        const saved = mapScoreObjectionResponse(body.objection);
        setData((current) => ({
          ...current,
          scoreObjections: current.scoreObjections.map((item) => (item.id === localObjection.id ? saved : item)),
        }));
      } catch (error) {
        setData(previousData);
        setSaveError(error instanceof Error ? error.message : "Score-Einwand konnte nicht gespeichert werden.");
      }
    });
  };

  const reviewScoreObjection = (sprint: Sprint, objectionId: number, status: "reviewed" | "dismissed" | "accepted") => {
    setSaveError("");
    const previousData = data;
    setData((current) => ({
      ...current,
      scoreObjections: current.scoreObjections.map((item) => (item.id === objectionId ? { ...item, status, reviewedBy: currentProfile?.id || "", reviewedAt: new Date().toISOString() } : item)),
    }));

    if (source !== "supabase") return;

    startTransition(async () => {
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;
      try {
        const response = await fetch(`/api/sprints/${sprint.id}/score-objections`, {
          method: "PATCH",
          headers: requestHeaders(token),
          body: JSON.stringify({ objectionId, status, resolutionComment: status === "accepted" ? "Einwand angenommen." : "Einwand geprüft." }),
        });
        const body = (await response.json().catch(() => null)) as { error?: string; objection?: Parameters<typeof mapScoreObjectionResponse>[0] } | null;
        if (!response.ok || !body?.objection) throw new Error(body?.error || "Score-Einwand konnte nicht geprüft werden.");
        const saved = mapScoreObjectionResponse(body.objection);
        setData((current) => ({
          ...current,
          scoreObjections: current.scoreObjections.map((item) => (item.id === saved.id ? saved : item)),
        }));
      } catch (error) {
        setData(previousData);
        setSaveError(error instanceof Error ? error.message : "Score-Einwand konnte nicht geprüft werden.");
      }
    });
  };

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
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ finalizeNow: true }),
        });

        const body = (await response.json().catch(() => null)) as { error?: string; carryover?: { created?: number; evaluated?: number; nextSprintId?: string }; scoring?: { scores?: number; strikeEvents?: number; governanceReviews?: number } } | null;
        if (!response.ok) throw new Error(body?.error || "Sprint konnte nicht gelockt werden.");
        if (body?.carryover) {
          setSprintLockMessage(`${body.carryover.evaluated || 0} offene Deliverables bewertet, ${body.carryover.created || 0} Carry-over-Aufgaben erstellt. ${body.scoring?.scores || 0} FounderOps-Scores finalisiert, ${body.scoring?.strikeEvents || 0} Strike-Ereignisse geschrieben${body.scoring?.governanceReviews ? `, ${body.scoring.governanceReviews} Governance Review nötig` : ""}.`);
        }
        const refreshResponse = await fetch("/api/planning-data", {
          headers: {
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
        });
        const refreshPayload = await refreshResponse.json().catch(() => null) as (Partial<PlanningDataResponse> & { error?: string }) | null;
        if (refreshResponse.ok && refreshPayload?.data && authUser?.id) {
          const nextData = normalizePlanningData(refreshPayload.data);
          setProtectedPlanningDataCache({ authUserId: authUser.id, data: nextData, currentProfile: refreshPayload.currentProfile || serverCurrentProfile });
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
              <CurrentAuthControl
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
            <CurrentAuthControl
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
        currentPlatformRole={currentProfile?.platformRole || ""}
        mobileOpen={mobileNavOpen}
        onMobileClose={() => setMobileNavOpen(false)}
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
          <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-4 lg:items-center lg:px-6">
            <div className="flex min-w-0 max-w-full items-start gap-3">
              <button
                type="button"
                onClick={() => setMobileNavOpen(true)}
                className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 lg:hidden"
                aria-label="Navigation öffnen"
                aria-expanded={mobileNavOpen}
              >
                <Menu size={19} />
              </button>
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
            </div>
            <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
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
                <CurrentAuthControl
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
                className="inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700"
              >
                <MessageSquare size={16} />
                Feedback
              </button>
              {headerPrimaryAction && (
                <button
                  type="button"
                  onClick={headerPrimaryAction.onClick}
                  className="inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700"
                >
                  <Plus size={16} />
                  {headerPrimaryAction.label}
                </button>
              )}
              {filtersAvailable && (
                <button
                  type="button"
                  onClick={() => setShowFilters((value) => !value)}
                  className="inline-flex h-9 shrink-0 items-center gap-2 whitespace-nowrap rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700"
                >
                  <Filter size={16} />
                  Filter
                </button>
              )}
            </div>
          </div>

          {filtersAvailable && <div className="flex flex-wrap items-center gap-2 px-4 pb-3 lg:px-6">
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

        <section className="min-w-0 px-4 pb-8 pt-4 lg:px-6">
          {workspace === "ceo-intake" && canUseCeoIntake && (
            <CeoTaskIntake
              source={source}
              profiles={data.profiles}
              packages={data.packages}
              sprints={data.sprints}
              requestHeaders={requestHeaders}
              onTasksCreated={(tasks) => {
                setData((current) => ({
                  ...current,
                  tasks: sortTasks([...current.tasks, ...tasks]),
                }));
              }}
            />
          )}
          {workspace === "ceo-intake" && !canUseCeoIntake && (
            <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
              <h2 className="text-lg font-semibold text-slate-950">CEO Intake ist geschützt</h2>
              <p className="mt-2 max-w-2xl text-sm leading-6 text-slate-600">
                Dieser Bereich ist ausschließlich für die CEO-Rolle freigeschaltet. Deputy, Founder, Accountable, Responsible und Assignee haben hier keinen Zugriff.
              </p>
            </section>
          )}
          {workspace === "projects" && (
            <CurrentProjectsOverview
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
          {workspace === "tools" && <CurrentFmdToolsOverview tools={data.fmdTools} />}
          {workspace === "team" && (
            <CurrentTeamOverview
              data={data}
              tasks={data.tasks}
              pending={isPending}
              canManageTeam={source === "seed" || currentProfile?.platformRole === "ceo"}
              currentProfileId={currentProfile?.id || ""}
              onSaveProfileSettings={saveProfileSettings}
            />
          )}
          {workspace === "sprint" && (
            <CurrentSprintScoreTableOverview
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
              onCreateScoreObjection={createScoreObjection}
              onReviewScoreObjection={reviewScoreObjection}
              onAssignSprint={(task, sprintId) => updateTask(task, { sprintId })}
              currentProfile={currentProfile}
              canManageSprint={currentProfile?.platformRole === "ceo" || currentProfile?.platformRole === "deputy"}
              sprintLockMessage={sprintLockMessage}
              focusedReviewTaskId={focusedReviewTaskId}
              onFocusedReviewTaskHandled={() => setFocusedReviewTaskId("")}
            />
          )}
          {workspace === "decisions" && (
            <CurrentDecisionLogOverview
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
            <CurrentMeetingFinderOverview
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
              onRetryNotificationDelivery={retryNotificationDelivery}
              onSendGoogleChatTest={sendGoogleChatTest}
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
                    className={`min-w-[min(360px,calc(100vw-2rem))] max-w-[min(360px,calc(100vw-2rem))] basis-[min(360px,calc(100vw-2rem))] shrink-0 grow-0 overflow-hidden rounded-lg border bg-blue-50/60 transition ${dragOverStatus === status ? "border-blue-400 ring-2 ring-blue-200" : "border-blue-100"}`}
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
                      {tasks.length ? tasks.map((task) => {
                        const canUpdateStatus = canChangeTaskStatus(task);
                        return (
                          <TaskCard
                            key={task.id}
                            task={task}
                            pack={packageById(data.packages, task.packageId)}
                            ownerColor={profileColor(data.profiles.find((profile) => profile.name === task.owner))}
                            relations={data.taskRelations}
                            allTasks={data.tasks}
                            statusOptions={canUpdateStatus ? statusOptionsForRole(task.status, canManageTaskMeta) : [normalizeStatus(task.status)]}
                            statusDisabled={!canUpdateStatus}
                            onOpen={(nextTask) => openTaskPanel(nextTask.id)}
                            onStatusChange={(nextTask, nextStatus) => updateTask(nextTask, { status: nextStatus })}
                            onDragStart={canUpdateStatus ? startTaskDrag : undefined}
                            onDragEnd={endTaskDrag}
                            isDragging={draggedTaskId === task.id}
                          />
                        );
                      }) : <EmptyColumn />}
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
                        {tasks.map((task) => {
                          const canUpdateStatus = canChangeTaskStatus(task);
                          return (
                            <TaskCard
                              key={task.id}
                              task={task}
                              pack={pack}
                              ownerColor={profileColor(data.profiles.find((profile) => profile.name === task.owner))}
                              relations={data.taskRelations}
                              allTasks={data.tasks}
                              statusOptions={canUpdateStatus ? statusOptionsForRole(task.status, canManageTaskMeta) : [normalizeStatus(task.status)]}
                              statusDisabled={!canUpdateStatus}
                              onOpen={(nextTask) => openTaskPanel(nextTask.id)}
                              onStatusChange={(nextTask, nextStatus) => updateTask(nextTask, { status: nextStatus })}
                            />
                          );
                        })}
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
                    const canUpdateStatus = canChangeTaskStatus(task);
                    return (
                    <tr key={task.id} className="border-b border-slate-100 align-top hover:bg-slate-50">
                      <td className="px-3 py-3">
                        <CustomSelect value={normalizeStatus(task.status)} disabled={!canUpdateStatus} onChange={(value) => updateTask(task, { status: value })} className="h-8 w-32 text-xs" options={(canUpdateStatus ? statusOptionsForRole(task.status, canManageTaskMeta) : [normalizeStatus(task.status)]).map((status) => ({ value: status, label: status }))} />
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
            <CurrentGanttView tasks={visibleTasks} packages={data.packages} sprints={data.sprints} relations={data.taskRelations} onOpen={(task) => openTaskPanel(task.id)} />
          )}
          </>
          )}
        </section>
      </main>

      {selectedTask && (
        <CurrentTaskDetailPanel
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
          canManageReviewOwner={currentProfile?.platformRole === "ceo"}
          canChangeTaskStatus={canChangeTaskStatus(selectedTask)}
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
          onOpenReview={() => openReviewSheet(selectedTask)}
          onDelete={() => deleteTask(selectedTask)}
          onAddRelation={(payload) => addTaskRelation(selectedTask, payload)}
          onRemoveRelation={(relation) => removeTaskRelation(selectedTask, relation)}
        />
      )}
      {taskDialogDefaults && (
        <CurrentNewTaskDialog
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
        <CurrentFeedbackDialog
          pending={isPending}
          onClose={() => setFeedbackDialogOpen(false)}
          onSubmit={createFeedback}
        />
      )}
    </div>
  );
}

void LegacyExecutionLayerOverview;
void ProjectsOverview;
void FmdToolsOverview;
void TeamOverview;
void SprintScoreTableOverview;
void DecisionLogOverview;
void MeetingFinderOverview;
void LegacySettingsOverview;
void AuthControl;
void FeedbackDialog;
void GanttView;
void NewTaskDialog;
void TaskDetailPanel;
function LegacyExecutionLayerOverview({
  data,
  currentProfile,
  focusItems,
  hygieneAlerts,
  pending,
  onOpenTask,
  onSetFocus,
  onRemoveFocus,
  onLinkDecisionTask,
  onRemoveDecisionTaskLink,
  onCreateTask,
}: {
  data: PlanningData;
  currentProfile: Profile | null;
  focusItems: TaskFocusItem[];
  hygieneAlerts: HygieneAlert[];
  pending: boolean;
  onOpenTask: (task: Task) => void;
  onSetFocus: (task: Task, nextStep: string, status?: TaskFocusItem["status"]) => void;
  onRemoveFocus: (focusItem: TaskFocusItem) => void;
  onLinkDecisionTask: (decisionId: number, taskId: string, note: string) => void;
  onRemoveDecisionTaskLink: (link: DecisionTaskLink) => void;
  onCreateTask: (draft: Partial<NewTaskDraft>) => void;
}) {
  const [focusDrafts, setFocusDrafts] = useState<Record<string, string>>({});
  const [decisionTaskDrafts, setDecisionTaskDrafts] = useState<Record<number, string>>({});
  const [decisionNoteDrafts, setDecisionNoteDrafts] = useState<Record<number, string>>({});
  const [alertSeverityFilter, setAlertSeverityFilter] = useState<"all" | HygieneAlert["severity"]>("all");
  const [alertAreaFilter, setAlertAreaFilter] = useState<"all" | HygieneAlert["area"]>("all");
  const taskById = new Map(data.tasks.map((task) => [task.id, task]));
  const openTasks = data.tasks.filter((task) => normalizeStatus(task.status) !== "Erledigt");
  const focusStatusCounts = focusItems.reduce<Record<TaskFocusItem["status"], number>>((counts, item) => {
    counts[item.status] += 1;
    return counts;
  }, { planned: 0, done: 0, blocked: 0, deferred: 0, needs_decision: 0 });
  const endOfDayOpenItems = focusItems.filter((item) => item.status === "planned");
  const endOfDayResolvedItems = focusItems.filter((item) => item.status !== "planned");
  const endOfDayCompletion = focusItems.length ? Math.round((endOfDayResolvedItems.length / focusItems.length) * 100) : 0;
  const today = currentIsoDate();
  const weekStart = addDaysIso(today, -6);
  const todayTeamFocusItems = data.taskFocusItems
    .filter((item) => item.focusDate === today)
    .sort((left, right) => left.position - right.position);
  const focusHistoryByDate = data.taskFocusItems
    .filter((item) => item.focusDate >= weekStart && item.focusDate <= today)
    .reduce<Record<string, TaskFocusItem[]>>((groups, item) => {
      groups[item.focusDate] = [...(groups[item.focusDate] || []), item];
      return groups;
    }, {});
  const focusHistoryDates = Object.keys(focusHistoryByDate).sort((left, right) => right.localeCompare(left)).slice(0, 7);
  const teamFocusCoverage = data.profiles.length
    ? Math.round((new Set(todayTeamFocusItems.map((item) => item.profileId)).size / data.profiles.length) * 100)
    : 0;
  const executionMetrics = {
    criticalAlerts: hygieneAlerts.filter((alert) => alert.severity === "critical").length,
    reviewQueue: data.tasks.filter((task) => normalizeStatus(task.status) === "Review" || task.reviewStatus === "requested").length,
    openBlockers: data.tasks.filter((task) => normalizeStatus(task.status) === "Blockiert" || hasOpenWaitingRelation(task.id, data.tasks, data.taskRelations)).length,
    decisionsWithoutTasks: data.decisions.filter((decision) => decision.status === "locked" && !data.decisionTaskLinks.some((link) => link.decisionId === decision.id)).length,
  };
  const suggestedTasks = [...openTasks]
    .sort((left, right) => {
      const priorityScore = (value: string) => ({ P0: 0, P1: 1, P2: 2, P3: 3, P4: 4 }[value as "P0"] ?? 5);
      const leftBlocked = hasOpenWaitingRelation(left.id, data.tasks, data.taskRelations) ? -1 : 0;
      const rightBlocked = hasOpenWaitingRelation(right.id, data.tasks, data.taskRelations) ? -1 : 0;
      return priorityScore(left.priority) - priorityScore(right.priority) || leftBlocked - rightBlocked || (left.endDate || "").localeCompare(right.endDate || "");
    })
    .slice(0, 6);
  const filteredAlerts = hygieneAlerts.filter((alert) =>
    (alertSeverityFilter === "all" || alert.severity === alertSeverityFilter)
    && (alertAreaFilter === "all" || alert.area === alertAreaFilter),
  );
  const visibleAlerts = filteredAlerts.slice(0, 12);

  return (
    <div className="grid gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(360px,0.8fr)]">
      <section className="xl:col-span-2 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {[
          ["Kritische Alerts", executionMetrics.criticalAlerts, "text-red-700"],
          ["Review Queue", executionMetrics.reviewQueue, "text-blue-700"],
          ["Blockiert/abhängig", executionMetrics.openBlockers, "text-amber-700"],
          ["Team-Fokus gesetzt", `${teamFocusCoverage}%`, "text-emerald-700"],
        ].map(([label, value, tone]) => (
          <div key={label} className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
            <div className="text-xs font-semibold text-slate-500">{label}</div>
            <div className={`mt-1 text-2xl font-semibold ${tone}`}>{value}</div>
          </div>
        ))}
      </section>
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-950">Heute-Fokus</h2>
            <p className="mt-1 text-sm text-slate-500">Maximal drei Aufgaben, nächster Schritt und Tagesstatus.</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <button
              type="button"
              disabled={pending || !focusItems.some((item) => item.status === "planned")}
              onClick={() => {
                focusItems
                  .filter((item) => item.status === "planned")
                  .forEach((item) => {
                    const task = taskById.get(item.taskId);
                    if (task) onSetFocus(task, item.nextStep || "Auf morgen verschoben.", "deferred");
                  });
              }}
              className="h-8 rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50"
            >
              Offene verschieben
            </button>
            <span className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600">
              {currentProfile?.name || "Team"} · {focusItems.length}/3
            </span>
          </div>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-4">
          {[
            ["Geplant", focusStatusCounts.planned],
            ["Erledigt", focusStatusCounts.done],
            ["Blockiert", focusStatusCounts.blocked],
            ["Entscheidung", focusStatusCounts.needs_decision],
          ].map(([label, value]) => (
            <div key={label} className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2">
              <div className="text-[11px] font-semibold text-slate-500">{label}</div>
              <div className="mt-1 text-lg font-semibold text-slate-950">{value}</div>
            </div>
          ))}
        </div>

        <div className="mt-4 grid gap-3">
          {focusItems.length ? focusItems.map((item) => {
            const task = taskById.get(item.taskId);
            if (!task) return null;
            return (
              <article key={item.id} className="rounded-md border border-slate-200 bg-slate-50 p-3">
                <div className="flex items-start justify-between gap-3">
                  <button type="button" onClick={() => onOpenTask(task)} className="text-left text-sm font-semibold text-slate-950 hover:text-blue-700">
                    {task.title}
                  </button>
                  <span className="shrink-0 rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">{focusStatusLabel(item.status)}</span>
                </div>
                <input
                  value={focusDrafts[item.taskId] ?? item.nextStep}
                  onChange={(event) => setFocusDrafts((current) => ({ ...current, [item.taskId]: event.target.value }))}
                  onBlur={() => onSetFocus(task, focusDrafts[item.taskId] ?? item.nextStep, item.status)}
                  className="mt-3 h-9 w-full rounded-md border border-slate-200 bg-white px-3 text-sm outline-none focus:border-blue-400"
                  placeholder={task.intendedOutcome || task.description || "Nächsten Schritt ergänzen."}
                />
                <div className="mt-3 flex flex-wrap gap-2">
                  {(["done", "blocked", "deferred", "needs_decision"] as TaskFocusItem["status"][]).map((status) => (
                    <button key={status} type="button" disabled={pending} onClick={() => onSetFocus(task, focusDrafts[item.taskId] ?? item.nextStep, status)} className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                      {focusStatusLabel(status)}
                    </button>
                  ))}
                  <button type="button" disabled={pending} onClick={() => onRemoveFocus(item)} className="h-8 rounded-md border border-red-200 bg-red-50 px-2 text-xs font-semibold text-red-700 hover:bg-red-100 disabled:opacity-50">
                    Entfernen
                  </button>
                </div>
              </article>
            );
          }) : (
            <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
              Noch kein Tagesfokus gesetzt.
            </div>
          )}
        </div>

        <div className="mt-5 rounded-lg border border-slate-200 bg-white p-4">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-950">Tagesabschluss</h3>
              <p className="mt-1 text-xs leading-5 text-slate-500">Offene Fokusaufgaben kurz abschließen, bevor sie in den nächsten Tag rutschen.</p>
            </div>
            <div className="text-right">
              <div className="text-xs font-semibold text-slate-500">Abschlussquote</div>
              <div className="mt-1 text-xl font-semibold text-slate-950">{endOfDayCompletion}%</div>
            </div>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-slate-100">
            <div className="h-full rounded-full bg-emerald-500 transition-all" style={{ width: `${endOfDayCompletion}%` }} />
          </div>
          <div className="mt-4 grid gap-2">
            {focusItems.length ? focusItems.map((item) => {
              const task = taskById.get(item.taskId);
              if (!task) return null;
              const currentNextStep = focusDrafts[item.taskId] ?? item.nextStep;
              return (
                <article key={`checkin-${item.id}`} className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <button type="button" onClick={() => onOpenTask(task)} className="min-w-0 text-left text-sm font-semibold text-slate-900 hover:text-blue-700">
                      {task.title}
                    </button>
                    <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-600">{focusStatusLabel(item.status)}</span>
                  </div>
                  <div className="mt-2 flex flex-wrap gap-2">
                    <button type="button" disabled={pending} onClick={() => onSetFocus(task, currentNextStep || "Heute erledigt.", "done")} className="h-8 rounded-md border border-emerald-200 bg-emerald-50 px-2 text-xs font-semibold text-emerald-700 hover:bg-emerald-100 disabled:opacity-50">
                      Als erledigt markieren
                    </button>
                    <button type="button" disabled={pending} onClick={() => onSetFocus(task, currentNextStep || "Blocker für morgen klären.", "blocked")} className="h-8 rounded-md border border-amber-200 bg-amber-50 px-2 text-xs font-semibold text-amber-700 hover:bg-amber-100 disabled:opacity-50">
                      Blockiert
                    </button>
                    <button type="button" disabled={pending} onClick={() => onSetFocus(task, currentNextStep || "Auf morgen verschoben.", "deferred")} className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">
                      Verschieben
                    </button>
                    <button type="button" disabled={pending} onClick={() => onSetFocus(task, currentNextStep || "Braucht eine Entscheidung.", "needs_decision")} className="h-8 rounded-md border border-blue-200 bg-blue-50 px-2 text-xs font-semibold text-blue-700 hover:bg-blue-100 disabled:opacity-50">
                      Entscheidung nötig
                    </button>
                  </div>
                </article>
              );
            }) : (
              <div className="rounded-md border border-dashed border-slate-200 px-3 py-6 text-center text-sm text-slate-500">Kein Tagesfokus für den Abschluss vorhanden.</div>
            )}
          </div>
          {endOfDayOpenItems.length > 0 && (
            <div className="mt-3 rounded-md border border-amber-100 bg-amber-50 px-3 py-2 text-xs font-semibold text-amber-800">
              {endOfDayOpenItems.length} Fokusaufgaben sind noch geplant und brauchen einen Abschlussstatus.
            </div>
          )}
        </div>

        <div className="mt-5 grid gap-3 border-t border-slate-100 pt-4 lg:grid-cols-[minmax(0,1fr)_260px]">
          <section>
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-slate-950">Team-Fokus heute</h3>
              <span className="text-xs font-semibold text-slate-500">{todayTeamFocusItems.length} Fokusaufgaben</span>
            </div>
            <div className="mt-3 grid gap-2">
              {data.profiles.map((profile) => {
                const profileFocus = todayTeamFocusItems.filter((item) => item.profileId === profile.id).slice(0, 3);
                return (
                  <article key={profile.id} className="rounded-md border border-slate-200 bg-white p-3">
                    <div className="flex items-center justify-between gap-3">
                      <div className="flex min-w-0 items-center gap-2">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: profileColor(profile) }} />
                        <span className="truncate text-sm font-semibold text-slate-950">{profile.name}</span>
                      </div>
                      <span className="rounded-full border border-slate-200 px-2 py-0.5 text-[11px] font-semibold text-slate-500">{profileFocus.length}/3</span>
                    </div>
                    <div className="mt-2 grid gap-1">
                      {profileFocus.length ? profileFocus.map((item) => {
                        const task = taskById.get(item.taskId);
                        return task ? (
                          <button key={item.id} type="button" onClick={() => onOpenTask(task)} className="flex items-center justify-between gap-2 rounded-md bg-slate-50 px-2 py-1.5 text-left text-xs hover:bg-blue-50">
                            <span className="min-w-0 truncate font-semibold text-slate-700">{task.title}</span>
                            <span className="shrink-0 text-slate-500">{focusStatusLabel(item.status)}</span>
                          </button>
                        ) : null;
                      }) : (
                        <div className="rounded-md border border-dashed border-slate-200 px-2 py-2 text-xs text-slate-500">Kein Fokus gesetzt.</div>
                      )}
                    </div>
                  </article>
                );
              })}
            </div>
          </section>

          <section>
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-slate-950">Fokus-Verlauf</h3>
              <span className="text-xs font-semibold text-slate-500">7 Tage</span>
            </div>
            <div className="mt-3 grid gap-2">
              {focusHistoryDates.length ? focusHistoryDates.map((date) => {
                const items = focusHistoryByDate[date] || [];
                const done = items.filter((item) => item.status === "done").length;
                const blocked = items.filter((item) => item.status === "blocked" || item.status === "needs_decision").length;
                return (
                  <div key={date} className="rounded-md border border-slate-200 bg-white px-3 py-2">
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-xs font-semibold text-slate-700">{formatDate(date)}</span>
                      <span className="text-xs text-slate-500">{items.length} Fokus</span>
                    </div>
                    <div className="mt-2 grid grid-cols-2 gap-2 text-[11px] font-semibold">
                      <span className="rounded-full bg-emerald-50 px-2 py-1 text-emerald-700">{done} erledigt</span>
                      <span className="rounded-full bg-amber-50 px-2 py-1 text-amber-700">{blocked} kritisch</span>
                    </div>
                  </div>
                );
              }) : (
                <div className="rounded-md border border-dashed border-slate-200 px-3 py-8 text-center text-xs text-slate-500">Noch kein Fokus-Verlauf.</div>
              )}
            </div>
          </section>
        </div>

        <div className="mt-5 border-t border-slate-100 pt-4">
          <h3 className="text-sm font-semibold text-slate-950">Vorschläge für heute</h3>
          <div className="mt-3 grid grid-cols-1 gap-3">
            {suggestedTasks.map((task) => (
              <article key={task.id} className="w-full min-w-0 rounded-md border border-slate-200 p-3">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <button type="button" onClick={() => onOpenTask(task)} className="block w-full truncate text-left text-sm font-semibold text-slate-950 hover:text-blue-700">
                      {task.title}
                    </button>
                    <div className="mt-1 flex flex-wrap gap-1.5 text-[11px] font-semibold">
                      <span className={`rounded-full border px-2 py-0.5 ${priorityTone(task.priority)}`}>{task.priority}</span>
                      <span className={`rounded-full border px-2 py-0.5 ${statusTone(normalizeStatus(task.status))}`}>{normalizeStatus(task.status)}</span>
                      {hasOpenWaitingRelation(task.id, data.tasks, data.taskRelations) && <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-amber-700">wartet</span>}
                    </div>
                  </div>
                  <button
                    type="button"
                    disabled={pending || focusItems.length >= 3}
                    onClick={() => onSetFocus(task, focusDrafts[task.id] || task.intendedOutcome || task.acceptanceCriteria || "Nächsten Schritt klären.", "planned")}
                    className="h-8 rounded-md bg-blue-600 px-3 text-xs font-semibold text-white hover:bg-blue-700 disabled:opacity-50"
                  >
                    In Fokus
                  </button>
                </div>
                <input
                  value={focusDrafts[task.id] || ""}
                  onChange={(event) => setFocusDrafts((current) => ({ ...current, [task.id]: event.target.value }))}
                  className="mt-3 h-9 w-full rounded-md border border-slate-200 px-3 text-sm outline-none focus:border-blue-400"
                  placeholder="Nächster Schritt"
                />
              </article>
            ))}
          </div>
        </div>
      </section>

      <div className="grid gap-5">
        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-slate-950">Hygiene Alerts</h2>
            <span className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600">{filteredAlerts.length}/{hygieneAlerts.length} offen</span>
          </div>
          <div className="mt-3 grid gap-2 sm:grid-cols-2">
            <CustomSelect
              value={alertSeverityFilter}
              onChange={(value) => setAlertSeverityFilter(value as typeof alertSeverityFilter)}
              className="h-9 text-sm"
              options={[
                { value: "all", label: "Alle Schweregrade" },
                { value: "critical", label: "Kritisch" },
                { value: "warning", label: "Warnung" },
                { value: "info", label: "Info" },
              ]}
            />
            <CustomSelect
              value={alertAreaFilter}
              onChange={(value) => setAlertAreaFilter(value as typeof alertAreaFilter)}
              className="h-9 text-sm"
              options={[
                { value: "all", label: "Alle Bereiche" },
                { value: "focus", label: "Fokus" },
                { value: "quality", label: "Qualität" },
                { value: "blocker", label: "Blocker" },
                { value: "review", label: "Review" },
                { value: "evidence", label: "Evidence" },
                { value: "dependency", label: "Abhängigkeit" },
                { value: "decision", label: "Decision" },
                { value: "sync", label: "Sync" },
              ]}
            />
          </div>
          <div className="mt-4 grid gap-2">
            {visibleAlerts.length ? visibleAlerts.map((alert) => {
              const task = alert.taskId ? taskById.get(alert.taskId) : null;
              const tone = alert.severity === "critical" ? "border-red-200 bg-red-50 text-red-700" : alert.severity === "warning" ? "border-amber-200 bg-amber-50 text-amber-700" : "border-blue-200 bg-blue-50 text-blue-700";
              return (
                <article key={alert.id} className="rounded-md border border-slate-200 p-3">
                  <div className="flex items-start gap-2">
                    <span className={`mt-0.5 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${tone}`}>{alert.severity === "critical" ? "kritisch" : alert.severity === "warning" ? "Warnung" : "Info"}</span>
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold text-slate-950">{alert.title}</h3>
                      <p className="mt-1 text-xs leading-5 text-slate-600">{alert.description}</p>
                      <p className="mt-2 rounded-md bg-slate-50 px-2 py-1.5 text-xs font-semibold leading-5 text-slate-700">
                        Nächste Aktion: {alert.recommendedAction}
                      </p>
                      {task && (
                        <div className="mt-2 flex flex-wrap gap-2">
                          <button type="button" onClick={() => onOpenTask(task)} className="text-xs font-semibold text-blue-600 hover:text-blue-700">{task.title}</button>
                          <button type="button" disabled={pending || focusItems.length >= 3} onClick={() => onSetFocus(task, alert.recommendedAction, alert.focusStatus || "planned")} className="h-7 rounded-md border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:opacity-50">Aktion in Fokus</button>
                        </div>
                      )}
                    </div>
                  </div>
                </article>
              );
            }) : (
              <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">Keine Hygiene Alerts offen.</div>
            )}
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex items-center justify-between gap-3">
            <h2 className="text-base font-semibold text-slate-950">Decision-Folgearbeit</h2>
            <span className="text-xs font-semibold text-slate-500">{data.decisionTaskLinks.length} Links · {executionMetrics.decisionsWithoutTasks} offen</span>
          </div>
          <div className="mt-4 grid gap-3">
            {data.decisions.slice(0, 5).map((decision) => {
              const links = data.decisionTaskLinks.filter((link) => link.decisionId === decision.id);
              const linkedTasks = links.map((link) => ({ link, task: taskById.get(link.taskId) })).filter((item): item is { link: DecisionTaskLink; task: Task } => Boolean(item.task));
              const followUpCounts = {
                open: linkedTasks.filter(({ task }) => !["Erledigt", "Blockiert"].includes(normalizeStatus(task.status))).length,
                done: linkedTasks.filter(({ task }) => normalizeStatus(task.status) === "Erledigt").length,
                blocked: linkedTasks.filter(({ task }) => normalizeStatus(task.status) === "Blockiert" || hasOpenWaitingRelation(task.id, data.tasks, data.taskRelations)).length,
              };
              const selectedTaskId = decisionTaskDrafts[decision.id] || "";
              return (
                <article key={decision.id} className="rounded-md border border-slate-200 p-3">
                  <div className="flex items-start justify-between gap-3">
                    <div className="min-w-0">
                      <h3 className="text-sm font-semibold text-slate-950">{decision.title}</h3>
                      <p className="mt-1 text-xs text-slate-500">{links.length} verknüpfte Aufgaben · {decisionStatusLabel(decision.status)}</p>
                    </div>
                    <button
                      type="button"
                      onClick={() => onCreateTask({
                        taskType: "deliverable",
                        title: `${decision.title} umsetzen`,
                        description: decision.context,
                        problemStatement: decision.context,
                        intendedOutcome: decision.decision,
                        acceptanceCriteria: decision.decision,
                        definitionOfDone: decision.decision,
                        decisionId: decision.id,
                        decisionLinkNote: "Folgeaufgabe aus Decision",
                      })}
                      className="h-8 shrink-0 rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                    >
                      Folgeaufgabe
                    </button>
                  </div>
                  <div className="mt-3 grid grid-cols-3 gap-2 text-[11px] font-semibold">
                    <span className="rounded-full bg-blue-50 px-2 py-1 text-blue-700">{followUpCounts.open} Folgearbeit offen</span>
                    <span className="rounded-full bg-emerald-50 px-2 py-1 text-emerald-700">{followUpCounts.done} erledigt</span>
                    <span className="rounded-full bg-amber-50 px-2 py-1 text-amber-700">{followUpCounts.blocked} blockiert</span>
                  </div>
                  {links.length > 0 && (
                    <div className="mt-3 grid gap-1">
                      {linkedTasks.map(({ link, task }) => {
                        const status = normalizeStatus(task.status);
                        const isBlocked = status === "Blockiert" || hasOpenWaitingRelation(task.id, data.tasks, data.taskRelations);
                        return (
                          <div key={link.id} className="flex items-center gap-2 rounded-md bg-slate-50 px-2 py-1">
                            <button type="button" onClick={() => onOpenTask(task)} className="min-w-0 flex-1 truncate text-left text-xs font-semibold text-slate-700 hover:text-blue-700">{task.title}</button>
                            <span className={`shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold ${status === "Erledigt" ? "bg-emerald-50 text-emerald-700" : isBlocked ? "bg-amber-50 text-amber-700" : "bg-blue-50 text-blue-700"}`}>
                              {status === "Erledigt" ? "erledigt" : isBlocked ? "blockiert" : "offen"}
                            </span>
                            <button type="button" disabled={pending} onClick={() => onRemoveDecisionTaskLink(link)} className="grid h-6 w-6 shrink-0 place-items-center rounded-md border border-slate-200 text-slate-400 hover:border-red-200 hover:bg-red-50 hover:text-red-600" aria-label="Decision-Link entfernen">
                              <X size={12} />
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <div className="mt-3 grid gap-2">
                    <CustomSelect
                      value={selectedTaskId}
                      onChange={(value) => setDecisionTaskDrafts((current) => ({ ...current, [decision.id]: value }))}
                      options={[{ value: "", label: "Aufgabe auswählen" }, ...openTasks.map((task) => ({ value: task.id, label: task.title }))]}
                      className="h-9 text-sm"
                    />
                    <input
                      value={decisionNoteDrafts[decision.id] || ""}
                      onChange={(event) => setDecisionNoteDrafts((current) => ({ ...current, [decision.id]: event.target.value }))}
                      className="h-9 rounded-md border border-slate-200 px-3 text-sm outline-none focus:border-blue-400"
                      placeholder="Warum folgt diese Aufgabe aus der Decision?"
                    />
                    <button
                      type="button"
                      disabled={pending || !selectedTaskId}
                      onClick={() => onLinkDecisionTask(decision.id, selectedTaskId, decisionNoteDrafts[decision.id] || "")}
                      className="h-9 rounded-md bg-slate-900 px-3 text-sm font-semibold text-white hover:bg-slate-800 disabled:opacity-50"
                    >
                      Verknüpfen
                    </button>
                  </div>
                </article>
              );
            })}
          </div>
        </section>
      </div>
    </div>
  );
}

function ProjectsOverview({ data, tasks }: { data: PlanningData; tasks: Task[] }) {
  const milestones = data.milestones.length
    ? data.milestones
    : [{ id: "", title: "Ohne Epic", description: "Group Commitments ohne zugeordneten Meilenstein.", targetDate: "", status: "planned" as const, sortOrder: 999 }];

  return (
    <div className="grid gap-4">
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Aktives Projekt</div>
        <h2 className="mt-1 text-lg font-semibold text-slate-950">{data.project.name}</h2>
        <p className="mt-1 text-sm text-slate-500">Struktur: Epic / Meilenstein → Group Commitment → Deliverable → Sub-Issue. Sprints sind der Zeitcontainer für Deliverables.</p>
      </section>
      <section className="grid gap-4">
        {milestones.map((milestone) => {
          const groups = data.packages.filter((pack) => (milestone.id ? pack.milestoneId === milestone.id : !pack.milestoneId));
          const milestoneTasks = tasks.filter((task) => groups.some((pack) => pack.id === task.packageId));
          return (
            <article key={milestone.id || "without-epic"} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <div className="flex flex-wrap items-start justify-between gap-3">
                <div>
                  <div className="text-xs font-semibold uppercase tracking-wide text-blue-700">Epic / Meilenstein</div>
                  <h3 className="mt-1 text-base font-semibold text-slate-950">{milestone.title}</h3>
                  <p className="mt-1 text-sm leading-6 text-slate-600">{milestone.description}</p>
                </div>
                <span className="rounded-full border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-600">{milestoneTasks.length} Deliverables</span>
              </div>
              <div className="mt-4 grid gap-3 lg:grid-cols-2">
                {groups.map((pack) => {
                  const packageTasks = tasks.filter((task) => task.packageId === pack.id && task.taskType !== "sub_issue");
                  const done = packageTasks.filter((task) => normalizeStatus(task.status) === "Erledigt").length;
                  const blocked = packageTasks.filter((task) => task.dependsOn || normalizeStatus(task.status) === "Blockiert").length;
                  return (
                    <div key={pack.id} className="rounded-lg border border-slate-100 bg-slate-50 p-3">
                      <div className="flex items-start justify-between gap-3">
                        <div>
                          <div className="text-xs font-semibold text-blue-700">{pack.id} · {pack.priority}</div>
                          <h4 className="mt-1 text-sm font-semibold text-slate-950">{pack.title}</h4>
                        </div>
                        <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-600">{packageTasks.length} Deliverables</span>
                      </div>
                      <p className="mt-2 text-sm leading-6 text-slate-600">{pack.goal}</p>
                      <div className="mt-3 grid grid-cols-3 gap-2 text-sm">
                        <div className="rounded-md bg-white p-2"><div className="text-xs text-slate-500">Erledigt</div><div className="font-semibold text-slate-900">{done}</div></div>
                        <div className="rounded-md bg-white p-2"><div className="text-xs text-slate-500">Blockiert</div><div className="font-semibold text-slate-900">{blocked}</div></div>
                        <div className="rounded-md bg-white p-2"><div className="text-xs text-slate-500">Aufwand</div><div className="font-semibold text-slate-900">{packageTasks.reduce((sum, task) => sum + task.hours, 0)}h</div></div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </article>
          );
        })}
      </section>
    </div>
  );
}

function FmdToolsOverview({ tools = [] }: { tools?: FmdTool[] }) {
  const groups: Array<{ id: FmdTool["category"]; label: string; empty: string }> = [
    { id: "tool", label: "Interne Tools", empty: "Noch keine internen Tools hinterlegt." },
    { id: "repo", label: "Repos & Automationen", empty: "Noch keine Repos hinterlegt." },
    { id: "knowledge", label: "Notion & Wissen", empty: "Noch keine Wissensquellen hinterlegt." },
    { id: "asset", label: "Drive & Assets", empty: "Noch keine Asset-Ablagen hinterlegt." },
  ];
  const activeTools = tools.filter((tool) => tool.status === "active").length;
  const missingLinks = tools.filter((tool) => tool.status === "missing_link").length;

  return (
    <div className="grid gap-4">
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-950">FMD-Tools Hub</h2>
            <p className="mt-1 text-sm text-slate-500">Zentraler Einstieg für interne Rechner, Generatoren, Crawler, Repos, Notion und Drive.</p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs font-semibold">
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-emerald-700">{activeTools} aktiv</span>
            <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-amber-700">{missingLinks} Link fehlt</span>
          </div>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        {groups.map((group) => {
          const groupTools = tools.filter((tool) => tool.category === group.id);
          return (
            <section key={group.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-950">{group.label}</h3>
              <div className="mt-3 grid gap-2">
                {groupTools.map((tool) => (
                  <article key={tool.id} className="rounded-md border border-slate-100 bg-slate-50 px-3 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="font-semibold text-slate-950">{tool.name}</h4>
                          <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-600">{tool.kind}</span>
                        </div>
                        <p className="mt-1 text-sm leading-6 text-slate-600">{tool.description}</p>
                        <div className="mt-2 text-xs text-slate-500">{tool.owner || "Team"} · {tool.status === "missing_link" ? "Link ergänzen" : tool.status}</div>
                      </div>
                      {tool.url ? (
                        <a href={tool.url} target="_blank" rel="noreferrer" className="inline-flex h-8 shrink-0 items-center gap-2 rounded-md border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                          <ExternalLink size={14} />
                          Öffnen
                        </a>
                      ) : (
                        <span className="inline-flex h-8 shrink-0 items-center rounded-md border border-amber-200 bg-amber-50 px-2 text-xs font-semibold text-amber-700">Link fehlt</span>
                      )}
                    </div>
                  </article>
                ))}
                {!groupTools.length && <div className="rounded-md border border-dashed border-slate-200 px-3 py-8 text-center text-sm text-slate-500">{group.empty}</div>}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}

function TeamOverview({
  data,
  tasks,
  pending,
  canManageTeam,
  currentProfileId,
  onUpdateProfile,
  onUpdateNotificationPreference,
}: {
  data: PlanningData;
  tasks: Task[];
  pending: boolean;
  canManageTeam: boolean;
  currentProfileId: string;
  onUpdateProfile: (profile: Profile, patch: Partial<Profile>) => void;
  onUpdateNotificationPreference: (profileId: string, eventType: string, enabled: boolean) => void;
}) {
  const today = new Date().toISOString().slice(0, 10);
  const activeDeputies = data.profiles.filter((profile) => {
    if (profile.platformRole !== "deputy") return false;
    if (profile.deputyActiveFrom && profile.deputyActiveFrom > today) return false;
    if (profile.deputyActiveUntil && profile.deputyActiveUntil < today) return false;
    return Boolean(profile.deputyFor);
  });

  return (
    <div className="grid gap-4">
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-950">Rollen & Vertretung</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-slate-500">
              CEO verwaltet Rollen, GitHub-Zuordnung, Deputy-Zeiträume, Google-Chat-Ziele und Kalender-Sync. Deputy bekommt operative Rechte, aber kein Decision-Log-Edit.
            </p>
          </div>
          <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${canManageTeam ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-600"}`}>
            {canManageTeam ? "CEO-Bearbeitung aktiv" : "Nur Ansicht"}
          </span>
        </div>
        <div className="mt-4 grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          {platformRoleOptions.map((role) => {
            const count = data.profiles.filter((profile) => profile.platformRole === role).length;
            return (
              <div key={role} className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2">
                <div className="text-xs font-semibold text-slate-500">{role === "ceo" ? "CEO" : role === "founder" ? "Founder" : role === "deputy" ? "Deputy" : "Viewer"}</div>
                <div className="mt-1 text-lg font-semibold text-slate-950">{count}</div>
              </div>
            );
          })}
        </div>
        <div className="mt-4 rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-600">
          {activeDeputies.length ? (
            activeDeputies.map((profile) => {
              const represented = data.profiles.find((item) => item.id === profile.deputyFor);
              return (
                <div key={profile.id}>
                  <span className="font-semibold text-slate-800">{profile.name}</span> vertritt {represented?.name || profile.deputyFor} {profile.deputyActiveUntil ? `bis ${formatDate(profile.deputyActiveUntil)}` : "ohne Enddatum"}.
                </div>
              );
            })
          ) : (
            "Aktuell ist keine aktive Deputy-Vertretung gesetzt."
          )}
        </div>
      </section>

      <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
      {data.profiles.map((profile) => {
        const ownedTasks = tasks.filter((task) => taskBelongsToProfile(task, profile));
        const openTasks = ownedTasks.filter((task) => normalizeStatus(task.status) !== "Erledigt");
        const highPriority = ownedTasks.filter((task) => ["P0", "P1"].includes(task.priority));
        const load = ownedTasks.reduce((sum, task) => sum + task.hours, 0);
        const isDeputy = profile.platformRole === "deputy";
        const canEditProfile = canManageTeam;
        const canEditNotificationEvents = canManageTeam || currentProfileId === profile.id;
        const enabledPreferenceCount = googleChatDigestEventTypes.filter((eventType) => {
          const preference = data.notificationPreferences.find((item) => item.profileId === profile.id && item.channel === "google_chat" && item.eventType === eventType);
          return preference?.enabled !== false;
        }).length;
        return (
          <article key={profile.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <div className="flex items-center gap-2">
                  <span className="h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: profileColor(profile) }} />
                  <h2 className="text-base font-semibold text-slate-950">{profile.name}</h2>
                </div>
                <p className="mt-1 text-sm leading-5 text-slate-500">{profile.focus || "Kein Fokus hinterlegt."}</p>
                <p className="mt-1 text-xs text-slate-500">@{profile.githubLogin || "nicht gemappt"}</p>
              </div>
              <span className="rounded-full border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-600">{roleLabel(profile)}</span>
            </div>
            <div className="mt-4 grid grid-cols-4 gap-2 text-sm">
              <div className="rounded-md bg-slate-50 p-2">
                <div className="text-xs text-slate-500">Offen</div>
                <div className="font-semibold text-slate-900">{openTasks.length}</div>
              </div>
              <div className="rounded-md bg-slate-50 p-2">
                <div className="text-xs text-slate-500">Hoch</div>
                <div className="font-semibold text-slate-900">{highPriority.length}</div>
              </div>
              <div className="rounded-md bg-slate-50 p-2">
                <div className="text-xs text-slate-500">Last</div>
                <div className="font-semibold text-slate-900">{load}h</div>
              </div>
              <div className="rounded-md bg-slate-50 p-2">
                <div className="text-xs text-slate-500">Kap.</div>
                <div className="font-semibold text-slate-900">{profile.weeklyCapacity}h</div>
              </div>
            </div>
            <div className="mt-4 grid gap-3 border-t border-slate-100 pt-4">
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1 text-xs font-semibold text-slate-500">
                  Plattformrolle
                  <CustomSelect
                    value={profile.platformRole}
                    disabled={pending || !canEditProfile}
                    onChange={(value) => {
                      const platformRole = value as PlatformRole;
                      onUpdateProfile(profile, {
                        platformRole,
                        orgRole: platformRole === "ceo" ? "CEO" : platformRole === "founder" ? "Founder" : platformRole === "deputy" ? "Deputy" : "Viewer",
                        deputyFor: platformRole === "deputy" ? profile.deputyFor || data.profiles.find((item) => item.platformRole === "ceo")?.id || "" : "",
                        deputyActiveFrom: platformRole === "deputy" ? profile.deputyActiveFrom : "",
                        deputyActiveUntil: platformRole === "deputy" ? profile.deputyActiveUntil : "",
                      });
                    }}
                    className="h-9 text-sm"
                    options={platformRoleOptions.map((role) => ({ value: role, label: role === "ceo" ? "CEO" : role === "founder" ? "Founder" : role === "deputy" ? "Deputy" : "Viewer" }))}
                  />
                </label>
                <label className="grid gap-1 text-xs font-semibold text-slate-500">
                  Org-Rolle
                  <input
                    value={profile.orgRole}
                    disabled={pending || !canEditProfile}
                    onChange={(event) => onUpdateProfile(profile, { orgRole: event.target.value })}
                    className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm font-normal text-slate-800 disabled:opacity-60"
                  />
                </label>
              </div>
              <label className="grid gap-1 text-xs font-semibold text-slate-500">
                GitHub Login
                <input
                  value={profile.githubLogin}
                  disabled={pending || !canEditProfile}
                  onChange={(event) => onUpdateProfile(profile, { githubLogin: event.target.value })}
                  className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm font-normal text-slate-800 disabled:opacity-60"
                />
              </label>
              <div className="grid gap-3 sm:grid-cols-2">
                <label className="grid gap-1 text-xs font-semibold text-slate-500">
                  Google Chat User-ID
                  <input
                    value={profile.googleChatUserId || ""}
                    disabled={pending || !canEditProfile}
                    onChange={(event) => onUpdateProfile(profile, { googleChatUserId: event.target.value })}
                    className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm font-normal text-slate-800 disabled:opacity-60"
                    placeholder="users/..."
                  />
                </label>
                <label className="grid gap-1 text-xs font-semibold text-slate-500">
                  Google Chat DM-Space
                  <input
                    value={profile.googleChatDmSpace || ""}
                    disabled={pending || !canEditProfile}
                    onChange={(event) => onUpdateProfile(profile, { googleChatDmSpace: event.target.value })}
                    className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm font-normal text-slate-800 disabled:opacity-60"
                    placeholder="spaces/..."
                  />
                </label>
              </div>
              <label className="flex items-center justify-between gap-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
                <span>
                  Google-Chat-Benachrichtigungen
                  <span className="mt-0.5 block text-[11px] font-normal text-slate-500">Deaktiviert verhindert Digest-Zustellung für dieses Profil.</span>
                </span>
                <input
                  type="checkbox"
                  checked={profile.notificationsEnabled !== false}
                  disabled={pending || !canEditProfile}
                  onChange={(event) => onUpdateProfile(profile, { notificationsEnabled: event.target.checked })}
                  className="h-4 w-4 rounded border-slate-300 text-blue-600 disabled:opacity-60"
                />
              </label>
              <div className="rounded-md border border-blue-100 bg-blue-50 p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold text-blue-900">Google Calendar Sync</div>
                    <p className="mt-0.5 text-[11px] leading-4 text-blue-700">Aktiviert importiert Kalendertermine als schreibgeschützte Meeting-Finder-Blocker.</p>
                  </div>
                  <input
                    type="checkbox"
                    checked={Boolean(profile.googleCalendarSyncEnabled)}
                    disabled={pending || !canEditProfile || !profile.googleCalendarEmail}
                    onChange={(event) => onUpdateProfile(profile, { googleCalendarSyncEnabled: event.target.checked })}
                    className="mt-1 h-4 w-4 rounded border-blue-300 text-blue-600 disabled:opacity-60"
                    aria-label="Google Calendar Sync aktivieren"
                  />
                </div>
                <label className="mt-3 grid gap-1 text-xs font-semibold text-blue-900">
                  Kalender-E-Mail
                  <input
                    value={profile.googleCalendarEmail || ""}
                    disabled={pending || !canEditProfile}
                    onChange={(event) => onUpdateProfile(profile, { googleCalendarEmail: event.target.value })}
                    className="h-9 rounded-md border border-blue-100 bg-white px-2 text-sm font-normal text-slate-800 disabled:opacity-60"
                    placeholder="name@findmydoc.eu"
                  />
                </label>
                <p className="mt-2 text-[11px] leading-4 text-blue-700">
                  Letzter Sync: {profile.googleCalendarLastSyncedAt ? formatDate(profile.googleCalendarLastSyncedAt) : "noch nicht synchronisiert"}
                </p>
              </div>
              <div className="rounded-md border border-slate-200 bg-white p-3">
                <div className="flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs font-semibold text-slate-700">Google-Chat-Events</div>
                    <p className="mt-0.5 text-[11px] leading-4 text-slate-500">Feinsteuerung pro Ereignistyp. Ausgeschaltete Events bleiben in der App sichtbar.</p>
                  </div>
                  <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-[11px] font-semibold text-slate-600">{enabledPreferenceCount}/{googleChatDigestEventTypes.length}</span>
                </div>
                <div className="mt-3 grid gap-2 sm:grid-cols-2">
                  {googleChatDigestEventTypes.map((eventType) => {
                    const preference = data.notificationPreferences.find((item) => item.profileId === profile.id && item.channel === "google_chat" && item.eventType === eventType);
                    const enabled = preference?.enabled !== false;
                    return (
                      <label key={eventType} className="flex items-center justify-between gap-2 rounded-md bg-slate-50 px-2 py-2 text-[11px] font-semibold text-slate-600">
                        <span className="min-w-0 truncate">{notificationEventLabel(eventType)}</span>
                        <input
                          type="checkbox"
                          checked={enabled}
                          disabled={pending || profile.notificationsEnabled === false || !canEditNotificationEvents}
                          onChange={(event) => onUpdateNotificationPreference(profile.id, eventType, event.target.checked)}
                          className="h-4 w-4 shrink-0 rounded border-slate-300 text-blue-600 disabled:opacity-60"
                        />
                      </label>
                    );
                  })}
                </div>
              </div>
              <label className="grid gap-1 text-xs font-semibold text-slate-500">
                Fokus
                <textarea
                  value={profile.focus || ""}
                  disabled={pending || !canEditProfile}
                  onChange={(event) => onUpdateProfile(profile, { focus: event.target.value })}
                  className="min-h-16 resize-y rounded-md border border-slate-200 bg-white px-2 py-2 text-sm font-normal text-slate-800 disabled:opacity-60"
                />
              </label>
              <div className="grid gap-2">
                <div className="text-xs font-semibold text-slate-500">Post-it-Farbe</div>
                <div className="flex flex-wrap gap-2">
                  {profileColorOptions.map((color) => {
                    const active = profileColor(profile).toLowerCase() === color.value.toLowerCase();
                    return (
                      <button
                        key={color.value}
                        type="button"
                        disabled={pending || !canEditProfile}
                        onClick={() => onUpdateProfile(profile, { color: color.value })}
                        className={`grid h-8 w-8 place-items-center rounded-md border transition disabled:cursor-not-allowed disabled:opacity-60 ${active ? "border-slate-900 ring-2 ring-slate-200" : "border-slate-200 hover:border-slate-400"}`}
                        title={color.label}
                        aria-label={`${color.label} als Post-it-Farbe wählen`}
                      >
                        <span className="h-5 w-5 rounded-sm" style={{ backgroundColor: color.value }} />
                      </button>
                    );
                  })}
                </div>
              </div>
              <div className="grid gap-3 sm:grid-cols-3">
                <label className="grid gap-1 text-xs font-semibold text-slate-500">
                  Kapazität
                  <input
                    type="number"
                    min={0}
                    max={80}
                    value={profile.weeklyCapacity}
                    disabled={pending || !canEditProfile}
                    onChange={(event) => onUpdateProfile(profile, { weeklyCapacity: Number(event.target.value) })}
                    className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm font-normal text-slate-800 disabled:opacity-60"
                  />
                </label>
                <label className="grid gap-1 text-xs font-semibold text-slate-500">
                  Vertreter für
                  <CustomSelect
                    value={profile.deputyFor || ""}
                    disabled={pending || !isDeputy || !canEditProfile}
                    onChange={(value) => onUpdateProfile(profile, { deputyFor: value })}
                    className="h-9 text-sm"
                    options={[{ value: "", label: "Keine Vertretung" }, ...data.profiles.filter((item) => item.platformRole === "ceo" || item.id === profile.deputyFor).map((item) => ({ value: item.id, label: item.name }))]}
                  />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="grid gap-1 text-xs font-semibold text-slate-500">
                    Von
                    <CustomDatePicker value={profile.deputyActiveFrom || ""} disabled={pending || !isDeputy || !canEditProfile} onChange={(value) => onUpdateProfile(profile, { deputyActiveFrom: value })} className="h-9 text-sm" />
                  </label>
                  <label className="grid gap-1 text-xs font-semibold text-slate-500">
                    Bis
                    <CustomDatePicker value={profile.deputyActiveUntil || ""} disabled={pending || !isDeputy || !canEditProfile} onChange={(value) => onUpdateProfile(profile, { deputyActiveUntil: value })} className="h-9 text-sm" />
                  </label>
                </div>
              </div>
              <p className="text-xs leading-5 text-slate-500">
                Rollen, Stammdaten und der zentrale Benachrichtigungsschalter sind CEO-geschützt. Einzelne Google-Chat-Events kann das Profil selbst steuern.
              </p>
            </div>
          </article>
        );
      })}
      </div>
    </div>
  );
}

function SprintScoreTableOverview({
  data,
  pending,
  onOpen,
  onReview,
  onRequestReview,
  onChangeStatus,
  onLockSprint,
  onUpdateSprint,
  onUpdateCommitment,
  onUpdateMeetingAttendance,
  onAssignSprint,
  currentProfile,
  canManageSprint,
  sprintLockMessage,
}: {
  data: PlanningData;
  pending: boolean;
  onOpen: (task: Task) => void;
  onReview: (
    task: Task,
    reviewStatus: "accepted" | "partial" | "changes_requested",
    scorePoints: number,
    checklist?: { acceptanceCriteriaMet?: boolean; dodMet?: boolean; evidenceProvided?: boolean; communicationClear?: boolean; blockerHandled?: boolean },
    comment?: string,
  ) => void;
  onRequestReview: (task: Task) => void;
  onChangeStatus: (task: Task, status: TaskStatus) => void;
  onLockSprint: (sprintId: string) => void;
  onUpdateSprint: (sprint: Sprint, patch: Partial<Sprint>) => void;
  onUpdateCommitment: (commitment: SprintCommitment) => void;
  onUpdateMeetingAttendance: (meeting: Meeting, attendance: MeetingAttendance) => void;
  onAssignSprint: (task: Task, sprintId: string) => void;
  currentProfile: Profile | null;
  canManageSprint: boolean;
  sprintLockMessage: string;
}) {
  const currentSprint = findCurrentSprint(data.sprints);
  const [selectedSprintId, setSelectedSprintId] = useState(currentSprint?.id || "");
  const [selectedReviewTaskId, setSelectedReviewTaskId] = useState("");
  const [reviewComment, setReviewComment] = useState("");
  const [reviewChecklist, setReviewChecklist] = useState({
    acceptanceCriteriaMet: false,
    evidenceProvided: false,
    communicationClear: false,
    blockerHandled: false,
  });
  const reviewScore = reviewChecklistScore(reviewChecklist);
  useEffect(() => {
    if (!data.sprints.length) return;
    if (!selectedSprintId || !data.sprints.some((item) => item.id === selectedSprintId)) {
      const nextSprintId = findCurrentSprint(data.sprints)?.id || data.sprints[0]?.id || "";
      window.queueMicrotask(() => setSelectedSprintId(nextSprintId));
    }
  }, [data.sprints, selectedSprintId]);

  const sprint = data.sprints.find((item) => item.id === selectedSprintId) || currentSprint || data.sprints[0];
  const sprintTasks = sprint ? data.tasks.filter((task) => task.sprintId === sprint.id) : data.tasks;
  const otherTasks = sprint ? data.tasks.filter((task) => task.sprintId !== sprint.id) : [];
  const unassignedTasks = data.tasks.filter((task) => !task.sprintId);
  const scoreRows = data.profiles.map((profile) => {
    const row = founderScore(sprintTasks, profile);
    const profileTasks = sprintTasks.filter((task) => taskBelongsToProfile(task, profile));
    const commitment = data.sprintCommitments.find((item) => item.sprintId === sprint?.id && item.profileId === profile.id);
    return {
      ...row,
      commitment: commitment || {
        id: 0,
        sprintId: sprint?.id || "",
        profileId: profile.id,
        commitmentLevel: "Standard" as CommitmentLevel,
        weeklyHours: profile.weeklyCapacity,
        note: "",
      },
      hours: profileTasks.reduce((sum, task) => sum + task.hours, 0),
      blocked: profileTasks.filter((task) => normalizeStatus(task.status) === "Blockiert").length,
      active: profileTasks.filter((task) => normalizeStatus(task.status) === "In Arbeit").length,
      finalScore: profileTasks.filter((task) => task.scoreFinal).length,
    };
  });
  const reviewTasks = sprintTasks.filter((task) => task.reviewStatus !== "not_requested" || task.status === "Review");
  const selectedReviewTask = reviewTasks.find((task) => task.id === selectedReviewTaskId) || reviewTasks[0];
  const meeting = sprint ? data.meetings.find((item) => item.sprintId === sprint.id) : undefined;
  const finalScores = sprintTasks.filter((task) => task.scoreFinal).length;
  const openScores = sprintTasks.filter((task) => !task.scoreFinal).length;
  const sprintHasTasks = sprintTasks.length > 0;
  const sprintIsCurrent = currentSprint?.id === sprint.id;
  const sprintControlsDisabled = pending || !canManageSprint;
  const sprintStatusLabel: Record<Sprint["status"], string> = {
    planning: "Planung",
    active: "Aktiv",
    review: "Review",
    closed: "Abgeschlossen",
  };

  if (!sprint) {
    return (
      <section className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
        Noch kein Sprint angelegt. Nach der nächsten Migration erscheint hier die Sprint-Tabelle.
      </section>
    );
  }

  return (
    <div className="grid gap-4">
      <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="grid gap-3 border-b border-slate-100 p-4 xl:grid-cols-[minmax(220px,1.3fr)_repeat(4,minmax(150px,1fr))_auto] xl:items-end">
          <label className="grid gap-1 text-xs font-semibold text-slate-500">
            Sprint
            <CustomSelect
              value={sprint.id}
              onChange={setSelectedSprintId}
              className="h-9 text-sm"
              options={data.sprints.map((item) => ({
                value: item.id,
                label: item.name,
                current: currentSprint?.id === item.id,
                locked: data.tasks.some((task) => task.sprintId === item.id),
              }))}
            />
          </label>
          <div className="grid gap-1 text-xs font-semibold text-slate-500">
            Start
            <div className="flex h-9 items-center rounded-md border border-slate-200 bg-slate-50 px-2 text-sm font-semibold text-slate-900">{formatDate(sprint.startDate)}</div>
          </div>
          <div className="grid gap-1 text-xs font-semibold text-slate-500">
            Ende
            <div className="flex h-9 items-center rounded-md border border-slate-200 bg-slate-50 px-2 text-sm font-semibold text-slate-900">{formatDate(sprint.endDate)}</div>
          </div>
          <div className="grid gap-1 text-xs font-semibold text-slate-500">
            Review bis
            <div className="flex h-9 items-center rounded-md border border-slate-200 bg-slate-50 px-2 text-sm font-semibold text-slate-900">
              {sprint.reviewDueAt ? new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric", hour: "2-digit", minute: "2-digit" }).format(new Date(sprint.reviewDueAt)) : "ohne Datum"}
            </div>
          </div>
          <label className="grid gap-1 text-xs font-semibold text-slate-500">
            Status
            <CustomSelect
              value={sprint.status}
              disabled={sprintControlsDisabled || sprint.scoreLocked}
              onChange={(value) => onUpdateSprint(sprint, { status: value as Sprint["status"] })}
              className="h-9 text-sm"
              options={[
                { value: "planning", label: "Planung" },
                { value: "active", label: "Aktiv" },
                { value: "review", label: "Review" },
                { value: "closed", label: "Abgeschlossen" },
              ]}
            />
          </label>
          <button
            type="button"
            disabled={sprintControlsDisabled || sprint.scoreLocked}
            onClick={() => onLockSprint(sprint.id)}
            className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Sprint abschließen
          </button>
        </div>
        <div className="grid gap-3 px-4 py-3 text-sm text-slate-600 sm:grid-cols-2 xl:grid-cols-5">
          <div><span className="font-semibold text-slate-950">{sprintTasks.length}</span> Aufgaben im Sprint</div>
          <div><span className="font-semibold text-slate-950">{reviewTasks.length}</span> im Review</div>
          <div><span className="font-semibold text-slate-950">{finalScores}/{sprintTasks.length}</span> Scores final</div>
          <div><span className="font-semibold text-slate-950">{openScores}</span> Scores offen</div>
          <div><span className="font-semibold text-slate-950">{unassignedTasks.length}</span> ohne Sprint</div>
        </div>
        <div className="flex flex-wrap gap-2 border-t border-slate-100 px-4 py-3">
          {sprintIsCurrent && (
            <span
              className="inline-flex h-7 w-7 items-center justify-center rounded-full border border-emerald-200 bg-emerald-50 text-emerald-600"
              aria-label="Aktueller Sprint"
              title="Aktueller Sprint"
            >
              <span className="h-2.5 w-2.5 rounded-full bg-emerald-500 shadow-[0_0_0_4px_rgba(16,185,129,0.16)]" />
            </span>
          )}
          {sprintHasTasks && (
            <span
              className="inline-flex h-7 items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2 text-xs font-semibold text-slate-600"
              aria-label={`${sprintTasks.length} verknüpfte Aufgaben, Zeitraum geschützt`}
              title={`${sprintTasks.length} verknüpfte Aufgaben, Zeitraum geschützt`}
            >
              <Lock size={13} />
              {sprintTasks.length}
            </span>
          )}
        </div>
        {sprintLockMessage && (
          <div className="border-t border-blue-100 bg-blue-50 px-4 py-3 text-sm font-medium text-blue-800">
            {sprintLockMessage}
          </div>
        )}
      </section>

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
          <div>
            <h2 className="text-base font-semibold text-slate-950">Founder Scoreboard</h2>
            <p className="text-xs text-slate-500">{sprintStatusLabel[sprint.status]} · {formatDate(sprint.startDate)} bis {formatDate(sprint.endDate)}</p>
          </div>
          <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${sprint.scoreLocked ? "border-blue-200 bg-blue-50 text-blue-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}>
            {sprint.scoreLocked ? "Score gelockt" : "Score offen"}
          </span>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[980px] w-full border-separate border-spacing-0 text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="border-b border-slate-200 px-4 py-3 font-semibold">Founder</th>
                <th className="border-b border-slate-200 px-3 py-3 font-semibold">Aufgaben</th>
                <th className="border-b border-slate-200 px-3 py-3 font-semibold">Wochenstunden</th>
                <th className="border-b border-slate-200 px-3 py-3 font-semibold">Commitment</th>
                <th className="border-b border-slate-200 px-3 py-3 font-semibold">Workflow</th>
                <th className="border-b border-slate-200 px-3 py-3 font-semibold">Review</th>
                <th className="border-b border-slate-200 px-3 py-3 font-semibold">Final</th>
                <th className="border-b border-slate-200 px-3 py-3 font-semibold">Punkte</th>
                <th className="border-b border-slate-200 px-3 py-3 font-semibold">Offen</th>
                <th className="border-b border-slate-200 px-3 py-3 font-semibold">Aufwand</th>
              </tr>
            </thead>
            <tbody>
              {scoreRows.map((row) => (
                <tr key={row.profile.id} className="hover:bg-slate-50">
                  <td className="border-b border-slate-100 px-4 py-3">
                    <div className="font-semibold text-slate-950">{row.profile.name}</div>
                    <div className="text-xs text-slate-500">{roleLabel(row.profile)}</div>
                  </td>
                  <td className="border-b border-slate-100 px-3 py-3">
                    <CustomSelect value={row.commitment.commitmentLevel} disabled={pending || sprint.scoreLocked} onChange={(value) => onUpdateCommitment({ ...row.commitment, commitmentLevel: value as CommitmentLevel })} className="h-8 w-28 text-xs" options={["Lite", "Standard", "Heavy", "Away"].map((level) => ({ value: level, label: level }))} />
                  </td>
                  <td className="border-b border-slate-100 px-3 py-3">
                    <input
                      type="number"
                      min={0}
                      max={80}
                      value={row.commitment.weeklyHours}
                      disabled={pending || sprint.scoreLocked}
                      onChange={(event) => onUpdateCommitment({ ...row.commitment, weeklyHours: Number(event.target.value) })}
                      className="h-8 w-20 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 disabled:bg-slate-50 disabled:opacity-60"
                    />
                  </td>
                  <td className="border-b border-slate-100 px-3 py-3 font-semibold text-slate-900">{row.committed}</td>
                  <td className="border-b border-slate-100 px-3 py-3 text-slate-700">{row.active} aktiv · {row.blocked} blockiert</td>
                  <td className="border-b border-slate-100 px-3 py-3 text-slate-700">{row.reviewReady}</td>
                  <td className="border-b border-slate-100 px-3 py-3 text-slate-700">{row.finalScore}</td>
                  <td className="border-b border-slate-100 px-3 py-3 text-lg font-semibold text-slate-950">{row.finalPoints}</td>
                  <td className="border-b border-slate-100 px-3 py-3 text-slate-700">{row.openScore}</td>
                  <td className="border-b border-slate-100 px-3 py-3 text-slate-700">{row.hours}h</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </section>

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
          <div>
            <h2 className="text-base font-semibold text-slate-950">Biweekly Meeting & Updates</h2>
            <p className="text-xs text-slate-500">
              {meeting ? `${meeting.title} · ${new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(new Date(meeting.meetingAt))}` : "Noch kein Meeting für diesen Sprint angelegt."}
            </p>
          </div>
          <span className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600">max. 4 Punkte</span>
        </div>
        {meeting ? (
          <div className="overflow-x-auto">
            <table className="min-w-[1100px] w-full border-separate border-spacing-0 text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="border-b border-slate-200 px-4 py-3 font-semibold">Founder</th>
                  <th className="border-b border-slate-200 px-3 py-3 font-semibold">Status</th>
                  <th className="border-b border-slate-200 px-3 py-3 font-semibold">Triftiger Grund</th>
                  <th className="border-b border-slate-200 px-3 py-3 font-semibold">Update</th>
                  <th className="border-b border-slate-200 px-3 py-3 font-semibold">Akzeptiert</th>
                  <th className="border-b border-slate-200 px-3 py-3 font-semibold">Punkte</th>
                </tr>
              </thead>
              <tbody>
                {data.profiles.map((profile) => {
                  const existing = data.meetingAttendance.find((item) => item.meetingId === meeting.id && item.profileId === profile.id);
                  const attendance: MeetingAttendance = existing || {
                    id: 0,
                    meetingId: meeting.id,
                    profileId: profile.id,
                    status: "pending",
                    absenceReason: "",
                    reasonAccepted: false,
                    writtenUpdate: "",
                    points: 0,
                    createdAt: "",
                    updatedAt: "",
                  };
                  const patchAttendance = (patch: Partial<MeetingAttendance>) => onUpdateMeetingAttendance(meeting, { ...attendance, ...patch, updatedAt: new Date().toISOString() });
                  const canEditAttendanceRow = canManageSprint || currentProfile?.id === profile.id;
                  const canScoreAttendance = canManageSprint;
                  const statusOptions = canManageSprint
                    ? [
                      { value: "pending", label: "Offen" },
                      { value: "present", label: "Anwesend" },
                      { value: "excused", label: "Entschuldigt" },
                      { value: "late_excused", label: "Spät entschuldigt" },
                      { value: "unexcused", label: "Nicht akzeptiert" },
                      { value: "no_show", label: "No-Show" },
                    ]
                    : [
                      { value: "pending", label: "Offen" },
                      { value: "excused", label: "Entschuldigt" },
                      { value: "late_excused", label: "Spät entschuldigt" },
                    ];
                  return (
                    <tr key={profile.id} className="hover:bg-slate-50">
                      <td className="border-b border-slate-100 px-4 py-3">
                        <div className="font-semibold text-slate-950">{profile.name}</div>
                        <div className="text-xs text-slate-500">
                          {roleLabel(profile)}
                          {!canManageSprint && currentProfile?.id === profile.id ? " · eigene Rückmeldung" : ""}
                        </div>
                      </td>
                      <td className="border-b border-slate-100 px-3 py-3">
                        <CustomSelect
                          value={attendance.status}
                          disabled={pending || !canEditAttendanceRow}
                          onChange={(value) => patchAttendance({ status: value as MeetingAttendance["status"], reasonAccepted: false, points: canManageSprint ? attendance.points : 0 })}
                          className="h-8 w-36 text-xs"
                          options={statusOptions}
                        />
                      </td>
                      <td className="border-b border-slate-100 px-3 py-3">
                        <input
                          value={attendance.absenceReason}
                          disabled={pending || !canEditAttendanceRow}
                          onChange={(event) => patchAttendance({ absenceReason: event.target.value })}
                          className="h-8 w-64 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 disabled:bg-slate-50"
                          placeholder="z.B. Krankheit, Familie, nicht verschiebbar"
                        />
                      </td>
                      <td className="border-b border-slate-100 px-3 py-3">
                        <textarea
                          value={attendance.writtenUpdate}
                          disabled={pending || !canEditAttendanceRow}
                          onChange={(event) => patchAttendance({ writtenUpdate: event.target.value })}
                          className="min-h-12 w-80 resize-y rounded-md border border-slate-200 bg-white px-2 py-1 text-xs leading-5 text-slate-700 disabled:bg-slate-50"
                          placeholder="Kurzupdate, Blocker, nächster Schritt"
                        />
                      </td>
                      <td className="border-b border-slate-100 px-3 py-3">
                        <input
                          type="checkbox"
                          checked={attendance.reasonAccepted}
                          disabled={pending || !canScoreAttendance}
                          onChange={(event) => patchAttendance({ reasonAccepted: event.target.checked })}
                          aria-label="Grund akzeptiert"
                        />
                      </td>
                      <td className="border-b border-slate-100 px-3 py-3">
                        <CustomSelect value={attendance.points} disabled={pending || !canScoreAttendance} onChange={(value) => patchAttendance({ points: Number(value) })} className="h-8 w-20 text-xs" options={[0, 1, 2, 3, 4].map((point) => ({ value: String(point), label: String(point) }))} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="px-4 py-8 text-center text-sm text-slate-500">Nach Migration 0007 wird pro Sprint automatisch ein Biweekly-Meeting angelegt.</div>
        )}
      </section>

      <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-4 py-3">
          <h2 className="text-base font-semibold text-slate-950">Sprint-Aufgaben</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[1180px] w-full border-separate border-spacing-0 text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="border-b border-slate-200 px-4 py-3 font-semibold">Aufgabe</th>
                <th className="border-b border-slate-200 px-3 py-3 font-semibold">Owner</th>
                <th className="border-b border-slate-200 px-3 py-3 font-semibold">Status</th>
                <th className="border-b border-slate-200 px-3 py-3 font-semibold">Review-Status</th>
                <th className="border-b border-slate-200 px-3 py-3 font-semibold">CEO-Score</th>
                <th className="border-b border-slate-200 px-3 py-3 font-semibold">Sprint</th>
                <th className="border-b border-slate-200 px-3 py-3 font-semibold">Zeitraum</th>
                <th className="border-b border-slate-200 px-3 py-3 font-semibold">Nächster Schritt</th>
              </tr>
            </thead>
            <tbody>
              {sprintTasks.map((task) => (
                <tr key={task.id} className="hover:bg-slate-50">
                  <td className="max-w-[360px] border-b border-slate-100 px-4 py-3">
                    <button type="button" onClick={() => onOpen(task)} className="flex max-w-full items-start gap-1.5 truncate text-left font-semibold text-slate-950 hover:text-blue-700">
                      {!hasGitHubIssue(task) && <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber-500" aria-hidden="true" />}
                      <span className="truncate">{task.title}</span>
                    </button>
                    <div className="mt-1 truncate text-xs text-slate-500">{task.workstream} · {task.priority} · {task.hours}h</div>
                    {(!hasGitHubIssue(task) || task.carriedFromSprintId || task.sprintOutcome) && (
                      <div className="mt-1 flex flex-wrap gap-1">
                        {!hasGitHubIssue(task) && <GitHubMissingBadge />}
                        {task.carriedFromSprintId && <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">Carry-over</span>}
                        {task.sprintOutcome && <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-600">{task.sprintOutcome}</span>}
                      </div>
                    )}
                  </td>
                  <td className="border-b border-slate-100 px-3 py-3 text-slate-700">{task.owner}</td>
                  <td className="border-b border-slate-100 px-3 py-3">
                    <CustomSelect value={normalizeStatus(task.status)} disabled={pending} onChange={(value) => onChangeStatus(task, value as TaskStatus)} className={`h-8 w-32 text-xs font-semibold ${statusTone(normalizeStatus(task.status))}`} options={taskStatuses.map((status) => ({ value: status, label: status }))} />
                  </td>
                  <td className="border-b border-slate-100 px-3 py-3 text-slate-700">{reviewLabel(task.reviewStatus)}</td>
                  <td className="border-b border-slate-100 px-3 py-3 text-slate-700">
                    {task.scorePoints} {task.scoreFinal ? "final" : "offen"}
                  </td>
                  <td className="border-b border-slate-100 px-3 py-3">
                    <CustomSelect value={task.sprintId} disabled={pending || sprint.scoreLocked} onChange={(value) => onAssignSprint(task, value)} className="h-8 w-44 text-xs" options={data.sprints.map((item) => ({ value: item.id, label: item.name }))} />
                  </td>
                  <td className="border-b border-slate-100 px-3 py-3 text-slate-700">{dateRange(task)}</td>
                  <td className="border-b border-slate-100 px-3 py-3">
                    <div className="flex flex-wrap gap-1.5">
                      {task.reviewStatus === "not_requested" || normalizeStatus(task.status) === "Nacharbeit" ? (
                        <button type="button" disabled={pending || sprint.scoreLocked} onClick={() => onRequestReview(task)} className="h-8 rounded-md border border-blue-200 bg-blue-50 px-2 text-xs font-semibold text-blue-700 disabled:cursor-not-allowed disabled:opacity-50">Review anfragen</button>
                      ) : null}
                      {task.reviewStatus !== "not_requested" || normalizeStatus(task.status) === "Review" ? (
                        <button
                          type="button"
                          disabled={pending || sprint.scoreLocked || task.scoreFinal}
                          onClick={() => {
                            setSelectedReviewTaskId(task.id);
                            setReviewComment("");
                            setReviewChecklist({ acceptanceCriteriaMet: false, evidenceProvided: false, communicationClear: false, blockerHandled: false });
                          }}
                          className="h-8 rounded-md border border-blue-200 bg-blue-50 px-2 text-xs font-semibold text-blue-700 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Review-Blatt
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
              {!sprintTasks.length && (
                <tr>
                  <td colSpan={8} className="px-4 py-8 text-center text-sm text-slate-500">
                    Noch keine Aufgaben in diesem Sprint.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </section>

      {selectedReviewTask && (
        <section className="rounded-lg border border-blue-200 bg-white shadow-sm">
          <div className="border-b border-blue-100 bg-blue-50 px-4 py-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-blue-700">CEO Review-Blatt</div>
            <h2 className="mt-1 text-base font-semibold text-slate-950">{selectedReviewTask.title}</h2>
            <p className="mt-1 text-xs text-slate-600">{selectedReviewTask.owner} · {selectedReviewTask.priority} · {selectedReviewTask.hours}h · {reviewLabel(selectedReviewTask.reviewStatus)}</p>
            <p className="mt-2 text-xs leading-5 text-blue-800">CEO-Punkte entstehen nur hier im Review-Blatt. Das Founder-Arbeitsblatt bleibt Arbeitsstand ohne Score.</p>
          </div>
          <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="grid gap-3">
              <div className="rounded-md border border-slate-100 bg-slate-50 p-3">
                <div className="text-xs font-semibold text-slate-500">Problem Statement</div>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-700">{selectedReviewTask.problemStatement || selectedReviewTask.description || "Kein Problem Statement hinterlegt."}</p>
              </div>
              <div className="rounded-md border border-slate-100 bg-slate-50 p-3">
                <div className="text-xs font-semibold text-slate-500">Intended Outcome</div>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-700">{selectedReviewTask.intendedOutcome || "Kein Intended Outcome hinterlegt."}</p>
              </div>
              <div className="rounded-md border border-slate-100 bg-slate-50 p-3">
                <div className="text-xs font-semibold text-slate-500">Acceptance Criteria</div>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-700">{selectedReviewTask.acceptanceCriteria || selectedReviewTask.definitionOfDone || "Keine Acceptance Criteria hinterlegt."}</p>
              </div>
              <div className="rounded-md border border-slate-100 bg-slate-50 p-3">
                <div className="text-xs font-semibold text-slate-500">Definition of Done Snapshot</div>
                <p className="mt-1 text-sm leading-6 text-slate-700">{selectedReviewTask.definitionOfDone || "Keine Definition of Done hinterlegt."}</p>
              </div>
              <div className="rounded-md border border-slate-100 bg-slate-50 p-3">
                <div className="text-xs font-semibold text-slate-500">Evidence Required / Abhängigkeiten</div>
                <p className="mt-1 text-sm leading-6 text-slate-700">{selectedReviewTask.evidenceRequired || "Kein erwarteter Nachweis hinterlegt."}</p>
                <p className="mt-1 text-sm leading-6 text-slate-700">{selectedReviewTask.evidenceLink || selectedReviewTask.issueUrl || "Noch kein Evidence-Link hinterlegt."}</p>
                <p className="mt-1 text-sm leading-6 text-slate-700">{selectedReviewTask.dependsOn || "Keine harte Abhängigkeit erfasst."}</p>
              </div>
              <textarea
                value={reviewComment}
                onChange={(event) => setReviewComment(event.target.value)}
                className="min-h-24 w-full resize-y rounded-md border border-slate-200 p-3 text-sm leading-6 outline-none focus:border-blue-400"
                placeholder="Review-Kommentar oder Nacharbeit beschreiben"
              />
            </div>
            <div className="grid content-start gap-3">
              <div className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
                Punkteformel: vier CEO-Kriterien ergeben je 2,5 Punkte, gerundet auf 0 bis 10.
              </div>
              {reviewChecklistItems.map(([key, label, pointsLabel]) => (
                <label key={key} className="flex items-center justify-between gap-3 rounded-md border border-slate-100 px-3 py-2 text-sm text-slate-700">
                  <span>
                    <span className="block">{label}</span>
                    <span className="text-xs text-slate-500">{pointsLabel}</span>
                  </span>
                  <input
                    type="checkbox"
                    checked={Boolean(reviewChecklist[key as keyof typeof reviewChecklist])}
                    onChange={(event) => setReviewChecklist((current) => ({ ...current, [key]: event.target.checked }))}
                  />
                </label>
              ))}
              <label className="grid gap-1 text-xs font-semibold text-slate-500">
                Automatische CEO-Punkte
                <input
                  type="number"
                  min={0}
                  max={10}
                  value={reviewScore}
                  readOnly
                  className="h-9 rounded-md border border-slate-200 bg-slate-50 px-2 text-sm font-semibold text-slate-800"
                />
                <span className="text-[11px] font-normal text-slate-500">Berechnet aus den abgehakten Review-Kriterien.</span>
              </label>
              <p className="text-[11px] leading-5 text-slate-500">
                Nacharbeit vergibt 0 finale Punkte und verschiebt die Aufgabe zurück in den Status Nacharbeit.
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={pending || sprint.scoreLocked || selectedReviewTask.scoreFinal} onClick={() => onReview(selectedReviewTask, "accepted", reviewScore, reviewChecklist, reviewComment)} className="h-9 rounded-md border border-emerald-200 bg-emerald-50 px-3 text-sm font-semibold text-emerald-700 disabled:cursor-not-allowed disabled:opacity-50">Akzeptieren</button>
                <button type="button" disabled={pending || sprint.scoreLocked || selectedReviewTask.scoreFinal} onClick={() => onReview(selectedReviewTask, "partial", reviewScore, reviewChecklist, reviewComment)} className="h-9 rounded-md border border-amber-200 bg-amber-50 px-3 text-sm font-semibold text-amber-700 disabled:cursor-not-allowed disabled:opacity-50">Teilweise</button>
                <button type="button" disabled={pending || sprint.scoreLocked || selectedReviewTask.scoreFinal} onClick={() => onReview(selectedReviewTask, "changes_requested", 0, reviewChecklist, reviewComment)} className="h-9 rounded-md border border-orange-200 bg-orange-50 px-3 text-sm font-semibold text-orange-700 disabled:cursor-not-allowed disabled:opacity-50">Nacharbeit</button>
              </div>
            </div>
          </div>
        </section>
      )}

      {otherTasks.length > 0 && (
        <section className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
          <div className="border-b border-slate-100 px-4 py-3">
            <h2 className="text-base font-semibold text-slate-950">Backlog und andere Sprints</h2>
            <p className="text-xs text-slate-500">Nicht im ausgewählten Sprint.</p>
          </div>
          <div className="overflow-x-auto">
            <table className="min-w-[840px] w-full border-separate border-spacing-0 text-left text-sm">
              <thead className="bg-slate-50 text-xs uppercase text-slate-500">
                <tr>
                  <th className="border-b border-slate-200 px-4 py-3 font-semibold">Aufgabe</th>
                  <th className="border-b border-slate-200 px-3 py-3 font-semibold">Owner</th>
                  <th className="border-b border-slate-200 px-3 py-3 font-semibold">Aktueller Sprint</th>
                  <th className="border-b border-slate-200 px-3 py-3 font-semibold">Zuweisung</th>
                </tr>
              </thead>
              <tbody>
                {otherTasks.map((task) => {
                  const currentSprint = data.sprints.find((item) => item.id === task.sprintId);
                  return (
                    <tr key={task.id} className="hover:bg-slate-50">
                      <td className="max-w-[420px] border-b border-slate-100 px-4 py-3">
                        <button type="button" onClick={() => onOpen(task)} className="block truncate text-left font-semibold text-slate-950 hover:text-blue-700">
                          {task.title}
                        </button>
                        <div className="mt-1 truncate text-xs text-slate-500">{task.workstream} · {task.priority} · {task.hours}h</div>
                      </td>
                      <td className="border-b border-slate-100 px-3 py-3 text-slate-700">{task.owner}</td>
                      <td className="border-b border-slate-100 px-3 py-3 text-slate-700">{currentSprint?.name || "ohne Sprint"}</td>
                      <td className="border-b border-slate-100 px-3 py-3">
                        <CustomSelect value={task.sprintId} disabled={pending} onChange={(value) => onAssignSprint(task, value)} className="h-8 w-56 text-xs" options={data.sprints.map((item) => ({ value: item.id, label: item.name }))} />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>
        </section>
      )}
    </div>
  );
}

function SprintScoreOverview({
  data,
  pending,
  onOpen,
  onReview,
  onLockSprint,
}: {
  data: PlanningData;
  pending: boolean;
  onOpen: (task: Task) => void;
  onReview: (
    task: Task,
    reviewStatus: "accepted" | "partial" | "changes_requested",
    scorePoints: number,
    checklist?: { acceptanceCriteriaMet?: boolean; dodMet?: boolean; evidenceProvided?: boolean; communicationClear?: boolean; blockerHandled?: boolean },
    comment?: string,
  ) => void;
  onLockSprint: (sprintId: string) => void;
}) {
  const [selectedReviewTaskId, setSelectedReviewTaskId] = useState("");
  const [reviewComment, setReviewComment] = useState("");
  const [reviewChecklist, setReviewChecklist] = useState({
    acceptanceCriteriaMet: false,
    evidenceProvided: false,
    communicationClear: false,
    blockerHandled: false,
  });
  const reviewScore = reviewChecklistScore(reviewChecklist);
  const sprint = data.sprints[0];
  const sprintTasks = sprint ? data.tasks.filter((task) => task.sprintId === sprint.id) : data.tasks;
  const scoreRows = data.profiles.map((profile) => founderScore(sprintTasks, profile));
  const reviewTasks = sprintTasks.filter((task) => task.reviewStatus !== "not_requested" || task.status === "Review");
  const selectedReviewTask = reviewTasks.find((task) => task.id === selectedReviewTaskId) || reviewTasks[0];
  const openScores = sprintTasks.filter((task) => !task.scoreFinal).length;
  const finalScores = sprintTasks.filter((task) => task.scoreFinal).length;

  return (
    <div className="grid gap-4">
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Aktiver Sprint</div>
            <h2 className="mt-1 text-lg font-semibold text-slate-950">{sprint?.name || "Sprint 1"}</h2>
            <p className="mt-1 text-sm text-slate-500">{sprint ? `${formatDate(sprint.startDate)} - ${formatDate(sprint.endDate)}` : "Noch kein Sprint terminiert"}</p>
          </div>
          <div className="flex flex-wrap items-center gap-2">
            <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
              {sprint?.scoreLocked ? "Score gelockt" : "Score offen"}
            </span>
            <span className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600">
              {finalScores}/{sprintTasks.length} Scores final
            </span>
            {sprint && (
              <button
                type="button"
                disabled={pending || sprint.scoreLocked}
                onClick={() => onLockSprint(sprint.id)}
                className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Sprint abschließen
              </button>
            )}
          </div>
        </div>
        {openScores > 0 && !sprint?.scoreLocked && (
          <p className="mt-3 text-xs leading-5 text-amber-700">
            Beim Sprintabschluss werden noch offene Scores mit 0 Punkten finalisiert.
          </p>
        )}
      </section>
      <section className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
        {scoreRows.map((row) => (
          <article key={row.profile.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="font-semibold text-slate-950">{row.profile.name}</h3>
                <p className="text-xs text-slate-500">{roleLabel(row.profile)}</p>
              </div>
              <div className="text-right">
                <div className="text-2xl font-semibold text-slate-950">{row.finalPoints}</div>
                <div className="text-xs text-slate-500">Punkte final</div>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-sm">
              <div className="rounded-md bg-slate-50 p-2"><div className="text-xs text-slate-500">Committed</div><div className="font-semibold">{row.committed}</div></div>
              <div className="rounded-md bg-slate-50 p-2"><div className="text-xs text-slate-500">Review</div><div className="font-semibold">{row.reviewReady}</div></div>
              <div className="rounded-md bg-slate-50 p-2"><div className="text-xs text-slate-500">Offen</div><div className="font-semibold">{row.openScore}</div></div>
            </div>
          </article>
        ))}
      </section>
      <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-4 py-3">
          <h2 className="text-base font-semibold text-slate-950">Review Queue</h2>
        </div>
        <div className="divide-y divide-slate-100">
          {reviewTasks.length ? reviewTasks.map((task) => (
            <div key={task.id} className="grid gap-3 px-4 py-3 hover:bg-slate-50 xl:grid-cols-[1fr_auto] xl:items-center">
              <button type="button" onClick={() => onOpen(task)} className="min-w-0 text-left">
                <span className="block truncate text-sm font-semibold text-slate-900">{task.title}</span>
                <span className="text-xs text-slate-500">{task.owner} · {reviewLabel(task.reviewStatus)} · {task.scoreFinal ? "final" : "offen"}</span>
              </button>
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-full border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-600">{task.scorePoints} Punkte</span>
                <button
                  type="button"
                  onClick={() => {
                    setSelectedReviewTaskId(task.id);
                    setReviewComment("");
                    setReviewChecklist({ acceptanceCriteriaMet: false, evidenceProvided: false, communicationClear: false, blockerHandled: false });
                  }}
                  className="h-8 rounded-md border border-blue-200 bg-blue-50 px-2 text-xs font-semibold text-blue-700"
                >
                  Review-Blatt
                </button>
              </div>
            </div>
          )) : <div className="px-4 py-8 text-sm text-slate-500">Noch keine Aufgaben im Review.</div>}
        </div>
      </section>
      {selectedReviewTask && (
        <section className="rounded-lg border border-blue-200 bg-white shadow-sm">
          <div className="border-b border-blue-100 bg-blue-50 px-4 py-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-blue-700">CEO Review-Blatt</div>
            <h2 className="mt-1 text-base font-semibold text-slate-950">{selectedReviewTask.title}</h2>
            <p className="mt-1 text-xs text-slate-600">{selectedReviewTask.owner} · {selectedReviewTask.priority} · {selectedReviewTask.hours}h · {reviewLabel(selectedReviewTask.reviewStatus)}</p>
            <p className="mt-2 text-xs leading-5 text-blue-800">CEO-Punkte entstehen nur hier im Review-Blatt. Das Founder-Arbeitsblatt bleibt Arbeitsstand ohne Score.</p>
          </div>
          <div className="grid gap-4 p-4 lg:grid-cols-[minmax(0,1fr)_320px]">
            <div className="grid gap-3">
              <div className="rounded-md border border-slate-100 bg-slate-50 p-3">
                <div className="text-xs font-semibold text-slate-500">Problem Statement</div>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-700">{selectedReviewTask.problemStatement || selectedReviewTask.description || "Kein Problem Statement hinterlegt."}</p>
              </div>
              <div className="rounded-md border border-slate-100 bg-slate-50 p-3">
                <div className="text-xs font-semibold text-slate-500">Intended Outcome</div>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-700">{selectedReviewTask.intendedOutcome || "Kein Intended Outcome hinterlegt."}</p>
              </div>
              <div className="rounded-md border border-slate-100 bg-slate-50 p-3">
                <div className="text-xs font-semibold text-slate-500">Acceptance Criteria</div>
                <p className="mt-1 whitespace-pre-wrap text-sm leading-6 text-slate-700">{selectedReviewTask.acceptanceCriteria || selectedReviewTask.definitionOfDone || "Keine Acceptance Criteria hinterlegt."}</p>
              </div>
              <div className="rounded-md border border-slate-100 bg-slate-50 p-3">
                <div className="text-xs font-semibold text-slate-500">Definition of Done Snapshot</div>
                <p className="mt-1 text-sm leading-6 text-slate-700">{selectedReviewTask.definitionOfDone || "Keine Definition of Done hinterlegt."}</p>
              </div>
              <div className="rounded-md border border-slate-100 bg-slate-50 p-3">
                <div className="text-xs font-semibold text-slate-500">Evidence Required / Abhängigkeiten</div>
                <p className="mt-1 text-sm leading-6 text-slate-700">{selectedReviewTask.evidenceRequired || "Kein erwarteter Nachweis hinterlegt."}</p>
                <p className="mt-1 text-sm leading-6 text-slate-700">{selectedReviewTask.evidenceLink || selectedReviewTask.issueUrl || "Noch kein Evidence-Link hinterlegt."}</p>
                <p className="mt-1 text-sm leading-6 text-slate-700">{selectedReviewTask.dependsOn || "Keine harte Abhängigkeit erfasst."}</p>
              </div>
              <textarea
                value={reviewComment}
                onChange={(event) => setReviewComment(event.target.value)}
                className="min-h-24 w-full resize-y rounded-md border border-slate-200 p-3 text-sm leading-6 outline-none focus:border-blue-400"
                placeholder="Review-Kommentar oder Nacharbeit beschreiben"
              />
            </div>
            <div className="grid content-start gap-3">
              <div className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
                Punkteformel: vier CEO-Kriterien ergeben je 2,5 Punkte, gerundet auf 0 bis 10.
              </div>
              {reviewChecklistItems.map(([key, label, pointsLabel]) => (
                <label key={key} className="flex items-center justify-between gap-3 rounded-md border border-slate-100 px-3 py-2 text-sm text-slate-700">
                  <span>
                    <span className="block">{label}</span>
                    <span className="text-xs text-slate-500">{pointsLabel}</span>
                  </span>
                  <input
                    type="checkbox"
                    checked={Boolean(reviewChecklist[key as keyof typeof reviewChecklist])}
                    onChange={(event) => setReviewChecklist((current) => ({ ...current, [key]: event.target.checked }))}
                  />
                </label>
              ))}
              <label className="grid gap-1 text-xs font-semibold text-slate-500">
                Automatische CEO-Punkte
                <input
                  type="number"
                  min={0}
                  max={10}
                  value={reviewScore}
                  readOnly
                  className="h-9 rounded-md border border-slate-200 bg-slate-50 px-2 text-sm font-semibold text-slate-800"
                />
                <span className="text-[11px] font-normal text-slate-500">Berechnet aus den abgehakten Review-Kriterien.</span>
              </label>
              <p className="text-[11px] leading-5 text-slate-500">
                Nacharbeit vergibt 0 finale Punkte und verschiebt die Aufgabe zurück in den Status Nacharbeit.
              </p>
              <div className="flex flex-wrap gap-2">
                <button type="button" disabled={pending || sprint?.scoreLocked || selectedReviewTask.scoreFinal} onClick={() => onReview(selectedReviewTask, "accepted", reviewScore, reviewChecklist, reviewComment)} className="h-9 rounded-md border border-emerald-200 bg-emerald-50 px-3 text-sm font-semibold text-emerald-700 disabled:cursor-not-allowed disabled:opacity-50">Akzeptieren</button>
                <button type="button" disabled={pending || sprint?.scoreLocked || selectedReviewTask.scoreFinal} onClick={() => onReview(selectedReviewTask, "partial", reviewScore, reviewChecklist, reviewComment)} className="h-9 rounded-md border border-amber-200 bg-amber-50 px-3 text-sm font-semibold text-amber-700 disabled:cursor-not-allowed disabled:opacity-50">Teilweise</button>
                <button type="button" disabled={pending || sprint?.scoreLocked || selectedReviewTask.scoreFinal} onClick={() => onReview(selectedReviewTask, "changes_requested", 0, reviewChecklist, reviewComment)} className="h-9 rounded-md border border-orange-200 bg-orange-50 px-3 text-sm font-semibold text-orange-700 disabled:cursor-not-allowed disabled:opacity-50">Nacharbeit</button>
              </div>
            </div>
          </div>
        </section>
      )}
    </div>
  );
}

function SprintScoreOverviewLegacy({ data, onOpen }: { data: PlanningData; onOpen: (task: Task) => void }) {
  const sprint = data.sprints[0];
  const scoreRows = data.profiles.map((profile) => founderScore(data.tasks, profile));
  const reviewTasks = data.tasks.filter((task) => task.reviewStatus !== "not_requested" || task.status === "Review");

  return (
    <div className="grid gap-4">
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Aktiver Sprint</div>
            <h2 className="mt-1 text-lg font-semibold text-slate-950">{sprint?.name || "Sprint 1"}</h2>
            <p className="mt-1 text-sm text-slate-500">{sprint ? `${formatDate(sprint.startDate)} - ${formatDate(sprint.endDate)}` : "Noch kein Sprint terminiert"}</p>
          </div>
          <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-xs font-semibold text-blue-700">
            {sprint?.scoreLocked ? "Score gelockt" : "Score offen"}
          </span>
        </div>
      </section>
      <section className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
        {scoreRows.map((row) => (
          <article key={row.profile.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h3 className="font-semibold text-slate-950">{row.profile.name}</h3>
                <p className="text-xs text-slate-500">{roleLabel(row.profile)}</p>
              </div>
              <div className="text-right">
                <div className="text-2xl font-semibold text-slate-950">{row.finalPoints}</div>
                <div className="text-xs text-slate-500">Punkte final</div>
              </div>
            </div>
            <div className="mt-4 grid grid-cols-3 gap-2 text-sm">
              <div className="rounded-md bg-slate-50 p-2"><div className="text-xs text-slate-500">Committed</div><div className="font-semibold">{row.committed}</div></div>
              <div className="rounded-md bg-slate-50 p-2"><div className="text-xs text-slate-500">Review</div><div className="font-semibold">{row.reviewReady}</div></div>
              <div className="rounded-md bg-slate-50 p-2"><div className="text-xs text-slate-500">Offen</div><div className="font-semibold">{row.openScore}</div></div>
            </div>
          </article>
        ))}
      </section>
      <section className="rounded-lg border border-slate-200 bg-white shadow-sm">
        <div className="border-b border-slate-100 px-4 py-3">
          <h2 className="text-base font-semibold text-slate-950">Review Queue</h2>
        </div>
        <div className="divide-y divide-slate-100">
          {reviewTasks.length ? reviewTasks.map((task) => (
            <button key={task.id} type="button" onClick={() => onOpen(task)} className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left hover:bg-slate-50">
              <span className="min-w-0">
                <span className="block truncate text-sm font-semibold text-slate-900">{task.title}</span>
                <span className="text-xs text-slate-500">{task.owner} · {reviewLabel(task.reviewStatus)}</span>
              </span>
              <span className="rounded-full border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-600">{task.scorePoints} Punkte</span>
            </button>
          )) : <div className="px-4 py-8 text-sm text-slate-500">Noch keine Aufgaben im Review.</div>}
        </div>
      </section>
    </div>
  );
}

function auditActionLabel(action: string) {
  const labels: Record<string, string> = {
    "decision.create": "Decision erstellt",
    "decision.update": "Decision geändert",
    "decision.confirm": "Bestätigung",
    confirm: "Bestätigung",
    confirm_and_lock: "Bestätigt und gelockt",
    "decision.objection": "Einwand gespeichert",
  };
  return labels[action] || action;
}

function auditFieldLabel(field: string) {
  const labels: Record<string, string> = {
    title: "Titel",
    context: "Kontext",
    decision: "Entscheidung",
    status: "Status",
    required_profile_ids: "Bestätigung erforderlich von",
    requiredProfileIds: "Bestätigung erforderlich von",
  };
  return labels[field] || field;
}

function formatAuditValue(field: string, value: unknown, profiles: Profile[]) {
  if (value === null || value === undefined || value === "") return "leer";
  if ((field === "required_profile_ids" || field === "requiredProfileIds") && Array.isArray(value)) {
    return value.map((id) => profiles.find((profile) => profile.id === id)?.name || String(id)).join(", ") || "leer";
  }
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(String).join(", ");
  return JSON.stringify(value);
}

function auditChanges(entry: PlanningData["audit"][number], profiles: Profile[]) {
  const before = entry.beforeData || {};
  const after = entry.afterData || {};
  const ignored = new Set(["id", "created_at", "updated_at", "created_by", "locked_at"]);
  return Array.from(new Set([...Object.keys(before), ...Object.keys(after)]))
    .filter((field) => !ignored.has(field))
    .filter((field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]))
    .map((field) => ({
      field,
      label: auditFieldLabel(field),
      before: formatAuditValue(field, before[field], profiles),
      after: formatAuditValue(field, after[field], profiles),
    }));
}

function DecisionLogOverview({
  data,
  currentProfileId,
  pending,
  onCreate,
  onConfirm,
  onEdit,
  onObject,
  onRemoveDecisionTaskLink,
  onCreateFollowUp,
}: {
  data: PlanningData;
  currentProfileId: string;
  pending: boolean;
  onCreate: (payload: { title: string; context: string; decision: string; requiredProfileIds: string[] }) => void;
  onConfirm: (decisionId: number) => void;
  onEdit: (decisionId: number, payload: { title: string; context: string; decision: string; requiredProfileIds: string[] }) => void;
  onObject: (decisionId: number, comment: string) => void;
  onRemoveDecisionTaskLink: (link: DecisionTaskLink) => void;
  onCreateFollowUp: (decision: PlanningData["decisions"][number]) => void;
}) {
  const [title, setTitle] = useState("");
  const [context, setContext] = useState("");
  const [decisionText, setDecisionText] = useState("");
  const [requiredProfileIds, setRequiredProfileIds] = useState<string[]>(() => data.profiles.map((profile) => profile.id));
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState({ title: "", context: "", decision: "", requiredProfileIds: [] as string[] });
  const [objectionDrafts, setObjectionDrafts] = useState<Record<number, string>>({});
  const [openDecisions, setOpenDecisions] = useState<Record<number, boolean>>({});
  const [openAudits, setOpenAudits] = useState<Record<number, boolean>>({});
  const currentProfile = data.profiles.find((profile) => profile.id === currentProfileId);
  const canCreate = currentProfile?.platformRole === "ceo";

  const resetForm = () => {
    setTitle("");
    setContext("");
    setDecisionText("");
    setRequiredProfileIds(data.profiles.map((profile) => profile.id));
  };

  const startEdit = (item: PlanningData["decisions"][number]) => {
    setEditingId(item.id);
    setEditDraft({
      title: item.title,
      context: item.context,
      decision: item.decision,
      requiredProfileIds: item.requiredProfileIds,
    });
  };

  return (
    <div className="grid gap-4">
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-950">Decision Log</h2>
            <p className="mt-1 text-sm text-slate-500">CEO-only Edit, Founder-Bestätigung und Locking nach vollständiger Zustimmung.</p>
          </div>
          <span className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600">{data.decisions.length} Decisions</span>
        </div>
      </section>
      <section id="decision-create" className="scroll-mt-24 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-950">Neue Decision</h2>
            <p className="mt-1 text-sm text-slate-500">Nur CEO kann Einträge erstellen. Nach Bestätigung aller ausgewählten Personen wird automatisch gelockt.</p>
          </div>
          <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${canCreate ? "border-blue-200 bg-blue-50 text-blue-700" : "border-slate-200 bg-slate-50 text-slate-500"}`}>
            {canCreate ? "CEO-Rechte aktiv" : "Read/Confirm"}
          </span>
        </div>
        <form
          className="mt-4 grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!canCreate || pending) return;
            onCreate({ title, context, decision: decisionText, requiredProfileIds });
            resetForm();
          }}
        >
          <div className="grid gap-3 lg:grid-cols-2">
            <label className="grid gap-1 text-xs font-semibold text-slate-500">
              Titel
              <input
                value={title}
                disabled={!canCreate || pending}
                onChange={(event) => setTitle(event.target.value)}
                className="h-10 rounded-md border border-slate-200 px-3 text-sm font-normal text-slate-900 disabled:bg-slate-50 disabled:opacity-70"
                placeholder="z. B. Malta-Struktur für Sprint 1 freigeben"
              />
            </label>
            <fieldset className="grid gap-2 text-xs font-semibold text-slate-500">
              Bestätigung erforderlich von
              <div className="flex flex-wrap gap-2">
                {data.profiles.map((profile) => {
                  const checked = requiredProfileIds.includes(profile.id);
                  return (
                    <label key={profile.id} className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!canCreate || pending}
                        onChange={(event) => {
                          setRequiredProfileIds((current) =>
                            event.target.checked ? [...current, profile.id] : current.filter((id) => id !== profile.id),
                          );
                        }}
                      />
                      {profile.name}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          </div>
          <label className="grid gap-1 text-xs font-semibold text-slate-500">
            Kontext
            <textarea
              value={context}
              disabled={!canCreate || pending}
              onChange={(event) => setContext(event.target.value)}
              className="min-h-20 resize-y rounded-md border border-slate-200 px-3 py-2 text-sm font-normal leading-6 text-slate-900 disabled:bg-slate-50 disabled:opacity-70"
              placeholder="Warum steht diese Entscheidung jetzt an?"
            />
          </label>
          <label className="grid gap-1 text-xs font-semibold text-slate-500">
            Entscheidung
            <textarea
              value={decisionText}
              disabled={!canCreate || pending}
              onChange={(event) => setDecisionText(event.target.value)}
              className="min-h-24 resize-y rounded-md border border-slate-200 px-3 py-2 text-sm font-normal leading-6 text-slate-900 disabled:bg-slate-50 disabled:opacity-70"
              placeholder="Was wird konkret entschieden?"
            />
          </label>
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={!canCreate || pending || !title.trim() || !decisionText.trim() || !requiredProfileIds.length}
              className="h-9 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              Decision öffnen
            </button>
          </div>
        </form>
      </section>
      {data.decisions.length ? data.decisions.map((decision) => {
        const isEditing = editingId === decision.id;
        const isOpen = openDecisions[decision.id] ?? false;
        const auditOpen = openAudits[decision.id] ?? false;
        const comments = data.decisionComments.filter((comment) => comment.decisionId === decision.id);
        const auditEntries = data.audit
          .filter((entry) => entry.entityType === "decision" && entry.entityId === String(decision.id))
          .slice(0, 8);
        const objectionText = objectionDrafts[decision.id] || "";
        const linkedTasks = data.decisionTaskLinks
          .filter((link) => link.decisionId === decision.id)
          .map((link) => ({ link, task: data.tasks.find((task) => task.id === link.taskId) }))
          .filter((item) => item.task);

        return (
        <article key={decision.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <button
              type="button"
              onClick={() => setOpenDecisions((current) => ({ ...current, [decision.id]: !isOpen }))}
              className="flex min-w-0 flex-1 items-start gap-2 text-left"
              aria-expanded={isOpen}
            >
              <ChevronRight size={16} className={`mt-0.5 shrink-0 text-slate-400 transition-transform ${isOpen ? "rotate-90" : ""}`} />
              <span className="min-w-0">
                <span className="block truncate font-semibold text-slate-950">{decision.title}</span>
              <span className="mt-1 block text-xs text-slate-500">
                  {decision.confirmedProfileIds.length}/{decision.requiredProfileIds.length} bestätigt · {linkedTasks.length} Folgeaufgaben · {auditEntries.length} Audit-Einträge
                </span>
              </span>
            </button>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">{decisionStatusLabel(decision.status)}</span>
              <button
                type="button"
                onClick={() => onCreateFollowUp(decision)}
                className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700"
              >
                Folgeaufgabe
              </button>
              {canCreate && decision.status !== "locked" && (
                <button
                  type="button"
                  onClick={() => {
                    setOpenDecisions((current) => ({ ...current, [decision.id]: true }));
                    if (isEditing) setEditingId(null);
                    else startEdit(decision);
                  }}
                  className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700"
                >
                  {isEditing ? "Schließen" : "Editieren"}
                </button>
              )}
            </div>
          </div>
          {isOpen && (
            <>
          <p className="mt-3 text-sm leading-6 text-slate-600">{decision.context || "Kein Kontext hinterlegt."}</p>
          <div className="mt-3 text-sm text-slate-700">{decision.decision || "Noch keine finale Entscheidung."}</div>
          <div className="mt-4 rounded-md border border-slate-100 bg-slate-50 p-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-xs font-semibold text-slate-500">Folgeaufgaben</h3>
              <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-500">{linkedTasks.length}</span>
            </div>
            <div className="mt-2 grid gap-1.5">
              {linkedTasks.length ? linkedTasks.map(({ link, task }) => (
                <div key={link.id} className="flex items-start gap-2 rounded-md bg-white px-2 py-1.5 text-xs">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-slate-800">{task?.title}</div>
                    <div className="mt-0.5 text-slate-500">{task ? `${normalizeStatus(task.status)} · ${task.owner}` : "Aufgabe nicht gefunden"} · {link.note || "Keine Notiz"}</div>
                  </div>
                  <button type="button" disabled={pending} onClick={() => onRemoveDecisionTaskLink(link)} className="grid h-6 w-6 shrink-0 place-items-center rounded-md border border-slate-200 text-slate-400 hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:opacity-50" aria-label="Decision-Link entfernen">
                    <X size={12} />
                  </button>
                </div>
              )) : (
                <div className="text-xs text-slate-500">Noch keine Folgeaufgabe verknüpft.</div>
              )}
            </div>
          </div>
          {isEditing && (
            <form
              className="mt-4 grid gap-3 rounded-lg border border-blue-100 bg-blue-50/40 p-3"
              onSubmit={(event) => {
                event.preventDefault();
                onEdit(decision.id, editDraft);
                setEditingId(null);
              }}
            >
              <div className="grid gap-3 lg:grid-cols-2">
                <label className="grid gap-1 text-xs font-semibold text-slate-500">
                  Titel
                  <input value={editDraft.title} disabled={pending} onChange={(event) => setEditDraft((current) => ({ ...current, title: event.target.value }))} className="h-9 rounded-md border border-slate-200 px-2 text-sm font-normal text-slate-900" />
                </label>
                <fieldset className="grid gap-2 text-xs font-semibold text-slate-500">
                  Neue Bestätigung erforderlich von
                  <div className="flex flex-wrap gap-2">
                    {data.profiles.map((profile) => (
                      <label key={profile.id} className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700">
                        <input
                          type="checkbox"
                          checked={editDraft.requiredProfileIds.includes(profile.id)}
                          disabled={pending}
                          onChange={(event) => setEditDraft((current) => ({
                            ...current,
                            requiredProfileIds: event.target.checked
                              ? [...current.requiredProfileIds, profile.id]
                              : current.requiredProfileIds.filter((id) => id !== profile.id),
                          }))}
                        />
                        {profile.name}
                      </label>
                    ))}
                  </div>
                </fieldset>
              </div>
              <label className="grid gap-1 text-xs font-semibold text-slate-500">
                Kontext
                <textarea value={editDraft.context} disabled={pending} onChange={(event) => setEditDraft((current) => ({ ...current, context: event.target.value }))} className="min-h-16 rounded-md border border-slate-200 px-2 py-2 text-sm font-normal text-slate-900" />
              </label>
              <label className="grid gap-1 text-xs font-semibold text-slate-500">
                Entscheidung
                <textarea value={editDraft.decision} disabled={pending} onChange={(event) => setEditDraft((current) => ({ ...current, decision: event.target.value }))} className="min-h-20 rounded-md border border-slate-200 px-2 py-2 text-sm font-normal text-slate-900" />
              </label>
              <div className="flex justify-end">
                <button type="submit" disabled={pending || !editDraft.title.trim() || !editDraft.decision.trim() || !editDraft.requiredProfileIds.length} className="h-9 rounded-md bg-blue-600 px-3 text-sm font-semibold text-white disabled:opacity-50">
                  Änderung speichern
                </button>
              </div>
              <p className="text-xs leading-5 text-slate-500">Speichern setzt vorhandene Bestätigungen zurück und schreibt vorher/nachher ins Audit.</p>
            </form>
          )}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
            <div className="flex flex-wrap gap-2 text-xs text-slate-600">
              {decision.requiredProfileIds.map((profileId) => {
                const profile = data.profiles.find((item) => item.id === profileId);
                const confirmed = decision.confirmedProfileIds.includes(profileId);
                return (
                  <span key={profileId} className={`rounded-full border px-2 py-1 font-semibold ${confirmed ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-500"}`}>
                    {profile?.name || profileId}: {confirmed ? "bestätigt" : "offen"}
                  </span>
                );
              })}
            </div>
            <button
              type="button"
              disabled={pending || decision.status === "locked" || !currentProfileId || decision.confirmedProfileIds.includes(currentProfileId)}
              onClick={() => onConfirm(decision.id)}
              className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {decision.confirmedProfileIds.includes(currentProfileId) ? "Bestätigt" : "Bestätigen"}
            </button>
          </div>
          {decision.status !== "locked" && currentProfileId && (
            <form
              className="mt-3 grid gap-2 rounded-md border border-slate-100 bg-white p-3"
              onSubmit={(event) => {
                event.preventDefault();
                onObject(decision.id, objectionText);
                setObjectionDrafts((current) => ({ ...current, [decision.id]: "" }));
              }}
            >
              <label className="grid gap-1 text-xs font-semibold text-slate-500">
                Einwand oder Änderungswunsch
                <textarea
                  value={objectionText}
                  disabled={pending}
                  onChange={(event) => setObjectionDrafts((current) => ({ ...current, [decision.id]: event.target.value }))}
                  className="min-h-16 rounded-md border border-slate-200 px-2 py-2 text-sm font-normal text-slate-900"
                  placeholder="Was ist an der Änderung nicht korrekt oder sollte angepasst werden?"
                />
              </label>
              <div className="flex justify-end">
                <button type="submit" disabled={pending || !objectionText.trim()} className="h-8 rounded-md border border-amber-200 bg-amber-50 px-3 text-xs font-semibold text-amber-700 disabled:opacity-50">
                  Einwand speichern
                </button>
              </div>
            </form>
          )}
          {comments.length > 0 && (
            <div className="mt-3 grid gap-2">
              {comments.map((comment) => {
                const actor = data.profiles.find((profile) => profile.id === comment.profileId)?.name || comment.profileId || "Unbekannt";
                return (
                  <div key={comment.id} className="rounded-md border border-amber-100 bg-amber-50/60 px-3 py-2 text-xs leading-5 text-amber-900">
                    <span className="font-semibold">{comment.type === "objection" ? "Einwand" : "Kommentar"} · {actor} · {formatDate(comment.createdAt)}:</span> {comment.comment}
                  </div>
                );
              })}
            </div>
          )}
          <div className="hidden">
            Audit: {data.audit.filter((entry) => entry.entityType === "decision" && entry.entityId === String(decision.id)).slice(0, 3).map((entry) => {
              const actor = data.profiles.find((profile) => profile.id === entry.actorProfileId)?.name || entry.actorProfileId || "System";
              return `${entry.action} · ${actor} · ${formatDate(entry.createdAt)}`;
            }).join(" / ") || "Noch kein Audit-Eintrag geladen."}
          </div>
          <div className="mt-3 rounded-md border border-slate-100 bg-slate-50">
            <button
              type="button"
              onClick={() => setOpenAudits((current) => ({ ...current, [decision.id]: !auditOpen }))}
              className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs font-semibold text-slate-600"
              aria-expanded={auditOpen}
            >
              <span>Audit Trail · {auditEntries.length} Einträge</span>
              <ChevronRight size={14} className={`text-slate-400 transition-transform ${auditOpen ? "rotate-90" : ""}`} />
            </button>
            {auditOpen && (
              <div className="grid gap-2 border-t border-slate-200 p-3">
                {auditEntries.length ? auditEntries.map((entry) => {
                  const actor = data.profiles.find((profile) => profile.id === entry.actorProfileId)?.name || entry.actorProfileId || "System";
                  const changes = auditChanges(entry, data.profiles);
                  return (
                    <div key={entry.id} className="rounded-md border border-slate-200 bg-white p-3 text-xs leading-5 text-slate-600">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold text-slate-900">{auditActionLabel(entry.action)}</span>
                        <span>{actor} · {formatDate(entry.createdAt)}</span>
                      </div>
                      {changes.length ? (
                        <div className="mt-2 overflow-x-auto">
                          <table className="w-full min-w-[520px] border-separate border-spacing-0 text-left">
                            <thead className="text-slate-500">
                              <tr>
                                <th className="border-b border-slate-100 py-1 pr-3 font-semibold">Feld</th>
                                <th className="border-b border-slate-100 px-3 py-1 font-semibold">Vorher</th>
                                <th className="border-b border-slate-100 py-1 pl-3 font-semibold">Nachher</th>
                              </tr>
                            </thead>
                            <tbody>
                              {changes.map((change) => (
                                <tr key={change.field}>
                                  <td className="border-b border-slate-50 py-1 pr-3 font-semibold text-slate-700">{change.label}</td>
                                  <td className="max-w-[260px] border-b border-slate-50 px-3 py-1 text-slate-500">{change.before}</td>
                                  <td className="max-w-[260px] border-b border-slate-50 py-1 pl-3 text-slate-900">{change.after}</td>
                                </tr>
                              ))}
                            </tbody>
                          </table>
                        </div>
                      ) : (
                        <div className="mt-2 text-slate-500">Keine Feldänderung im Audit-Datensatz gespeichert.</div>
                      )}
                    </div>
                  );
                }) : <div className="text-xs text-slate-500">Noch kein Audit-Eintrag geladen.</div>}
              </div>
            )}
          </div>
            </>
          )}
        </article>
        );
      }) : (
        <section className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          Noch keine Decisions. Der erste Eintrag wird vom CEO erstellt und danach zur Bestätigung geöffnet.
        </section>
      )}
    </div>
  );
}

function DecisionLogOverviewLegacy({ data }: { data: PlanningData }) {
  return (
    <div className="grid gap-4">
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-950">Decision Log</h2>
            <p className="mt-1 text-sm text-slate-500">CEO-only Edit, Founder-Bestätigung und Locking nach vollständiger Zustimmung.</p>
          </div>
          <span className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600">{data.decisions.length} Decisions</span>
        </div>
      </section>
      {data.decisions.length ? data.decisions.map((decision) => (
        <article key={decision.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h3 className="font-semibold text-slate-950">{decision.title}</h3>
              <p className="mt-1 text-sm leading-6 text-slate-600">{decision.context || "Kein Kontext hinterlegt."}</p>
            </div>
            <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">{decision.status}</span>
          </div>
          <div className="mt-3 text-sm text-slate-700">{decision.decision || "Noch keine finale Entscheidung."}</div>
          <div className="mt-3 text-xs text-slate-500">{decision.confirmedProfileIds.length}/{decision.requiredProfileIds.length} Bestätigungen</div>
        </article>
      )) : (
        <section className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          Noch keine Decisions. Der erste Eintrag wird vom CEO erstellt und danach zur Bestätigung geöffnet.
        </section>
      )}
    </div>
  );
}

void SprintScoreOverview;
void SprintScoreOverviewLegacy;
void DecisionLogOverviewLegacy;

const weekdayOptions = [
  { value: "1", label: "Montag" },
  { value: "2", label: "Dienstag" },
  { value: "3", label: "Mittwoch" },
  { value: "4", label: "Donnerstag" },
  { value: "5", label: "Freitag" },
  { value: "6", label: "Samstag" },
  { value: "0", label: "Sonntag" },
];

const blockerTypeOptions = [
  { value: "busy", label: "On Business / blockiert" },
  { value: "vacation", label: "Urlaub" },
  { value: "sick", label: "Krank" },
];

const durationOptions = [
  { value: "30", label: "30 Minuten" },
  { value: "45", label: "45 Minuten" },
  { value: "60", label: "60 Minuten" },
  { value: "90", label: "90 Minuten" },
];

const timeOptions = Array.from({ length: 35 }, (_, index) => {
  const minutes = 6 * 60 + index * 30;
  const value = minutesToTime(minutes);
  return { value, label: value };
});

type MeetingSlot = {
  date: string;
  startTime: string;
  endTime: string;
  availableProfileIds: string[];
  unavailable: Array<{ profileId: string; reason: string }>;
  matchType: "full" | "partial";
};

function dateKey(date: Date) {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`;
}

function addDaysKey(value: string, days: number) {
  const date = new Date(`${value}T00:00:00`);
  date.setDate(date.getDate() + days);
  return dateKey(date);
}

function startOfWeekKey(value: string) {
  const date = new Date(`${value}T00:00:00`);
  const day = date.getDay();
  const mondayOffset = day === 0 ? -6 : 1 - day;
  date.setDate(date.getDate() + mondayOffset);
  return dateKey(date);
}

function addMonthsToWeekKey(value: string, months: number) {
  const date = new Date(`${value}T00:00:00`);
  date.setMonth(date.getMonth() + months);
  return startOfWeekKey(dateKey(date));
}

function monthStartKey(value: string) {
  const date = new Date(`${value}T00:00:00`);
  date.setDate(1);
  return dateKey(date);
}

function monthEndKey(value: string) {
  const date = new Date(`${value}T00:00:00`);
  date.setMonth(date.getMonth() + 1, 0);
  return dateKey(date);
}

function calendarMonthGridDates(value: string) {
  const firstDay = monthStartKey(value);
  const lastDay = monthEndKey(value);
  const gridStart = startOfWeekKey(firstDay);
  const lastDate = new Date(`${lastDay}T00:00:00`);
  const lastDayOfWeek = lastDate.getDay();
  const sundayOffset = lastDayOfWeek === 0 ? 0 : 7 - lastDayOfWeek;
  const gridEnd = addDaysKey(lastDay, sundayOffset);
  const dates: string[] = [];
  for (let date = gridStart; date <= gridEnd; date = addDaysKey(date, 1)) {
    dates.push(date);
  }
  return dates;
}

function timeToMinutes(value: string) {
  const [hours = "0", minutes = "0"] = value.split(":");
  return Number(hours) * 60 + Number(minutes);
}

function minutesToTime(value: number) {
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(value % 60).padStart(2, "0")}`;
}

function weekdayForDate(value: string) {
  return new Date(`${value}T00:00:00`).getDay();
}

function formatDateLabel(value: string) {
  return new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "2-digit", month: "2-digit" }).format(new Date(`${value}T00:00:00`));
}

function formatLongDateLabel(value: string) {
  return new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "2-digit", month: "long" }).format(new Date(`${value}T00:00:00`));
}

function formatCalendarMonthLabel(start: string, end: string) {
  const startDate = new Date(`${start}T00:00:00`);
  const endDate = new Date(`${end}T00:00:00`);
  const month = new Intl.DateTimeFormat("de-DE", { month: "long" });
  const monthYear = new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" });
  if (startDate.getFullYear() === endDate.getFullYear() && startDate.getMonth() === endDate.getMonth()) {
    return monthYear.format(startDate);
  }
  if (startDate.getFullYear() === endDate.getFullYear()) {
    return `${month.format(startDate)}/${monthYear.format(endDate)}`;
  }
  return `${monthYear.format(startDate)} / ${monthYear.format(endDate)}`;
}

function formatCalendarSingleMonthLabel(value: string) {
  return new Intl.DateTimeFormat("de-DE", { month: "long", year: "numeric" }).format(new Date(`${value}T00:00:00`));
}

function formatMeetingDateTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("de-DE", { weekday: "short", day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }).format(date);
}

function availabilitySummaryTone(kind: "open" | "blocked" | "closed" | "meeting") {
  if (kind === "meeting") return "border-blue-300 bg-blue-50 text-blue-900";
  if (kind === "blocked") return "border-red-300 bg-red-50 text-red-900";
  return "";
}

function googleCalendarDate(date: string, time: string) {
  return `${date.replaceAll("-", "")}T${time.replace(":", "")}00`;
}

function meetingSlotIso(slot: MeetingSlot) {
  return new Date(`${slot.date}T${slot.startTime}:00`).toISOString();
}

function googleCalendarUrl(slot: MeetingSlot, profiles: Profile[], title = "FindMyDoc Teammeeting", agenda = "") {
  const attendeeEmails = profiles.map((profile) => profile.googleCalendarEmail).filter(Boolean);
  const encodedTitle = encodeURIComponent(title);
  const details = encodeURIComponent(`${agenda ? `${agenda}\n\n` : ""}Teilnehmer: ${profiles.map((profile) => profile.name).join(", ")}`);
  const dates = `${googleCalendarDate(slot.date, slot.startTime)}/${googleCalendarDate(slot.date, slot.endTime)}`;
  const attendees = attendeeEmails.length ? `&add=${encodeURIComponent(attendeeEmails.join(","))}` : "";
  return `https://calendar.google.com/calendar/render?action=TEMPLATE&text=${encodedTitle}&dates=${dates}&ctz=Europe/Berlin&details=${details}${attendees}`;
}

function meetingOverlapsSlot(meeting: Meeting, date: string, start: number, end: number) {
  if (meeting.status === "cancelled") return false;
  const meetingDate = new Date(meeting.meetingAt);
  if (dateKey(meetingDate) !== date) return false;
  const meetingStart = meetingDate.getHours() * 60 + meetingDate.getMinutes();
  const meetingEnd = meetingStart + 60;
  return start < meetingEnd && end > meetingStart;
}

function availabilityTypeLabel(type: AvailabilityEntry["type"]) {
  if (type === "working_hours") return "Arbeitszeit";
  if (type === "vacation") return "Urlaub";
  if (type === "sick") return "Krank";
  return "On Business";
}

function availabilityTone(type: AvailabilityEntry["type"], source?: AvailabilityEntry["source"]) {
  if (source === "google_calendar") return "border-blue-200 bg-blue-50 text-blue-800";
  if (type === "working_hours") return "border-emerald-200 bg-emerald-50 text-emerald-800";
  if (type === "vacation") return "border-amber-200 bg-amber-50 text-amber-800";
  if (type === "sick") return "border-red-200 bg-red-50 text-red-800";
  return "border-slate-200 bg-slate-50 text-slate-700";
}

function availabilityReason(entry: AvailabilityEntry) {
  const base = availabilityTypeLabel(entry.type);
  return entry.note ? `${base}: ${entry.note}` : base;
}

function availabilityCalendarLabel(entry: AvailabilityEntry) {
  if (entry.source === "google_calendar") return "Google Kalender";
  return availabilityTypeLabel(entry.type);
}

function overlapsSlot(entry: AvailabilityEntry, date: string, start: number, end: number) {
  if (entry.type === "working_hours") return false;
  if (entry.startDate && entry.startDate > date) return false;
  if (entry.endDate && entry.endDate < date) return false;
  const blockStart = entry.startTime ? timeToMinutes(entry.startTime) : 0;
  const blockEnd = entry.endTime ? timeToMinutes(entry.endTime) : 24 * 60;
  return start < blockEnd && end > blockStart;
}

function workingWindowFor(profileId: string, date: string, availability: AvailabilityEntry[]) {
  const weekday = weekdayForDate(date);
  const entry = availability.find((item) => item.profileId === profileId && item.type === "working_hours" && item.weekday === weekday);
  if (!entry?.startTime || !entry.endTime) return null;
  return { start: timeToMinutes(entry.startTime), end: timeToMinutes(entry.endTime) };
}

function findMeetingSlots(data: PlanningData, profileIds: string[], from: string, to: string, durationMinutes: number) {
  const slots: MeetingSlot[] = [];
  let current = from;
  let guard = 0;

  while (current <= to && guard < 21 && slots.length < 60) {
    guard += 1;
    for (let start = 7 * 60; start + durationMinutes <= 22 * 60 && slots.length < 60; start += 30) {
      const end = start + durationMinutes;
      const availableProfileIds: string[] = [];
      const unavailable: MeetingSlot["unavailable"] = [];

      for (const profileId of profileIds) {
        const window = workingWindowFor(profileId, current, data.availability);
        if (!window) {
          unavailable.push({ profileId, reason: "Keine Arbeitszeit hinterlegt" });
          continue;
        }
        if (start < window.start || end > window.end) {
          unavailable.push({ profileId, reason: "Außerhalb Arbeitszeit" });
          continue;
        }
        const blocker = data.availability.find((entry) => entry.profileId === profileId && overlapsSlot(entry, current, start, end));
        if (blocker) {
          unavailable.push({ profileId, reason: availabilityReason(blocker) });
          continue;
        }
        const meetingConflict = data.meetings.find((meeting) => meetingOverlapsSlot(meeting, current, start, end));
        if (meetingConflict) {
          unavailable.push({ profileId, reason: `Schon belegt: ${meetingConflict.title}` });
          continue;
        }
        availableProfileIds.push(profileId);
      }

      if (availableProfileIds.length === profileIds.length || availableProfileIds.length >= Math.ceil(profileIds.length * 0.6)) {
        slots.push({
          date: current,
          startTime: minutesToTime(start),
          endTime: minutesToTime(end),
          availableProfileIds,
          unavailable,
          matchType: unavailable.length ? "partial" : "full",
        });
      }
    }
    current = addDaysKey(current, 1);
  }

  return slots.sort((a, b) => {
    if (a.matchType !== b.matchType) return a.matchType === "full" ? -1 : 1;
    return `${a.date}${a.startTime}`.localeCompare(`${b.date}${b.startTime}`);
  });
}

function MeetingFinderOverview({
  data,
  pending,
  currentProfile,
  canManageAvailability,
  calendarSyncMessage,
  meetingCreateMessage,
  onCreateAvailability,
  onDeleteAvailability,
  onSyncGoogleCalendar,
  onCreateMeeting,
  onUpdateMeeting,
}: {
  data: PlanningData;
  pending: boolean;
  currentProfile: Profile | null;
  canManageAvailability: boolean;
  calendarSyncMessage: string;
  meetingCreateMessage: string;
  onCreateAvailability: (entry: Omit<AvailabilityEntry, "id">) => void;
  onDeleteAvailability: (entry: AvailabilityEntry) => void;
  onSyncGoogleCalendar: () => void;
  onCreateMeeting: (payload: { title: string; agenda: string; sprintId: string; meetingAt: string; profileIds: string[] }) => void;
  onUpdateMeeting: (meeting: Meeting, patch: Partial<Pick<Meeting, "title" | "agenda" | "meetingAt" | "status">>) => void;
}) {
  const today = dateKey(new Date());
  const defaultEnd = addDaysKey(today, 14);
  const selectableProfiles = useMemo(() => data.profiles.filter((profile) => profile.platformRole !== "viewer"), [data.profiles]);
  const editableProfiles = useMemo(
    () => canManageAvailability ? selectableProfiles : selectableProfiles.filter((profile) => profile.id === currentProfile?.id),
    [canManageAvailability, currentProfile?.id, selectableProfiles],
  );
  const defaultEditableProfileId = useMemo(() => {
    if (currentProfile?.id && editableProfiles.some((profile) => profile.id === currentProfile.id)) return currentProfile.id;
    return editableProfiles[0]?.id || "";
  }, [currentProfile?.id, editableProfiles]);
  const defaultSelectedProfileIds = useMemo(() => currentProfile?.id && selectableProfiles.some((profile) => profile.id === currentProfile.id)
    ? [currentProfile.id]
    : selectableProfiles.slice(0, 1).map((profile) => profile.id), [currentProfile, selectableProfiles]);
  const defaultSelectionAppliedRef = useRef(false);
  const [selectedProfileIds, setSelectedProfileIds] = useState<string[]>([]);
  const [fromDate, setFromDate] = useState(today);
  const [toDate, setToDate] = useState(defaultEnd);
  const [calendarWeekStart, setCalendarWeekStart] = useState(() => startOfWeekKey(today));
  const [calendarView, setCalendarView] = useState<"week" | "month">("week");
  const [duration, setDuration] = useState("60");
  const [workProfileId, setWorkProfileId] = useState(defaultEditableProfileId);
  const [workWeekdays, setWorkWeekdays] = useState<string[]>(["1", "2", "3", "4", "5"]);
  const [workStart, setWorkStart] = useState("09:00");
  const [workEnd, setWorkEnd] = useState("18:00");
  const [blockerProfileId, setBlockerProfileId] = useState(defaultEditableProfileId);
  const [blockerType, setBlockerType] = useState<AvailabilityEntry["type"]>("busy");
  const [blockerStartDate, setBlockerStartDate] = useState(today);
  const [blockerEndDate, setBlockerEndDate] = useState(today);
  const [blockerStartTime, setBlockerStartTime] = useState("09:00");
  const [blockerEndTime, setBlockerEndTime] = useState("18:00");
  const [blockerAllDay, setBlockerAllDay] = useState(false);
  const [blockerNote, setBlockerNote] = useState("");
  const [meetingTitle, setMeetingTitle] = useState("FindMyDoc Teammeeting");
  const [meetingAgenda, setMeetingAgenda] = useState("Sprint-Update, Blocker, Entscheidungen und nächste Schritte.");

  const workingHours = data.availability.filter((entry) => entry.type === "working_hours");
  const blockers = data.availability.filter((entry) => entry.type === "vacation" || entry.type === "sick" || entry.type === "busy");
  const googleCalendarBlocks = blockers.filter((entry) => entry.source === "google_calendar");
  const googleCalendarProfiles = selectableProfiles.filter((profile) => profile.googleCalendarSyncEnabled && profile.googleCalendarEmail);
  const lastGoogleSync = googleCalendarProfiles
    .map((profile) => profile.googleCalendarLastSyncedAt)
    .filter(Boolean)
    .sort()
    .at(-1) || "";
  const profileNameById = new Map(data.profiles.map((profile) => [profile.id, profile.name]));
  const selectedProfiles = selectableProfiles.filter((profile) => selectedProfileIds.includes(profile.id));
  const slots = selectedProfileIds.length ? findMeetingSlots(data, selectedProfileIds, fromDate, toDate, Number(duration)) : [];
  const fullSlots = slots.filter((slot) => slot.matchType === "full");
  const visibleSlots = slots.slice(0, 12);
  const calendarDates = Array.from({ length: 7 }, (_, index) => addDaysKey(calendarWeekStart, index));
  const calendarWeekEnd = calendarDates[6] || calendarWeekStart;
  const calendarMonthLabel = formatCalendarMonthLabel(calendarWeekStart, calendarWeekEnd);
  const calendarTitle = calendarView === "week" ? calendarMonthLabel : formatCalendarSingleMonthLabel(calendarWeekStart);
  const calendarSubtitle = calendarView === "week"
    ? `${formatDateLabel(calendarWeekStart)} bis ${formatDateLabel(calendarWeekEnd)}`
    : `${formatDateLabel(monthStartKey(calendarWeekStart))} bis ${formatDateLabel(monthEndKey(calendarWeekStart))}`;
  const calendarMonthDates = calendarMonthGridDates(calendarWeekStart);
  const calendarActiveMonth = new Date(`${calendarWeekStart}T00:00:00`).getMonth();
  const calendarHours = Array.from({ length: 14 }, (_, index) => 8 * 60 + index * 60);
  const nextRecommendedSlot = slots[0];
  const activeSprint = data.sprints.find((sprint) => sprint.status === "active") || data.sprints[0];
  const plannedMeetings = data.meetings
    .filter((meeting) => meeting.status !== "cancelled")
    .sort((a, b) => new Date(a.meetingAt).getTime() - new Date(b.meetingAt).getTime())
    .slice(0, 8);

  const profileOptions = editableProfiles.map((profile) => ({ value: profile.id, label: profile.name }));
  const participantOptions = selectableProfiles.map((profile) => ({
    value: profile.id,
    label: selectedProfileIds.includes(profile.id) ? `${profile.name} ✓` : profile.name,
  }));

  useEffect(() => {
    if (!defaultSelectionAppliedRef.current && defaultSelectedProfileIds.length) {
      setSelectedProfileIds(defaultSelectedProfileIds);
      defaultSelectionAppliedRef.current = true;
    }
  }, [defaultSelectedProfileIds]);

  const toggleParticipant = (profileId: string) => {
    setSelectedProfileIds((current) =>
      current.includes(profileId) ? current.filter((id) => id !== profileId) : [...current, profileId],
    );
  };

  const normalizedWorkProfileId = editableProfiles.some((profile) => profile.id === workProfileId) ? workProfileId : defaultEditableProfileId;
  const normalizedBlockerProfileId = editableProfiles.some((profile) => profile.id === blockerProfileId) ? blockerProfileId : defaultEditableProfileId;

  const addWorkingHours = () => {
    if (!normalizedWorkProfileId || !workWeekdays.length) return;
    for (const weekday of workWeekdays) {
      onCreateAvailability({
        profileId: normalizedWorkProfileId,
        type: "working_hours",
        title: "Working hours",
        blockerKind: "working_hours",
        weekday: Number(weekday),
        startDate: "",
        endDate: "",
        startTime: workStart,
        endTime: workEnd,
        note: "Reguläre FindMyDoc-Arbeitszeit",
      });
    }
  };

  const toggleWorkWeekday = (weekday: string) => {
    setWorkWeekdays((current) =>
      current.includes(weekday) ? current.filter((item) => item !== weekday) : [...current, weekday].sort(),
    );
  };

  const addBlocker = () => {
    if (!normalizedBlockerProfileId) return;
    onCreateAvailability({
      profileId: normalizedBlockerProfileId,
      type: blockerType,
      title: blockerType === "vacation" ? "Vacation" : blockerType === "sick" ? "Sick leave" : "Busy",
      blockerKind: blockerType === "vacation" ? "vacation" : blockerType === "sick" ? "sick" : "on_business",
      weekday: null,
      startDate: blockerStartDate,
      endDate: blockerEndDate || blockerStartDate,
      startTime: blockerAllDay ? "00:00" : blockerStartTime,
      endTime: blockerAllDay ? "23:59" : blockerEndTime,
      note: blockerNote.trim(),
    });
    setBlockerNote("");
  };

  const sprintForSlot = (slot: MeetingSlot) =>
    data.sprints.find((sprint) => sprint.startDate <= slot.date && sprint.endDate >= slot.date) || activeSprint;

  const reserveSlot = (slot: MeetingSlot) => {
    const sprint = sprintForSlot(slot);
    if (!sprint || !selectedProfileIds.length) return;
    onCreateMeeting({
      title: meetingTitle.trim() || "FindMyDoc Teammeeting",
      agenda: meetingAgenda.trim(),
      sprintId: sprint.id,
      meetingAt: meetingSlotIso(slot),
      profileIds: selectedProfileIds,
    });
  };

  const attendanceForMeeting = (meeting: Meeting) => data.meetingAttendance.filter((attendance) => attendance.meetingId === meeting.id);

  const calendarCellFor = (date: string, start: number) => {
    const end = start + 60;
    const meetingConflict = data.meetings.find((meeting) => meetingOverlapsSlot(meeting, date, start, end));
    if (meetingConflict) {
      return {
        kind: "meeting" as const,
        label: "Meeting",
        detail: meetingConflict.title,
        availableCount: 0,
      };
    }

    let workingCount = 0;
    const reasons: string[] = [];

    for (const profileId of selectedProfileIds) {
      const name = profileNameById.get(profileId) || profileId;
      const window = workingWindowFor(profileId, date, data.availability);
      if (!window || start < window.start || end > window.end) {
        continue;
      }

      workingCount += 1;
      const blocker = data.availability.find((entry) => entry.profileId === profileId && overlapsSlot(entry, date, start, end));
      if (blocker) {
        reasons.push(`${name}: ${availabilityReason(blocker)}`);
      }
    }

    if (!selectedProfileIds.length) {
      return { kind: "closed" as const, label: "Keine Auswahl", detail: "Wähle Teilnehmer aus.", availableCount: 0 };
    }
    if (!workingCount) {
      return { kind: "closed" as const, label: "Keine Arbeitszeit", detail: "", availableCount: 0 };
    }
    if (reasons.length) {
      return {
        kind: "blocked" as const,
        label: reasons.length === 1 ? "Blocker" : "Mehrere Blocker",
        detail: reasons.slice(0, 3).join(", "),
        availableCount: workingCount - reasons.length,
      };
    }
    return { kind: "open" as const, label: "Arbeitszeit frei", detail: "", availableCount: workingCount };
  };

  type CalendarBlock = {
    id: string;
    kind: "blocked" | "meeting";
    label: string;
    detail: string;
    start: number;
    end: number;
    tone: string;
  };

  const calendarBlocksForDate = (date: string): CalendarBlock[] => {
    const firstVisibleMinute = calendarHours[0] || 8 * 60;
    const lastVisibleMinute = (calendarHours.at(-1) || 21 * 60) + 60;
    const blocks: CalendarBlock[] = [];

    for (const meeting of data.meetings) {
      if (!meetingOverlapsSlot(meeting, date, firstVisibleMinute, lastVisibleMinute)) continue;
      const meetingDate = new Date(meeting.meetingAt);
      const meetingStart = meetingDate.getHours() * 60 + meetingDate.getMinutes();
      const meetingEnd = meetingStart + 60;
      blocks.push({
        id: `meeting-${meeting.id}-${date}`,
        kind: "meeting",
        label: "Meeting",
        detail: meeting.title,
        start: Math.max(firstVisibleMinute, meetingStart),
        end: Math.min(lastVisibleMinute, meetingEnd),
        tone: availabilitySummaryTone("meeting"),
      });
    }

    for (const profileId of selectedProfileIds) {
      const window = workingWindowFor(profileId, date, data.availability);
      if (!window) continue;
      const name = profileNameById.get(profileId) || profileId;
      for (const entry of data.availability) {
        if (entry.profileId !== profileId || entry.type === "working_hours") continue;
        if (!overlapsSlot(entry, date, firstVisibleMinute, lastVisibleMinute)) continue;

        const entryStart = entry.startTime ? timeToMinutes(entry.startTime) : 0;
        const entryEnd = entry.endTime ? timeToMinutes(entry.endTime) : 24 * 60;
        const start = Math.max(firstVisibleMinute, window.start, entryStart);
        const end = Math.min(lastVisibleMinute, window.end, entryEnd);
        if (start >= end) continue;

        blocks.push({
          id: `blocker-${entry.id}-${profileId}-${date}`,
          kind: "blocked",
          label: availabilityCalendarLabel(entry),
          detail: `${name}${entry.note?.trim() ? `: ${entry.note.trim()}` : ""}`,
          start,
          end,
          tone: availabilityTone(entry.type, entry.source),
        });
      }
    }

    return blocks.sort((a, b) => a.start - b.start || b.end - a.end || a.id.localeCompare(b.id));
  };

  const calendarDaySummary = (date: string) => {
    const cells = calendarHours.map((hour) => calendarCellFor(date, hour));
    const open = cells.filter((cell) => cell.kind === "open").length;
    const blocked = cells.filter((cell) => cell.kind === "blocked").length;
    const meetings = cells.filter((cell) => cell.kind === "meeting").length;
    const closed = cells.filter((cell) => cell.kind === "closed").length;
    return { open, blocked, meetings, closed };
  };

  const moveCalendar = (direction: -1 | 1) => {
    setCalendarWeekStart((current) => calendarView === "week" ? addDaysKey(current, direction * 7) : addMonthsToWeekKey(current, direction));
  };

  return (
    <div className="grid gap-4 xl:grid-cols-[430px_1fr]">
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-semibold text-slate-950">Meeting Finder</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">Findet gemeinsame Slots aus FindMyDoc-Arbeitszeiten, Arbeit, Urlaub, Krankheit, bestehenden Meetings und Google-Workspace-Blockern.</p>
        <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-md bg-slate-50 p-3"><div className="text-xs text-slate-500">Arbeitszeiten</div><div className="font-semibold">{workingHours.length}</div></div>
          <div className="rounded-md bg-slate-50 p-3"><div className="text-xs text-slate-500">Blocker</div><div className="font-semibold">{blockers.length}</div></div>
          <div className="rounded-md bg-emerald-50 p-3"><div className="text-xs text-emerald-700">Volle Treffer</div><div className="font-semibold text-emerald-900">{fullSlots.length}</div></div>
          <div className="rounded-md bg-blue-50 p-3"><div className="text-xs text-blue-700">Teilnehmer</div><div className="font-semibold text-blue-900">{selectedProfiles.length}</div></div>
        </div>
        <div className="mt-4 rounded-md border border-blue-100 bg-blue-50 px-3 py-3 text-sm leading-6 text-blue-800">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <div className="font-semibold text-blue-950">Google Workspace Sync</div>
              <div>{googleCalendarProfiles.length} Profil(e) sind für Kalenderimport vorbereitet. Importierte Termine erscheinen als Google-Blocker.</div>
              {lastGoogleSync && <div className="mt-1 text-xs text-blue-700">Letzter Sync: {formatDate(lastGoogleSync)}</div>}
              {calendarSyncMessage && <div className="mt-2 rounded-md border border-blue-200 bg-white px-2 py-1 text-xs font-semibold text-blue-800">{calendarSyncMessage}</div>}
            </div>
            <button
              type="button"
              onClick={onSyncGoogleCalendar}
              disabled={pending || !canManageAvailability}
              className="h-9 rounded-md border border-blue-200 bg-white px-3 text-xs font-semibold text-blue-700 hover:bg-blue-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              Google-Kalender synchronisieren
            </button>
          </div>
        </div>
      </section>
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-950">Freie Slots finden</h2>
            <p className="mt-1 text-sm text-slate-500">Volle Treffer werden zuerst gezeigt, Teilmatches bleiben sichtbar, damit du schnell entscheiden kannst.</p>
          </div>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-600">{visibleSlots.length}/{slots.length} Slots</span>
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_1fr_160px]">
          <CustomDatePicker value={fromDate} onChange={setFromDate} className="h-9 text-sm" aria-label="Startdatum wählen" />
          <CustomDatePicker value={toDate} onChange={setToDate} className="h-9 text-sm" aria-label="Enddatum wählen" />
          <CustomSelect value={duration} onChange={setDuration} className="h-9 text-sm" options={durationOptions} aria-label="Meetingdauer wählen" />
        </div>
        <div className="mt-4 grid gap-3 rounded-lg border border-slate-100 bg-slate-50 p-3">
          <div className="text-sm font-semibold text-slate-950">Meeting vormerken</div>
          <input
            value={meetingTitle}
            onChange={(event) => setMeetingTitle(event.target.value)}
            className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            placeholder="Meeting-Titel"
          />
          <textarea
            value={meetingAgenda}
            onChange={(event) => setMeetingAgenda(event.target.value)}
            className="min-h-20 rounded-md border border-slate-200 bg-white px-3 py-2 text-sm text-slate-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
            placeholder="Agenda oder Kontext"
          />
          <p className="text-xs leading-5 text-slate-500">
            Ein vorgemerkter Slot legt ein internes Meeting an und erzeugt offene Anwesenheitszeilen für alle ausgewählten Teilnehmer.
          </p>
          {meetingCreateMessage && <div className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1 text-xs font-semibold text-emerald-800">{meetingCreateMessage}</div>}
        </div>
        {nextRecommendedSlot && (
          <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Empfohlener Slot</div>
                <div className="mt-1 font-semibold text-emerald-950">{formatLongDateLabel(nextRecommendedSlot.date)} · {nextRecommendedSlot.startTime}-{nextRecommendedSlot.endTime}</div>
              </div>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => reserveSlot(nextRecommendedSlot)}
                  disabled={pending || !canManageAvailability || !selectedProfileIds.length || !activeSprint}
                  className="inline-flex h-8 items-center rounded-md bg-emerald-600 px-3 text-xs font-semibold text-white hover:bg-emerald-700 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Intern vormerken
                </button>
                <a
                  href={googleCalendarUrl(nextRecommendedSlot, selectedProfiles, meetingTitle, meetingAgenda)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-8 items-center rounded-md border border-emerald-200 bg-white px-3 text-xs font-semibold text-emerald-800 hover:bg-emerald-100"
                >
                  Google-Termin öffnen
                </a>
              </div>
            </div>
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => setSelectedProfileIds(selectedProfileIds.length === selectableProfiles.length ? [] : selectableProfiles.map((profile) => profile.id))}
            className="h-8 rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            {selectedProfileIds.length === selectableProfiles.length ? "Alle abwählen" : "Alle wählen"}
          </button>
          {participantOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => toggleParticipant(option.value)}
              className={`h-8 rounded-md border px-3 text-xs font-semibold ${selectedProfileIds.includes(option.value) ? "border-blue-300 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-600"}`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="mt-4 grid gap-2">
          {visibleSlots.map((slot) => (
            <div key={`${slot.date}-${slot.startTime}-${slot.endTime}`} className={`rounded-lg border px-3 py-2 text-sm ${slot.matchType === "full" ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-semibold text-slate-950">{formatLongDateLabel(slot.date)} · {slot.startTime}-{slot.endTime}</div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full border bg-white px-2 py-0.5 text-xs font-semibold ${slot.matchType === "full" ? "border-emerald-200 text-emerald-700" : "border-amber-200 text-amber-700"}`}>
                    {slot.availableProfileIds.length}/{selectedProfileIds.length} verfügbar
                  </span>
                  <button
                    type="button"
                    onClick={() => reserveSlot(slot)}
                    disabled={pending || !canManageAvailability || !selectedProfileIds.length || !activeSprint}
                    className="rounded-full border border-emerald-200 bg-white px-2 py-0.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Vormerken
                  </button>
                  <a href={googleCalendarUrl(slot, selectedProfiles, meetingTitle, meetingAgenda)} target="_blank" rel="noreferrer" className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs font-semibold text-slate-600 hover:bg-slate-50">
                    Kalender
                  </a>
                </div>
              </div>
              <div className="mt-1 text-xs leading-5 text-slate-600">Verfügbar: {slot.availableProfileIds.map((id) => profileNameById.get(id) || id).join(", ") || "niemand"}</div>
              {slot.unavailable.length > 0 && (
                <div className="mt-1 text-xs leading-5 text-amber-800">
                  Nicht verfügbar: {slot.unavailable.map((item) => `${profileNameById.get(item.profileId) || item.profileId} (${item.reason})`).join(", ")}
                </div>
              )}
            </div>
          ))}
          {!visibleSlots.length && (
            <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
              Keine passenden Slots. Prüfe Arbeitszeiten, verkürze die Dauer oder wähle weniger Teilnehmer.
            </div>
          )}
        </div>
      </section>
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm xl:col-span-2">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex min-w-0 flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={() => setCalendarWeekStart(startOfWeekKey(today))}
              className="h-9 rounded-full border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
            >
              Heute
            </button>
            <div className="flex items-center rounded-full border border-slate-200 bg-white">
              <button
                type="button"
                onClick={() => moveCalendar(-1)}
                aria-label={calendarView === "week" ? "Vorherige Woche" : "Vorheriger Monat"}
                className="inline-flex h-9 w-9 items-center justify-center rounded-l-full text-slate-600 hover:bg-slate-50"
              >
                <ChevronLeft className="h-4 w-4" />
              </button>
              <button
                type="button"
                onClick={() => moveCalendar(1)}
                aria-label={calendarView === "week" ? "Nächste Woche" : "Nächster Monat"}
                className="inline-flex h-9 w-9 items-center justify-center rounded-r-full text-slate-600 hover:bg-slate-50"
              >
                <ChevronRight className="h-4 w-4" />
              </button>
            </div>
            <div className="min-w-0 px-1">
              <h2 className="truncate text-lg font-semibold text-slate-950">{calendarTitle}</h2>
              <p className="text-xs text-slate-500">{calendarSubtitle}</p>
            </div>
          </div>
          <div className="w-36">
            <CustomSelect
              value={calendarView}
              onChange={(value) => setCalendarView(value as "week" | "month")}
              className="h-9 text-sm"
              options={[
                { value: "week", label: "Woche" },
                { value: "month", label: "Monat" },
              ]}
              aria-label="Kalenderansicht wählen"
            />
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
          <p className="text-sm text-slate-500">
            {calendarView === "week"
              ? "Wochenraster wie im Kalender. Schraffierte Flächen liegen außerhalb der FindMyDoc-Arbeitszeit; farbige Blöcke zeigen nur Blocker und Meetings."
              : "Monatsübersicht für Orientierung und schnelle Planung. Die Tagesmarker fassen Blocker und Meetings zusammen."}
          </p>
          <div className="flex flex-wrap gap-2 text-xs font-semibold">
            <span className="rounded-full border border-red-200 bg-red-50 px-2 py-1 text-red-700">Blockiert</span>
            <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-1 text-blue-700">Meeting</span>
            <span className="rounded-full border border-slate-200 bg-[repeating-linear-gradient(135deg,rgba(239,68,68,0.10)_0,rgba(239,68,68,0.10)_6px,rgba(255,255,255,0)_6px,rgba(255,255,255,0)_12px)] px-2 py-1 text-slate-600">Nicht verfügbar</span>
          </div>
        </div>
        <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
          <span className="mr-1 text-xs font-semibold text-slate-500">Kalender anzeigen:</span>
          {currentProfile?.id && (
            <button
              type="button"
              onClick={() => setSelectedProfileIds([currentProfile.id])}
              className="h-8 rounded-md border border-blue-200 bg-white px-3 text-xs font-semibold text-blue-700 hover:bg-blue-50"
            >
              Mein Kalender
            </button>
          )}
          <button
            type="button"
            onClick={() => setSelectedProfileIds(selectableProfiles.map((profile) => profile.id))}
            className="h-8 rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            Alle anzeigen
          </button>
          {selectableProfiles.map((profile) => (
            <button
              key={`calendar-profile-${profile.id}`}
              type="button"
              onClick={() => toggleParticipant(profile.id)}
              className={`h-8 rounded-md border px-3 text-xs font-semibold ${selectedProfileIds.includes(profile.id) ? "border-blue-300 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-600"}`}
            >
              {profile.name}
            </button>
          ))}
        </div>
        {calendarView === "week" ? (
          <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
            <div className="min-w-[980px]">
              <div className="grid grid-cols-[72px_repeat(7,minmax(132px,1fr))] border-b border-slate-200 bg-white">
                <div className="px-3 py-3 text-xs font-semibold text-slate-500">GMT+02</div>
                {calendarDates.map((date) => (
                  <div key={date} className="border-l border-slate-200 px-3 py-2">
                    <div className="text-[11px] font-semibold uppercase text-slate-500">{new Intl.DateTimeFormat("de-DE", { weekday: "short" }).format(new Date(`${date}T00:00:00`))}</div>
                    <div className="mt-0.5 text-lg font-semibold text-slate-950">{new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit" }).format(new Date(`${date}T00:00:00`))}</div>
                  </div>
                ))}
              </div>
              {calendarHours.map((hour) => (
                <div key={hour} className="grid grid-cols-[72px_repeat(7,minmax(132px,1fr))] border-b border-slate-100 last:border-b-0">
                  <div className="bg-white px-3 py-2 text-xs font-semibold text-slate-500">{minutesToTime(hour)}</div>
                  {calendarDates.map((date) => {
                    const cell = calendarCellFor(date, hour);
                    const dateBlocks = calendarBlocksForDate(date);
                    const activeBlock = dateBlocks.find((block) => block.start < hour + 60 && block.end > hour);
                    const startsHere = activeBlock ? activeBlock.start >= hour && activeBlock.start < hour + 60 : false;
                    const blockTop = activeBlock ? Math.max(4, ((activeBlock.start - hour) / 60) * 64 + 4) : 0;
                    const blockHeight = activeBlock ? Math.max(34, ((activeBlock.end - activeBlock.start) / 60) * 64 - 8) : 0;
                    return (
                      <div key={`${date}-${hour}`} className="relative h-16 overflow-visible border-l border-slate-100 bg-white px-1 py-1">
                        {startsHere && activeBlock ? (
                          <div
                            className={`absolute left-1 right-1 z-20 overflow-hidden rounded-md border px-2 py-1.5 text-xs leading-4 shadow-sm ${activeBlock.kind === "meeting" ? availabilitySummaryTone("meeting") : activeBlock.tone}`}
                            style={{ top: `${blockTop}px`, height: `${blockHeight}px` }}
                            title={`${activeBlock.label}${activeBlock.detail ? ` · ${activeBlock.detail}` : ""}`}
                          >
                            <div className="flex items-center justify-between gap-2">
                              <span className="truncate font-semibold">{activeBlock.label}</span>
                              <span className="shrink-0 text-[11px] opacity-75">{minutesToTime(activeBlock.start)}-{minutesToTime(activeBlock.end)}</span>
                            </div>
                            {activeBlock.detail && <div className="mt-0.5 line-clamp-3 opacity-80">{activeBlock.detail}</div>}
                          </div>
                        ) : activeBlock ? (
                          <div className="h-full rounded-md border border-transparent bg-white" title={`${activeBlock.label} läuft weiter`} />
                        ) : cell.kind === "closed" ? (
                          <div
                            className="h-full min-h-12 rounded-md border border-transparent opacity-70"
                            title={cell.label}
                            style={{
                              backgroundImage: "repeating-linear-gradient(135deg, rgba(239, 68, 68, 0.08) 0, rgba(239, 68, 68, 0.08) 6px, rgba(255, 255, 255, 0) 6px, rgba(255, 255, 255, 0) 12px)",
                            }}
                          />
                        ) : cell.kind === "open" ? (
                          <div className="h-full min-h-12 rounded-md border border-transparent bg-white" title="Arbeitszeit ohne Blocker" />
                        ) : (
                          <div className={`h-full min-h-12 rounded-md border px-2 py-1.5 text-xs leading-4 shadow-sm ${availabilitySummaryTone(cell.kind)}`}>
                            <div className="flex items-center justify-between gap-2">
                              <span className="font-semibold">{cell.label}</span>
                              <span className="text-[11px] opacity-75">{minutesToTime(hour)}</span>
                            </div>
                            {cell.detail && <div className="mt-0.5 line-clamp-2 opacity-80">{cell.detail}</div>}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        ) : (
          <div className="mt-4 overflow-hidden rounded-lg border border-slate-200">
            <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
              {["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].map((weekday) => (
                <div key={`month-head-${weekday}`} className="border-l border-slate-200 px-3 py-2 text-xs font-semibold uppercase text-slate-500 first:border-l-0">
                  {weekday}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 bg-white">
              {calendarMonthDates.map((date) => {
                const summary = calendarDaySummary(date);
                const isMuted = new Date(`${date}T00:00:00`).getMonth() !== calendarActiveMonth;
                const dayNumber = new Intl.DateTimeFormat("de-DE", { day: "2-digit" }).format(new Date(`${date}T00:00:00`));
                return (
                  <div key={`month-cell-${date}`} className={`min-h-32 border-l border-t border-slate-100 p-2 first:border-l-0 ${isMuted ? "bg-slate-50 text-slate-400" : "bg-white text-slate-900"}`}>
                    <div className="flex items-center justify-between gap-2">
                      <span className="text-sm font-semibold">{dayNumber}</span>
                      {date === today && <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-semibold text-white">Heute</span>}
                    </div>
                    <div className="mt-3 grid gap-1 text-[11px] font-semibold">
                      {summary.blocked > 0 && <div className="rounded border border-red-200 bg-red-50 px-2 py-1 text-red-700">{summary.blocked} blockiert</div>}
                      {summary.meetings > 0 && <div className="rounded border border-blue-200 bg-blue-50 px-2 py-1 text-blue-700">{summary.meetings} Meeting</div>}
                      {summary.open === 0 && summary.blocked === 0 && summary.meetings === 0 && (
                        <div
                          className="min-h-14 rounded border border-transparent"
                          title="Nicht verfügbar"
                          style={{
                            backgroundImage: "repeating-linear-gradient(135deg, rgba(239, 68, 68, 0.08) 0, rgba(239, 68, 68, 0.08) 6px, rgba(255, 255, 255, 0) 6px, rgba(255, 255, 255, 0) 12px)",
                          }}
                        />
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
        )}
        {!workingHours.length && (
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-900">
            Noch keine Arbeitszeiten hinterlegt. Trage unten pro Person reguläre FindMyDoc-Zeiten ein oder nutze „Mo-Fr auswählen“. Erst dann kann das Raster echte freie Zeiten zeigen.
          </div>
        )}
      </section>
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-semibold text-slate-950">Arbeitszeiten pflegen</h2>
        <p className="mt-1 text-sm text-slate-500">Regelmäßige FindMyDoc-Zeit pro Person und mehrere Wochentage in einem Schritt.</p>
        <div className="mt-4 grid gap-3">
          <CustomSelect value={normalizedWorkProfileId} onChange={setWorkProfileId} disabled={!canManageAvailability || !profileOptions.length || pending} className="h-9 text-sm" options={profileOptions.length ? profileOptions : [{ value: "", label: "Kein Profil" }]} />
          <div className="grid gap-2">
            <div className="flex flex-wrap gap-2">
              <button type="button" onClick={() => setWorkWeekdays(["1", "2", "3", "4", "5"])} className="h-8 rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                Mo-Fr auswählen
              </button>
              <button type="button" onClick={() => setWorkWeekdays(["6", "0"])} className="h-8 rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                Wochenende
              </button>
              <button type="button" onClick={() => setWorkWeekdays(["0"])} className="h-8 rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                Nur Sonntag
              </button>
              <button type="button" onClick={() => setWorkWeekdays(weekdayOptions.map((item) => item.value))} className="h-8 rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                Alle Tage
              </button>
            </div>
            <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
              {weekdayOptions.map((option) => (
                <button
                  key={`work-weekday-${option.value}`}
                  type="button"
                  onClick={() => toggleWorkWeekday(option.value)}
                  className={`h-9 rounded-md border px-3 text-left text-xs font-semibold ${
                    workWeekdays.includes(option.value)
                      ? "border-blue-300 bg-blue-50 text-blue-700"
                      : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50"
                  }`}
                >
                  {option.label}
                </button>
              ))}
            </div>
          </div>
          <div className="grid grid-cols-2 gap-2">
            <CustomSelect value={workStart} onChange={setWorkStart} disabled={pending} className="h-9 text-sm" options={timeOptions} aria-label="Arbeitszeit Start" />
            <CustomSelect value={workEnd} onChange={setWorkEnd} disabled={pending} className="h-9 text-sm" options={timeOptions} aria-label="Arbeitszeit Ende" />
          </div>
          <button type="button" onClick={addWorkingHours} disabled={pending || !normalizedWorkProfileId || !workWeekdays.length || timeToMinutes(workStart) >= timeToMinutes(workEnd)} className="h-9 rounded-md bg-blue-600 px-3 text-sm font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-50">
            Arbeitszeiten für {workWeekdays.length || 0} Tag{workWeekdays.length === 1 ? "" : "e"} speichern
          </button>
        </div>
      </section>
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-semibold text-slate-950">Blocker eintragen</h2>
        <p className="mt-1 text-sm text-slate-500">Arbeit, Urlaub, Krankheit oder sonstige Nicht-Verfügbarkeit.</p>
        <div className="mt-4 grid gap-3">
          <CustomSelect value={normalizedBlockerProfileId} onChange={setBlockerProfileId} disabled={!canManageAvailability || !profileOptions.length || pending} className="h-9 text-sm" options={profileOptions.length ? profileOptions : [{ value: "", label: "Kein Profil" }]} />
          <CustomSelect value={blockerType} onChange={(value) => setBlockerType(value as AvailabilityEntry["type"])} disabled={pending} className="h-9 text-sm" options={blockerTypeOptions} />
          <div className="grid grid-cols-2 gap-2">
            <CustomDatePicker value={blockerStartDate} onChange={setBlockerStartDate} disabled={pending} className="h-9 text-sm" aria-label="Blocker Startdatum" />
            <CustomDatePicker value={blockerEndDate} onChange={setBlockerEndDate} disabled={pending} className="h-9 text-sm" aria-label="Blocker Enddatum" />
          </div>
          <label className="flex items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-semibold text-slate-700">
            <input type="checkbox" checked={blockerAllDay} onChange={(event) => setBlockerAllDay(event.target.checked)} className="h-4 w-4 rounded border-slate-300" />
            Ganztägig blockieren
          </label>
          <div className="grid grid-cols-2 gap-2">
            <CustomSelect value={blockerStartTime} onChange={setBlockerStartTime} disabled={pending || blockerAllDay} className="h-9 text-sm" options={timeOptions} aria-label="Blocker Startzeit" />
            <CustomSelect value={blockerEndTime} onChange={setBlockerEndTime} disabled={pending || blockerAllDay} className="h-9 text-sm" options={timeOptions} aria-label="Blocker Endzeit" />
          </div>
          <textarea value={blockerNote} onChange={(event) => setBlockerNote(event.target.value)} placeholder="Grund oder Kontext" className="min-h-20 rounded-md border border-slate-200 px-3 py-2 text-sm text-slate-800 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100" />
          <button type="button" onClick={addBlocker} disabled={pending || !normalizedBlockerProfileId || (!blockerAllDay && timeToMinutes(blockerStartTime) >= timeToMinutes(blockerEndTime))} className="h-9 rounded-md bg-amber-600 px-3 text-sm font-semibold text-white hover:bg-amber-700 disabled:cursor-not-allowed disabled:opacity-50">
            Blocker speichern
          </button>
        </div>
      </section>
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm xl:col-span-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-950">Vorgemerkte Meetings</h2>
            <p className="mt-1 text-sm text-slate-500">Interne Termine aus dem Meeting Finder inklusive Teilnehmerstatus. Abgesagte Meetings blockieren keine Slots mehr.</p>
          </div>
          <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-600">{plannedMeetings.length} aktiv</span>
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          {plannedMeetings.map((meeting) => {
            const attendance = attendanceForMeeting(meeting);
            const presentCount = attendance.filter((item) => item.status === "present").length;
            const excusedCount = attendance.filter((item) => item.status === "excused" || item.status === "late_excused").length;
            const openCount = attendance.filter((item) => item.status === "pending").length;
            const sprint = data.sprints.find((item) => item.id === meeting.sprintId);
            const attendees = attendance.map((item) => profileNameById.get(item.profileId) || item.profileId);
            return (
              <article key={meeting.id} className="rounded-lg border border-slate-100 bg-slate-50 p-3 text-sm">
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="font-semibold text-slate-950">{meeting.title}</div>
                    <div className="mt-1 text-xs text-slate-500">{formatMeetingDateTime(meeting.meetingAt)} · {sprint?.name || meeting.sprintId}</div>
                  </div>
                  <span className="rounded-full border border-emerald-200 bg-white px-2 py-0.5 text-xs font-semibold text-emerald-700">{meeting.status === "done" ? "Erledigt" : "Geplant"}</span>
                </div>
                {meeting.agenda && <p className="mt-3 rounded-md bg-white px-3 py-2 text-sm leading-6 text-slate-600">{meeting.agenda}</p>}
                <div className="mt-3 flex flex-wrap gap-2 text-xs font-semibold">
                  <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-slate-600">{attendance.length} Teilnehmer</span>
                  <span className="rounded-full border border-emerald-200 bg-white px-2 py-1 text-emerald-700">{presentCount} anwesend</span>
                  <span className="rounded-full border border-amber-200 bg-white px-2 py-1 text-amber-700">{excusedCount} entschuldigt</span>
                  <span className="rounded-full border border-blue-200 bg-white px-2 py-1 text-blue-700">{openCount} offen</span>
                </div>
                <div className="mt-3 text-xs leading-5 text-slate-500">
                  {attendees.length ? `Teilnehmer: ${attendees.join(", ")}` : "Noch keine Teilnehmer hinterlegt."}
                </div>
                {canManageAvailability && meeting.status === "planned" && (
                  <button
                    type="button"
                    onClick={() => onUpdateMeeting(meeting, { status: "cancelled" })}
                    disabled={pending}
                    className="mt-3 h-8 rounded-md border border-red-200 bg-white px-3 text-xs font-semibold text-red-700 hover:bg-red-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Meeting absagen
                  </button>
                )}
              </article>
            );
          })}
          {!plannedMeetings.length && (
            <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500 lg:col-span-2">
              Noch keine aktiven Meetings vorgemerkt. Wähle oben einen Slot und nutze „Intern vormerken“.
            </div>
          )}
        </div>
      </section>
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm xl:col-span-2">
        <h2 className="text-base font-semibold text-slate-950">Kalenderwoche & Blocker</h2>
        <p className="mt-1 text-sm text-slate-500">Die nächsten Tage zeigen Arbeitszeiten, Abwesenheiten und später importierte Google-Kalenderblöcke zusammen.</p>
        <div className="mt-4 grid gap-2 md:grid-cols-2 xl:grid-cols-7">
          {calendarDates.map((date) => {
            const dayEntries = data.availability.filter((entry) => {
              if (entry.type === "working_hours") return entry.weekday === weekdayForDate(date);
              return (!entry.startDate || entry.startDate <= date) && (!entry.endDate || entry.endDate >= date);
            });
            return (
              <div key={date} className="min-h-36 rounded-lg border border-slate-100 bg-slate-50 p-2">
                <div className="text-xs font-semibold text-slate-700">{formatDateLabel(date)}</div>
                <div className="mt-2 grid gap-1">
                  {dayEntries.slice(0, 6).map((entry, index) => (
                    <div key={`${date}-${entry.id}-${entry.profileId}-${entry.weekday ?? entry.startDate}-${index}`} className={`rounded-md border px-2 py-1 text-[11px] leading-4 ${availabilityTone(entry.type, entry.source)}`}>
                      <div className="font-semibold">{profileNameById.get(entry.profileId) || entry.profileId}</div>
                      <div>{availabilityTypeLabel(entry.type)} · {entry.startTime}-{entry.endTime}</div>
                    </div>
                  ))}
                  {!dayEntries.length && <div className="rounded-md border border-dashed border-slate-200 bg-white px-2 py-3 text-center text-xs text-slate-400">Keine Einträge</div>}
                </div>
              </div>
            );
          })}
        </div>
        <div className="mt-4 grid gap-2 lg:grid-cols-2">
          {[...workingHours, ...blockers].slice(0, 16).map((entry, index) => (
            <div key={`${entry.id}-${entry.profileId}-${entry.type}-${entry.weekday ?? entry.startDate}-${entry.startTime}-${index}`} className="flex items-center justify-between gap-3 rounded-md border border-slate-100 px-3 py-2 text-sm">
              <div className="min-w-0">
                <div className="font-semibold text-slate-900">
                  {profileNameById.get(entry.profileId) || entry.profileId} · {availabilityTypeLabel(entry.type)}
                  {entry.source === "google_calendar" ? " · Google Kalender" : ""}
                </div>
                <div className="mt-0.5 truncate text-xs text-slate-500">
                  {entry.type === "working_hours"
                    ? `${weekdayOptions.find((item) => item.value === String(entry.weekday))?.label || "Wochentag"} · ${entry.startTime}-${entry.endTime}`
                    : `${formatDateLabel(entry.startDate)} bis ${formatDateLabel(entry.endDate)} · ${entry.startTime}-${entry.endTime}`}
                  {entry.note ? ` · ${entry.note}` : ""}
                </div>
              </div>
              {(canManageAvailability || entry.profileId === currentProfile?.id) && (
                <button type="button" onClick={() => onDeleteAvailability(entry)} disabled={pending} className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50">
                  Löschen
                </button>
              )}
            </div>
          ))}
          {![...workingHours, ...blockers].length && (
            <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500 lg:col-span-2">
              Noch keine Arbeitszeiten oder Blocker hinterlegt.
            </div>
          )}
        </div>
        <div className="mt-4 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm text-slate-600">
          Kalenderstatus: {googleCalendarBlocks.length} importierte Google-Blöcke, {googleCalendarProfiles.length} Profil(e) für Sync aktiviert. Manuelle Arbeitszeiten bleiben führend; Google-Termine blockieren nur freie Slots.
        </div>
      </section>
    </div>
  );
}

function LegacySettingsOverview({
  data,
  source,
  authAvailable,
  authUserEmail,
  githubProviderTokenAvailable,
  pending,
  feedbackMessage,
  selectedFeedbackId,
  notificationDispatchMessage,
  googleChatStatus,
  sprintPlanningOptions,
  plannedSprintCount,
  onUpdateSprintPlanning,
  onCreateSprintPlan,
  onDispatchNotifications,
  onReconnectGitHub,
  onSyncLinkedGitHubTasks,
  onCreateGitHubIssue,
  onSelectFeedback,
}: {
  data: PlanningData;
  source: "seed" | "supabase";
  authAvailable: boolean;
  authUserEmail: string;
  githubProviderTokenAvailable: boolean;
  pending: boolean;
  feedbackMessage: string;
  selectedFeedbackId: number | null;
  notificationDispatchMessage: string;
  googleChatStatus: GoogleChatStatus | null;
  sprintPlanningOptions: SprintPlanningOptions;
  plannedSprintCount: number;
  onUpdateSprintPlanning: (options: SprintPlanningOptions) => void;
  onCreateSprintPlan: (options: SprintPlanningOptions) => void;
  onDispatchNotifications: () => void;
  onReconnectGitHub: () => void;
  onSyncLinkedGitHubTasks: () => void;
  onCreateGitHubIssue: (task: Task) => void;
  onSelectFeedback: (id: number) => void;
}) {
  const pendingNotifications = data.notificationEvents.filter((event) => event.status === "pending");
  const failedNotifications = data.notificationEvents.filter((event) => event.status === "failed");
  const googleChatDigestNotifications = pendingNotifications.filter((event) => shouldSendToGoogleChatDigest(event.type));
  const inAppOnlyNotifications = pendingNotifications.filter((event) => !shouldSendToGoogleChatDigest(event.type));
  const failedDigestNotifications = failedNotifications.filter((event) => shouldSendToGoogleChatDigest(event.type));
  const recentDeliveries = data.notificationDeliveries.slice(0, 5);
  const googleChatReady = Boolean(googleChatStatus?.ready);
  const googleChatWebhookConfigured = Boolean(googleChatStatus?.webhookConfigured);
  const googleChatDeliveryEnabled = Boolean(googleChatStatus?.deliveryEnabled);
  const selectedFeedback = data.feedbackItems.find((item) => item.id === selectedFeedbackId) || data.feedbackItems[0];
  const openFeedbackCount = data.feedbackItems.filter((item) => item.status === "open").length;
  const githubCreatableTasks = data.tasks.filter((task) => task.taskType === "deliverable" || task.taskType === "proposal");
  const linkedSyncQueue = githubCreatableTasks.filter((task) => hasGitHubIssue(task) && task.githubSyncStatus !== "synced");
  const failedSyncTasks = githubCreatableTasks.filter((task) => task.githubSyncStatus === "failed");
  const appOnlyTasks = githubCreatableTasks.filter((task) => !hasGitHubIssue(task));
  const appOnlyPreviewTasks = appOnlyTasks.slice(0, 12);

  return (
    <div className="grid gap-4 xl:grid-cols-[420px_1fr]">
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-semibold text-slate-950">Systemstatus</h2>
        <div className="mt-4 grid gap-3 text-sm">
          <div className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2">
            <span className="text-slate-500">Datenquelle</span>
            <span className="font-semibold text-slate-900">{source === "supabase" ? "Supabase" : "Seed-Fallback"}</span>
          </div>
          <div className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2">
            <span className="text-slate-500">Supabase ENV</span>
            <span className="font-semibold text-slate-900">{authAvailable ? "gesetzt" : "nicht gesetzt"}</span>
          </div>
          <div className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2">
            <span className="text-slate-500">Session</span>
            <span className="max-w-48 truncate font-semibold text-slate-900">{authUserEmail || "nicht angemeldet"}</span>
          </div>
          <div className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2">
            <span className="text-slate-500">GitHub User-Token</span>
            <span className={`font-semibold ${githubProviderTokenAvailable ? "text-emerald-700" : "text-amber-700"}`}>
              {githubProviderTokenAvailable ? "verfügbar" : "neu anmelden nötig"}
            </span>
          </div>
          {!githubProviderTokenAvailable && authUserEmail && (
            <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-900">
              <div className="font-semibold">GitHub-Verbindung erneuern</div>
              <p className="mt-1 text-xs leading-5">
                Deine Supabase-Session ist aktiv, aber der GitHub-Token für Sync, Kommentare und Anhänge fehlt. Das ist kein App-Logout.
              </p>
              <button
                type="button"
                onClick={onReconnectGitHub}
                disabled={pending}
                className="mt-2 h-8 rounded-md border border-amber-200 bg-white px-3 text-xs font-semibold text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
              >
                GitHub-Rechte erneuern
              </button>
            </div>
          )}
          <div className="flex items-center justify-between rounded-md bg-slate-50 px-3 py-2">
            <span className="text-slate-500">Google Chat</span>
            <span className={`font-semibold ${googleChatReady ? "text-emerald-700" : "text-amber-700"}`}>
              {googleChatReady ? "versandbereit" : "nur gesammelt"}
            </span>
          </div>
        </div>
      </section>
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm xl:col-span-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-950">Production Readiness</h2>
            <p className="mt-1 text-sm text-slate-500">Aktueller Übergang von lokaler App zu GitHub-Actions-Deployment. GitHub Actions ist der einzige manuelle Blocker.</p>
          </div>
          <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700">
            GitHub Actions offen
          </span>
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-3">
          {productionReadinessItems.map((item) => {
            const blocked = item.status === "manuell offen";
            return (
              <div key={item.title} className={`rounded-lg border p-3 text-sm ${blocked ? "border-amber-200 bg-amber-50" : "border-slate-100 bg-slate-50"}`}>
                <div className="flex items-start justify-between gap-3">
                  <h3 className={`font-semibold ${blocked ? "text-amber-950" : "text-slate-950"}`}>{item.title}</h3>
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${blocked ? "border-amber-200 bg-white text-amber-700" : "border-emerald-200 bg-white text-emerald-700"}`}>
                    {item.status}
                  </span>
                </div>
                <p className={`mt-2 leading-5 ${blocked ? "text-amber-800" : "text-slate-600"}`}>{item.description}</p>
              </div>
            );
          })}
        </div>
        <div className="mt-4 rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-sm leading-6 text-blue-800">
          Nächster echter Deployment-Schritt: GitHub Actions Workflow mit den Deploy-Secrets ausführen. Danach laufen Env-Pull, Build und Deploy vollständig über Actions.
        </div>
      </section>
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-semibold text-slate-950">Setup-Checkliste</h2>
        <div className="mt-4 grid gap-2">
          {setupChecks.map((check, index) => (
            <div key={check} className="flex items-center gap-3 rounded-md border border-slate-100 px-3 py-2 text-sm text-slate-700">
              <span className="grid h-6 w-6 place-items-center rounded-md bg-blue-50 text-xs font-semibold text-blue-700">{index + 1}</span>
              {check}
            </div>
          ))}
        </div>
      </section>
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm xl:col-span-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-950">GitHub Sync Queue</h2>
            <p className="mt-1 text-sm text-slate-500">
              App bleibt führend. Verknüpfte Issues werden aktualisiert; App-only-Aufgaben bleiben dauerhaft sichtbar und können später bewusst als GitHub-Issue angelegt werden.
            </p>
          </div>
          <button
            type="button"
            disabled={pending || !linkedSyncQueue.length || !githubProviderTokenAvailable}
            onClick={onSyncLinkedGitHubTasks}
            className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Verknüpfte Issues synchronisieren
          </button>
        </div>
        {!githubProviderTokenAvailable && authUserEmail && (
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            GitHub-Sync ist gesperrt, bis du die GitHub-Rechte erneuerst. Die App-Daten bleiben weiter verfügbar.
          </div>
        )}
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="rounded-md bg-slate-50 px-3 py-2 text-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Sync offen</div>
            <div className="mt-1 text-2xl font-semibold text-slate-950">{linkedSyncQueue.length}</div>
          </div>
          <div className="rounded-md bg-slate-50 px-3 py-2 text-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Fehlgeschlagen</div>
            <div className="mt-1 text-2xl font-semibold text-slate-950">{failedSyncTasks.length}</div>
          </div>
          <div className="rounded-md bg-amber-50 px-3 py-2 text-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-amber-700">GitHub anlegen</div>
            <div className="mt-1 text-2xl font-semibold text-amber-900">{appOnlyTasks.length}</div>
          </div>
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-2">
          <div className="rounded-lg border border-slate-100 bg-slate-50 p-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-slate-950">Aktualisierbare GitHub-Issues</h3>
              <span className="rounded-full bg-white px-2 py-1 text-xs font-semibold text-slate-600">{linkedSyncQueue.length}</span>
            </div>
            <div className="mt-3 grid max-h-64 gap-2 overflow-y-auto pr-1">
              {linkedSyncQueue.slice(0, 8).map((task) => (
                <div key={task.id} className="rounded-md border border-slate-200 bg-white px-3 py-2 text-sm">
                  <div className="line-clamp-1 font-semibold text-slate-900">{task.title}</div>
                  <div className="mt-1 flex flex-wrap gap-2 text-xs text-slate-500">
                    <span>{task.githubIssueNumber ? `#${task.githubIssueNumber}` : "Legacy-Link"}</span>
                    <span>{syncLabel(task.githubSyncStatus)}</span>
                  </div>
                  {task.githubSyncError && <div className="mt-1 line-clamp-2 text-xs text-red-700">{task.githubSyncError}</div>}
                </div>
              ))}
              {!linkedSyncQueue.length && <div className="rounded-md border border-dashed border-slate-200 bg-white px-3 py-4 text-center text-sm text-slate-500">Keine verknüpften Issues warten auf Sync.</div>}
            </div>
          </div>
          <div className="rounded-lg border border-amber-100 bg-amber-50 p-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-sm font-semibold text-amber-950">App-only Aufgaben</h3>
              <span className="rounded-full bg-white px-2 py-1 text-xs font-semibold text-amber-700">{appOnlyTasks.length}</span>
            </div>
            <p className="mt-1 text-xs leading-5 text-amber-800">
              Diese Liste bleibt dauerhaft erhalten. Vorschläge und Deliverables bleiben App-only, bis sie bewusst ins Management-Repo gespiegelt werden.
            </p>
            <div className="mt-3 grid max-h-64 gap-2 overflow-y-auto pr-1">
              {appOnlyPreviewTasks.map((task) => (
                <div key={task.id} className="rounded-md border border-amber-200 bg-white px-3 py-2 text-sm">
                  <div className="flex items-start gap-2">
                    <AlertTriangle size={15} className="mt-0.5 shrink-0 text-amber-500" aria-hidden="true" />
                    <div className="min-w-0 flex-1">
                      <div className="line-clamp-1 font-semibold text-slate-900">{task.title}</div>
                      <div className="mt-1 flex flex-wrap gap-1 text-xs text-slate-500">
                        <span>{task.owner}</span>
                        <span>·</span>
                        <span>{normalizeStatus(task.status)}</span>
                        <span>·</span>
                        <span>{task.priority}</span>
                        <span>·</span>
                        <span>{task.hours}h</span>
                      </div>
                    </div>
                    <button
                      type="button"
                      disabled={pending || task.githubSyncStatus === "pending" || !githubProviderTokenAvailable}
                      onClick={() => onCreateGitHubIssue(task)}
                      className="h-7 shrink-0 rounded-md border border-amber-200 bg-amber-50 px-2 text-xs font-semibold text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      GitHub-Issue anlegen
                    </button>
                  </div>
                </div>
              ))}
              {appOnlyTasks.length > appOnlyPreviewTasks.length && (
                <div className="rounded-md border border-amber-200 bg-white px-3 py-2 text-center text-xs font-semibold text-amber-700">
                  {appOnlyTasks.length - appOnlyPreviewTasks.length} weitere App-only Aufgaben warten auf GitHub-Anlage.
                </div>
              )}
              {!appOnlyTasks.length && (
                <div className="rounded-md border border-dashed border-amber-200 bg-white px-3 py-4 text-center text-sm text-amber-700">
                  Keine App-only Aufgaben ohne GitHub-Issue.
                </div>
              )}
            </div>
            {!githubProviderTokenAvailable && authUserEmail && (
              <p className="mt-3 rounded-md border border-amber-200 bg-white px-3 py-2 text-xs leading-5 text-amber-800">
                GitHub-Issues können angelegt werden, sobald die GitHub-Rechte erneuert sind.
              </p>
            )}
          </div>
        </div>
      </section>
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm xl:col-span-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-950">Benachrichtigungscenter</h2>
            <p className="mt-1 text-sm text-slate-500">Feedback-Eingang für Bugs und Feature-Wünsche mit Absender, Kontextseite und Detailtext.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-600">{openFeedbackCount} Feedback offen</span>
            <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700">{googleChatDigestNotifications.length} im Chat-Ausgang</span>
          </div>
        </div>
        {feedbackMessage && (
          <p className="mt-3 rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-800">{feedbackMessage}</p>
        )}
        <div className="mt-4 grid min-w-0 gap-4 xl:grid-cols-[minmax(320px,420px)_minmax(0,1fr)]">
          <div className="min-w-0 rounded-lg border border-slate-100 bg-slate-50 p-3">
            <div className="mb-3 flex items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-950">Feedback-Eingang</h3>
                <p className="mt-0.5 text-xs text-slate-500">Neue Bugs und Verbesserungen aus dem Team.</p>
              </div>
              <span className="rounded-full bg-white px-2 py-1 text-xs font-semibold text-slate-600">{data.feedbackItems.length}</span>
            </div>
            <div className="grid max-h-96 min-w-0 gap-2 overflow-y-auto pr-1">
              {data.feedbackItems.map((item) => {
                const reporter = data.profiles.find((profile) => profile.id === item.profileId)?.name || item.profileId || "Unbekannt";
                const active = selectedFeedback?.id === item.id;
                return (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => onSelectFeedback(item.id)}
                    className={`min-w-0 rounded-md border px-3 py-2 text-left text-sm transition ${active ? "border-blue-200 bg-blue-50 shadow-sm" : "border-slate-200 bg-white hover:border-blue-100 hover:bg-blue-50/40"}`}
                  >
                    <div className="flex items-center justify-between gap-2">
                      <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${item.type === "bug" ? "border-red-200 bg-red-50 text-red-700" : "border-violet-200 bg-violet-50 text-violet-700"}`}>
                        {item.type === "bug" ? "Bug" : "Feature"}
                      </span>
                      <span className="shrink-0 text-xs font-semibold text-slate-500">{item.severity}</span>
                    </div>
                    <div className="mt-2 line-clamp-2 break-words font-semibold text-slate-900">{item.title}</div>
                    <div className="mt-1 truncate text-xs text-slate-500">{reporter} · {formatDate(item.createdAt)}</div>
                  </button>
                );
              })}
              {!data.feedbackItems.length && <div className="grid min-h-48 place-items-center rounded-md border border-dashed border-slate-200 bg-white px-3 py-8 text-center text-sm text-slate-500">Noch kein Feedback erfasst.</div>}
            </div>
          </div>
          <div className="min-w-0 rounded-lg border border-slate-100 bg-slate-50 p-3">
            {selectedFeedback ? (
              <div className="grid min-w-0 gap-3 text-sm">
                <div className="min-w-0">
                  <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Detail</div>
                  <h3 className="mt-1 break-words text-base font-semibold text-slate-950">{selectedFeedback.title}</h3>
                </div>
                <div className="flex flex-wrap gap-2">
                  <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700">{selectedFeedback.status}</span>
                  <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700">{selectedFeedback.severity}</span>
                  <span className="rounded-full border border-slate-200 bg-white px-2 py-1 text-xs font-semibold text-slate-700">{selectedFeedback.type === "bug" ? "Bug" : "Feature-Wunsch"}</span>
                </div>
                <div className="rounded-md border border-slate-200 bg-white p-3">
                  <p className="whitespace-pre-wrap break-words leading-6 text-slate-700">{selectedFeedback.description}</p>
                </div>
                {selectedFeedback.pageUrl && (
                  <div className="rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-xs text-blue-700">
                    <span className="font-semibold text-blue-900">Kontextseite: </span>
                    <span className="break-all">{selectedFeedback.pageUrl}</span>
                  </div>
                )}
              </div>
            ) : (
              <div className="grid min-h-48 place-items-center rounded-md border border-dashed border-slate-200 bg-white px-4 text-center text-sm text-slate-500">Feedback auswählen, um Details zu sehen.</div>
            )}
          </div>
        </div>
      </section>
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm xl:col-span-2">
        <div className="flex flex-wrap items-start justify-between gap-4">
          <div className="min-w-0 flex-1">
            <h2 className="text-base font-semibold text-slate-950">Sprint-Planung</h2>
            <p className="mt-1 text-sm text-slate-500">Legt Sprint-Zeiträume aus Startdatum und Rhythmus fest. Beispiel: 01.06.2026 plus 2 Wochen ergibt 01.06.-14.06., danach 15.06.-28.06.</p>
          </div>
          <button
            type="button"
            disabled={pending || plannedSprintCount === 0}
            onClick={() => onCreateSprintPlan(sprintPlanningOptions)}
            className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {plannedSprintCount > 0 ? `${plannedSprintCount} Änderung${plannedSprintCount === 1 ? "" : "en"} anwenden` : "Plan aktuell"}
          </button>
        </div>
        <div className="mt-4 grid w-full gap-4 sm:grid-cols-2 lg:grid-cols-3 2xl:grid-cols-6">
          <div className="grid min-w-0 gap-1 text-xs font-semibold text-slate-500">
            Namenslogik
            <div className="flex h-9 w-full min-w-0 items-center rounded-md border border-slate-200 bg-slate-50 px-2 text-sm font-semibold text-slate-900">
              Sprint + Nummer
            </div>
          </div>
          <label className="grid min-w-0 gap-1 text-xs font-semibold text-slate-500">
            Erste Sprint-Nr.
            <input
              type="number"
              min={1}
              value={sprintPlanningOptions.firstSprintNumber}
              onChange={(event) => onUpdateSprintPlanning({ ...sprintPlanningOptions, firstSprintNumber: Number(event.target.value) })}
              className="h-9 w-full min-w-0 rounded-md border border-slate-200 bg-white px-2 text-sm font-normal text-slate-900"
            />
          </label>
          <label className="grid min-w-0 gap-1 text-xs font-semibold text-slate-500">
            Startdatum
            <CustomDatePicker
              value={sprintPlanningOptions.anchorStartDate}
              onChange={(value) => onUpdateSprintPlanning({ ...sprintPlanningOptions, anchorStartDate: value })}
              className="h-9 w-full text-sm"
            />
          </label>
          <label className="grid min-w-0 gap-1 text-xs font-semibold text-slate-500">
            Rhythmus (Wochen)
            <input
              type="number"
              min={1}
              max={12}
              value={sprintPlanningOptions.rhythmWeeks}
              onChange={(event) => onUpdateSprintPlanning({ ...sprintPlanningOptions, rhythmWeeks: Number(event.target.value) })}
              className="h-9 w-full min-w-0 rounded-md border border-slate-200 bg-white px-2 text-sm font-normal text-slate-900"
            />
          </label>
          <label className="grid min-w-0 gap-1 text-xs font-semibold text-slate-500">
            Wochen voraus
            <input
              type="number"
              min={1}
              max={52}
              value={sprintPlanningOptions.horizonWeeks}
              onChange={(event) => onUpdateSprintPlanning({ ...sprintPlanningOptions, horizonWeeks: Number(event.target.value) })}
              className="h-9 w-full min-w-0 rounded-md border border-slate-200 bg-white px-2 text-sm font-normal text-slate-900"
            />
          </label>
          <label className="grid min-w-0 gap-1 text-xs font-semibold text-slate-500">
            Bis Sprint-Nr.
            <input
              type="number"
              min={0}
              value={sprintPlanningOptions.targetSprintNumber || ""}
              onChange={(event) => onUpdateSprintPlanning({ ...sprintPlanningOptions, targetSprintNumber: Number(event.target.value) })}
              className="h-9 w-full min-w-0 rounded-md border border-slate-200 bg-white px-2 text-sm font-normal text-slate-900"
              placeholder="optional"
            />
          </label>
        </div>
      </section>
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm xl:col-span-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
            <div>
              <h2 className="text-base font-semibold text-slate-950">Notification-Ausgang</h2>
              <p className="mt-1 text-sm text-slate-500">Google Chat bekommt nur wichtige Sammelmeldungen. Persönliche Hinweise bleiben oben in der Notification-Inbox.</p>
            </div>
          <button
            type="button"
            disabled={pending || !googleChatReady || !googleChatDigestNotifications.length}
            onClick={onDispatchNotifications}
            className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
              Digest senden
          </button>
        </div>
        {!googleChatReady && (
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm leading-6 text-amber-800">
            Operative Event Messages bleiben in der App. Google Chat ist nur für Release-Details gedacht, wenn der Versand bewusst aktiviert ist. Webhook: {googleChatWebhookConfigured ? "gesetzt" : "fehlt"} · Versandschalter: {googleChatDeliveryEnabled ? "aktiv" : "inaktiv"}. Für echten Versand braucht die Umgebung `GOOGLE_CHAT_WEBHOOK_URL` und `GOOGLE_CHAT_DELIVERY_ENABLED=true`.
          </div>
        )}
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="rounded-md bg-slate-50 px-3 py-2 text-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Chat-Digest</div>
            <div className="mt-1 text-2xl font-semibold text-slate-950">{googleChatDigestNotifications.length}</div>
          </div>
          <div className="rounded-md bg-slate-50 px-3 py-2 text-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Nur In-App</div>
            <div className="mt-1 text-2xl font-semibold text-slate-950">{inAppOnlyNotifications.length}</div>
          </div>
          <div className="rounded-md bg-slate-50 px-3 py-2 text-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Fehler</div>
            <div className="mt-1 text-2xl font-semibold text-slate-950">{failedDigestNotifications.length}</div>
          </div>
        </div>
        {notificationDispatchMessage && (
          <p className="mt-3 rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-800">{notificationDispatchMessage}</p>
        )}
        <div className="mt-4 grid gap-2">
          {googleChatDigestNotifications.slice(0, 5).map((event) => (
            <div key={event.id} className="flex items-center justify-between gap-3 rounded-md border border-slate-100 px-3 py-2 text-sm">
              <span className="min-w-0">
                <span className="block truncate font-medium text-slate-800">{event.title}</span>
                <span className="text-xs text-slate-500">{event.type} · {event.entityType} · {notificationChannelLabel(event.type)}</span>
              </span>
              <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700">pending</span>
            </div>
          ))}
          {!googleChatDigestNotifications.length && <div className="rounded-md border border-dashed border-slate-200 px-3 py-4 text-center text-sm text-slate-500">Keine Benachrichtigung wartet auf den Google-Chat-Digest.</div>}
        </div>
        {inAppOnlyNotifications.length > 0 && (
          <div className="mt-3 rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
            {inAppOnlyNotifications.length} pending Hinweis{inAppOnlyNotifications.length === 1 ? "" : "e"} bleiben bewusst nur in der In-App-Inbox.
          </div>
        )}
        {recentDeliveries.length > 0 && (
          <div className="mt-4 grid gap-2">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Letzte Zustellversuche</div>
            {recentDeliveries.map((delivery) => (
              <div key={delivery.id} className="flex items-center justify-between gap-3 rounded-md bg-slate-50 px-3 py-2 text-xs text-slate-600">
                <span>{delivery.channel} · Event #{delivery.eventId} · {delivery.target || "kein Ziel"}</span>
                <span className="font-semibold">{delivery.status}</span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

function AuthControl({
  user,
  error,
  busy,
  githubProviderTokenAvailable = true,
  onSignIn,
  onSignOut,
  variant = "header",
}: {
  user: User | null;
  error: string;
  busy: boolean;
  githubProviderTokenAvailable?: boolean;
  onSignIn: () => void;
  onSignOut: () => void;
  variant?: "header" | "gate";
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const githubLogin = getUserMetadataString(user, "user_name") || getUserMetadataString(user, "preferred_username");
  const avatarUrl = getUserMetadataString(user, "avatar_url");
  const displayName = getUserMetadataString(user, "full_name") || getUserMetadataString(user, "name") || githubLogin || user?.email || "";

  useEffect(() => {
    if (!open) return;

    const closeOnOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };

    window.addEventListener("pointerdown", closeOnOutside);
    return () => window.removeEventListener("pointerdown", closeOnOutside);
  }, [open]);

  if (!user) {
    return (
      <div className={variant === "gate" ? "grid gap-3" : ""}>
        {variant === "gate" && (
          <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs leading-5 text-slate-600">
            Rollen und Zugriff werden nach dem Login über dein gemapptes GitHub-Profil geprüft.
          </div>
        )}
        {error && variant === "gate" && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
        <button
          type="button"
          onClick={onSignIn}
          disabled={busy}
          className={variant === "gate"
            ? "inline-flex h-11 w-full items-center justify-center gap-2 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white shadow-sm transition hover:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-60"
            : "inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"}
        >
          <Users size={17} />
          {busy ? "GitHub wird geöffnet..." : "Mit GitHub anmelden"}
        </button>
      </div>
    );
  }

  if (variant === "gate") {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <div className="flex min-w-0 items-center gap-3">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt="" className="h-10 w-10 shrink-0 rounded-full border border-slate-200 bg-white object-cover" />
          ) : (
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-slate-200 bg-white text-sm font-semibold text-slate-700">
              {displayName.slice(0, 1).toUpperCase() || "?"}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-slate-950">{displayName}</div>
            <div className="truncate text-xs text-slate-500">{githubLogin ? `@${githubLogin}` : user.email || "GitHub angemeldet"}</div>
          </div>
          <button
            type="button"
            onClick={onSignOut}
            disabled={busy}
            className="h-9 shrink-0 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Abmelden
          </button>
        </div>
        {!githubProviderTokenAvailable && (
          <div className="mt-3 rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
            <div className="font-semibold">GitHub-Rechte fehlen</div>
            <p className="mt-1">Die App-Session ist aktiv. Für GitHub-Sync, Kommentare und Anhänge muss GitHub einmal neu autorisiert werden.</p>
            <button
              type="button"
              onClick={onSignIn}
              disabled={busy}
              className="mt-2 h-8 rounded-md border border-amber-200 bg-white px-3 text-xs font-semibold text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
            >
              GitHub-Rechte erneuern
            </button>
          </div>
        )}
      </div>
    );
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
        }}
        aria-label="Account-Menü öffnen"
        className="grid h-9 w-9 place-items-center rounded-full border border-slate-200 bg-white p-0.5 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
      >
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarUrl}
            alt=""
            className="h-8 w-8 rounded-full bg-slate-100 object-cover"
          />
        ) : (
          <span className="grid h-8 w-8 place-items-center rounded-full bg-slate-100 text-xs font-semibold text-slate-700">
            {displayName.slice(0, 1).toUpperCase() || "?"}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-30 w-80 rounded-lg border border-slate-200 bg-white p-4 text-sm shadow-xl">
          <div className="grid gap-4">
            <div className="flex min-w-0 items-center gap-3">
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={avatarUrl}
                  alt=""
                  className="h-11 w-11 shrink-0 rounded-full border border-slate-200 bg-slate-100 object-cover"
                />
              ) : (
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-slate-100 text-sm font-semibold text-slate-600">
                  {displayName.slice(0, 1).toUpperCase() || "?"}
                </div>
              )}
              <div className="min-w-0">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Angemeldet mit GitHub</div>
                <div className="mt-1 truncate font-semibold text-slate-950">{displayName}</div>
                {githubLogin && <div className="truncate text-xs text-slate-500">@{githubLogin}</div>}
                {user.email && <div className="truncate text-xs text-slate-500">{user.email}</div>}
              </div>
            </div>
            {!githubProviderTokenAvailable && (
              <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
                <div className="font-semibold">GitHub-Rechte fehlen</div>
                <p className="mt-1">Sync, Kommentare und Anhänge brauchen eine neue GitHub-Autorisierung.</p>
                <button
                  type="button"
                  onClick={onSignIn}
                  disabled={busy}
                  className="mt-2 h-8 rounded-md border border-amber-200 bg-white px-3 text-xs font-semibold text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  GitHub-Rechte erneuern
                </button>
              </div>
            )}
            <button
              type="button"
              onClick={onSignOut}
              disabled={busy}
              className="h-9 rounded-md bg-slate-900 px-3 text-sm font-semibold text-white disabled:opacity-60"
            >
              Abmelden
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

function getUserMetadataString(user: User | null, key: string) {
  const value = user?.user_metadata?.[key];
  return typeof value === "string" ? value : "";
}

function FeedbackDialog({
  pending,
  onClose,
  onSubmit,
}: {
  pending: boolean;
  onClose: () => void;
  onSubmit: (draft: FeedbackDraft) => void;
}) {
  const [draft, setDraft] = useState<FeedbackDraft>({
    type: "bug",
    severity: "P2",
    title: "",
    description: "",
    pageUrl: typeof window === "undefined" ? "" : window.location.href,
  });
  const canSubmit = draft.title.trim().length >= 3 && draft.description.trim().length >= 10;

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/30 px-4 py-6">
      <form
        className="w-full max-w-xl overflow-hidden rounded-lg border border-slate-200 bg-white shadow-2xl"
        onSubmit={(event) => {
          event.preventDefault();
          if (canSubmit) onSubmit(draft);
        }}
      >
        <div className="flex items-start justify-between gap-3 border-b border-slate-200 px-5 py-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Team-Feedback</div>
            <h2 className="mt-1 text-lg font-semibold text-slate-950">Bug oder Feature-Wunsch melden</h2>
          </div>
          <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50" aria-label="Feedback schließen">
            <X size={16} />
          </button>
        </div>
        <div className="grid gap-4 p-5">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-xs font-semibold text-slate-500">
              Typ
              <CustomSelect
                value={draft.type}
                onChange={(value) => setDraft((current) => ({ ...current, type: value as FeedbackDraft["type"] }))}
                className="h-9 text-sm"
                options={[{ value: "bug", label: "Bug" }, { value: "feature", label: "Feature-Wunsch" }]}
              />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-500">
              Priorität
              <CustomSelect
                value={draft.severity}
                onChange={(value) => setDraft((current) => ({ ...current, severity: value as FeedbackDraft["severity"] }))}
                className="h-9 text-sm"
                options={["P0", "P1", "P2", "P3"].map((value) => ({ value, label: value }))}
              />
            </label>
          </div>
          <label className="grid gap-1 text-xs font-semibold text-slate-500">
            Titel
            <input value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} className="h-10 rounded-md border border-slate-200 px-3 text-sm font-normal text-slate-900 outline-none focus:border-blue-400" placeholder="Kurz beschreiben, was aufgefallen ist" />
          </label>
          <label className="grid gap-1 text-xs font-semibold text-slate-500">
            Beschreibung
            <textarea value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} className="min-h-32 rounded-md border border-slate-200 p-3 text-sm font-normal leading-6 text-slate-900 outline-none focus:border-blue-400" placeholder="Was ist passiert, was hast du erwartet, und wo genau im Tool?" />
          </label>
          <label className="grid gap-1 text-xs font-semibold text-slate-500">
            Kontextseite
            <input value={draft.pageUrl} onChange={(event) => setDraft((current) => ({ ...current, pageUrl: event.target.value }))} className="h-10 rounded-md border border-slate-200 px-3 text-sm font-normal text-slate-900 outline-none focus:border-blue-400" placeholder="URL oder Bereich im Tool" />
          </label>
        </div>
        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
          <button type="button" onClick={onClose} className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700">Abbrechen</button>
          <button type="submit" disabled={pending || !canSubmit} className="h-9 rounded-md bg-blue-600 px-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">Senden</button>
        </div>
      </form>
    </div>
  );
}

function GanttView({ tasks, packages, sprints, relations, onOpen }: { tasks: Task[]; packages: Package[]; sprints: Sprint[]; relations: TaskRelation[]; onOpen: (task: Task) => void }) {
  const firstTaskStart = tasks
    .map((task) => parseIsoDate(sprints.find((sprint) => sprint.id === task.sprintId)?.startDate || "") || parseIsoDate(task.startDate))
    .filter((date): date is Date => Boolean(date))
    .sort((a, b) => a.getTime() - b.getTime())[0];
  const start = firstTaskStart || parseIsoDate(sprints[0]?.startDate || "") || new Date("2026-05-25T00:00:00");
  const days = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });

  return (
    <div className="overflow-x-auto rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="grid min-w-[1180px] grid-cols-[360px_1fr]">
        <div className="border-r border-slate-200">
          <div className="sticky top-0 border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Aufgabe</div>
          {tasks.map((task) => (
            <button key={task.id} type="button" onClick={() => onOpen(task)} className="flex h-12 w-full items-center gap-2 border-b border-slate-100 px-4 text-left text-sm hover:bg-slate-50">
              <ChevronRight size={14} className="text-slate-400" />
              <span className="min-w-0 truncate font-medium">{task.title}</span>
            </button>
          ))}
        </div>
        <div>
          <div className="grid border-b border-slate-200 bg-slate-50" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(28px, 1fr))` }}>
            {days.map((day) => (
              <div key={day.toISOString()} className="border-r border-slate-100 py-3 text-center text-[10px] font-semibold text-slate-500">
                {day.getDate()}
              </div>
            ))}
          </div>
          {tasks.map((task) => {
            const sprint = sprints.find((item) => item.id === task.sprintId);
            const taskStart = parseIsoDate(sprint?.startDate || "") || parseIsoDate(task.startDate) || start;
            const taskEnd = parseIsoDate(sprint?.endDate || "") || parseIsoDate(task.endDate) || parseIsoDate(task.startDate) || taskStart;
            const left = Math.max(0, Math.floor((taskStart.getTime() - start.getTime()) / 86400000));
            const length = Math.max(1, Math.floor((taskEnd.getTime() - taskStart.getTime()) / 86400000) + 1);
            const pack = packageById(packages, task.packageId);
            return (
              <div key={task.id} className="relative h-12 border-b border-slate-100" style={{ backgroundImage: "linear-gradient(to right, transparent calc(100% - 1px), #eef2f7 1px)", backgroundSize: `${100 / days.length}% 100%` }}>
                <button
                  type="button"
                  onClick={() => onOpen(task)}
                  className="absolute top-3 h-6 rounded bg-blue-500 px-2 text-left text-[11px] font-semibold text-white shadow-sm"
                  style={{ left: `${(left / days.length) * 100}%`, width: `${Math.min(100 - (left / days.length) * 100, (length / days.length) * 100)}%` }}
                  title={`${task.title} · ${pack?.id || ""}`}
                >
                  <span className="block truncate">{task.title}</span>
                </button>
                {taskRelationsFor(task.id, relations).waitsOn.length > 0 && <span className="absolute right-2 top-4 h-2 w-2 rounded-full bg-amber-400" title="Wartet auf andere Aufgabe" />}
                {taskRelationsFor(task.id, relations).blocks.length > 0 && <span className="absolute right-5 top-4 h-2 w-2 rounded-full bg-blue-400" title="Blockiert andere Aufgabe" />}
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

function NewTaskDialog({
  defaults,
  data,
  pending,
  onClose,
  onCreate,
}: {
  defaults: Partial<NewTaskDraft>;
  data: PlanningData;
  pending: boolean;
  onClose: () => void;
  onCreate: (draft: NewTaskDraft) => void;
}) {
  const activeSprint = data.sprints.find((sprint) => sprint.status === "active") || data.sprints[0];
  const defaultOwner = defaults.owner || data.profiles[0]?.name || "";
  const defaultMilestoneId = defaults.milestoneId || data.milestones.find((milestone) => milestone.status === "active")?.id || data.milestones[0]?.id || "";
  const groupCommitments = data.packages.filter((pack) => !defaultMilestoneId || !pack.milestoneId || pack.milestoneId === defaultMilestoneId);
  const [draft, setDraft] = useState<NewTaskDraft>({
    title: defaults.title || "",
    description: defaults.description || "",
    problemStatement: defaults.problemStatement || "",
    intendedOutcome: defaults.intendedOutcome || "",
    scopeConstraints: defaults.scopeConstraints || "",
    acceptanceCriteria: defaults.acceptanceCriteria || "",
    evidenceRequired: defaults.evidenceRequired || "",
    taskType: defaults.taskType || "deliverable",
    parentTaskId: defaults.parentTaskId || "",
    milestoneId: defaultMilestoneId,
    packageId: defaults.packageId || groupCommitments[0]?.id || data.packages[0]?.id || "",
    sprintId: defaults.sprintId || activeSprint?.id || "",
    owner: defaultOwner,
    priority: defaults.priority || "P2",
    status: defaults.status || "Offen",
    workstream: defaults.workstream || "",
    startDate: defaults.startDate || activeSprint?.startDate || "",
    endDate: defaults.endDate || activeSprint?.endDate || "",
    deadline: defaults.deadline || "",
    hours: defaults.hours || 2,
    definitionOfDone: defaults.definitionOfDone || "",
    createGitHubIssue: (defaults.taskType || "deliverable") === "deliverable",
    relationType: defaults.relationType || "blocked_by",
    relatedTaskId: defaults.relatedTaskId || "",
    relationNote: defaults.relationNote || "",
    decisionId: defaults.decisionId || 0,
    decisionLinkNote: defaults.decisionLinkNote || "",
  });
  const parentTask = data.tasks.find((task) => task.id === draft.parentTaskId);
  const visibleGroupCommitments = data.packages.filter((pack) => !draft.milestoneId || !pack.milestoneId || pack.milestoneId === draft.milestoneId);
  const deliverableNeedsStructure = draft.taskType === "deliverable" && (!draft.packageId || !draft.sprintId);
  const invalidDateRange = Boolean(draft.startDate && draft.endDate && draft.startDate > draft.endDate);
  const canCreate = draft.title.trim().length >= 3 && !deliverableNeedsStructure && !invalidDateRange && (draft.taskType !== "sub_issue" || draft.parentTaskId);

  return (
    <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/30 px-4 py-8">
      <form
        className="max-h-[92vh] w-full max-w-2xl overflow-y-auto rounded-lg border border-slate-200 bg-white shadow-2xl"
        onSubmit={(event) => {
          event.preventDefault();
          if (canCreate) onCreate(draft);
        }}
      >
        <div className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Neue Aufgabe</div>
            <h2 className="mt-1 text-lg font-semibold text-slate-950">
              {draft.taskType === "proposal" ? "Aufgabenvorschlag" : draft.taskType === "sub_issue" ? "Sub-Issue" : "Deliverable"}
            </h2>
          </div>
          <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50" aria-label="Dialog schließen">
            ×
          </button>
        </div>

        <div className="grid gap-4 p-5">
          <div className="grid gap-3 sm:grid-cols-4">
            <label className="grid gap-1 text-xs font-semibold text-slate-500">
              Typ
              <CustomSelect
                value={draft.taskType}
                onChange={(value) => setDraft((current) => ({
                  ...current,
                  taskType: value as NewTaskDraft["taskType"],
                  createGitHubIssue: value === "deliverable" ? current.createGitHubIssue : false,
                }))}
                className="h-9 text-sm"
                options={[{ value: "deliverable", label: "Deliverable" }, { value: "proposal", label: "Vorschlag" }, { value: "sub_issue", label: "Sub-Issue" }]}
              />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-500">
              Epic / Meilenstein
              <CustomSelect
                value={draft.milestoneId}
                onChange={(value) => {
                  const milestoneId = value;
                  const firstGroup = data.packages.find((pack) => !milestoneId || !pack.milestoneId || pack.milestoneId === milestoneId);
                  setDraft((current) => ({ ...current, milestoneId, packageId: firstGroup?.id || current.packageId }));
                }}
                className="h-9 text-sm"
                options={[{ value: "", label: "Ohne Epic" }, ...data.milestones.map((milestone) => ({ value: milestone.id, label: milestone.title }))]}
              />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-500">
              Group Commitment
              <CustomSelect value={draft.packageId} onChange={(value) => setDraft((current) => ({ ...current, packageId: value }))} className="h-9 text-sm" options={visibleGroupCommitments.map((pack) => ({ value: pack.id, label: `${pack.id} · ${pack.title}` }))} />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-500">
              Sprint
              <CustomSelect value={draft.sprintId} disabled={draft.taskType !== "deliverable"} onChange={(value) => setDraft((current) => ({ ...current, sprintId: value }))} className="h-9 text-sm" options={data.sprints.map((sprint) => ({ value: sprint.id, label: sprint.name }))} />
            </label>
          </div>

          {draft.taskType === "sub_issue" && (
            <label className="grid gap-1 text-xs font-semibold text-slate-500">
              Deliverable
              <CustomSelect value={draft.parentTaskId} onChange={(value) => setDraft((current) => ({ ...current, parentTaskId: value }))} className="h-9 text-sm" options={[{ value: "", label: "Deliverable auswählen" }, ...data.tasks.filter((task) => task.taskType !== "sub_issue").map((task) => ({ value: task.id, label: task.title }))]} />
              {parentTask && <span className="text-xs font-normal text-slate-500">Sub-Issues unter {parentTask.title} sind nicht score-relevant.</span>}
            </label>
          )}

          {draft.decisionId > 0 && (
            <div className="rounded-lg border border-blue-100 bg-blue-50/50 p-3 text-sm text-blue-950">
              <div className="font-semibold">Wird als Decision-Folgeaufgabe verknüpft</div>
              <p className="mt-1 text-xs leading-5 text-blue-800">{draft.decisionLinkNote || "Diese Aufgabe folgt aus einer Decision."}</p>
            </div>
          )}

          <label className="grid gap-1 text-xs font-semibold text-slate-500">
            Titel
            <input value={draft.title} onChange={(event) => setDraft((current) => ({ ...current, title: event.target.value }))} className="h-10 rounded-md border border-slate-200 px-3 text-sm font-normal text-slate-900 outline-none focus:border-blue-400" placeholder="Konkretes Ergebnis oder Vorschlag" />
          </label>

          <label className="grid gap-1 text-xs font-semibold text-slate-500">
            Beschreibung
            <textarea value={draft.description} onChange={(event) => setDraft((current) => ({ ...current, description: event.target.value }))} className="min-h-24 rounded-md border border-slate-200 p-3 text-sm font-normal leading-6 text-slate-900 outline-none focus:border-blue-400" placeholder="Kontext, Ziel und relevante Hinweise" />
          </label>

          <div className="rounded-lg border border-blue-100 bg-blue-50/40 p-3">
            <div className="text-xs font-semibold uppercase tracking-wide text-blue-700">Template v2</div>
            <p className="mt-1 text-xs leading-5 text-slate-600">Beschreibe das Ziel und die prüfbaren Kriterien, ohne unnötig vorzugeben, wie die Aufgabe umgesetzt werden muss.</p>
          </div>

          <label className="grid gap-1 text-xs font-semibold text-slate-500">
            Problem Statement
            <textarea value={draft.problemStatement} onChange={(event) => setDraft((current) => ({ ...current, problemStatement: event.target.value }))} className="min-h-20 rounded-md border border-slate-200 p-3 text-sm font-normal leading-6 text-slate-900 outline-none focus:border-blue-400" placeholder="Welches Problem löst diese Aufgabe und warum ist sie wichtig?" />
          </label>

          <label className="grid gap-1 text-xs font-semibold text-slate-500">
            Intended Outcome
            <textarea value={draft.intendedOutcome} onChange={(event) => setDraft((current) => ({ ...current, intendedOutcome: event.target.value }))} className="min-h-20 rounded-md border border-slate-200 p-3 text-sm font-normal leading-6 text-slate-900 outline-none focus:border-blue-400" placeholder="Welcher fertige Zustand soll am Ende erreicht sein?" />
          </label>

          <label className="grid gap-1 text-xs font-semibold text-slate-500">
            Scope & Constraints
            <textarea value={draft.scopeConstraints} onChange={(event) => setDraft((current) => ({ ...current, scopeConstraints: event.target.value }))} className="min-h-20 rounded-md border border-slate-200 p-3 text-sm font-normal leading-6 text-slate-900 outline-none focus:border-blue-400" placeholder="Was gehört dazu, was ausdrücklich nicht, und welche Rahmenbedingungen gelten?" />
          </label>

          <label className="grid gap-1 text-xs font-semibold text-slate-500">
            Acceptance Criteria
            <textarea value={draft.acceptanceCriteria} onChange={(event) => setDraft((current) => ({ ...current, acceptanceCriteria: event.target.value }))} className="min-h-28 rounded-md border border-slate-200 p-3 text-sm font-normal leading-6 text-slate-900 outline-none focus:border-blue-400" placeholder="Ein Kriterium pro Zeile. Nur messbare Punkte, die der Owner beeinflussen kann." />
          </label>

          <label className="grid gap-1 text-xs font-semibold text-slate-500">
            Evidence Required
            <textarea value={draft.evidenceRequired} onChange={(event) => setDraft((current) => ({ ...current, evidenceRequired: event.target.value }))} className="min-h-20 rounded-md border border-slate-200 p-3 text-sm font-normal leading-6 text-slate-900 outline-none focus:border-blue-400" placeholder="Welcher Nachweis muss am Ende verlinkt oder kommentiert sein?" />
          </label>

          <div className="grid gap-3 sm:grid-cols-4">
            <label className="grid gap-1 text-xs font-semibold text-slate-500">
              Owner
              <CustomSelect value={draft.owner} onChange={(value) => setDraft((current) => ({ ...current, owner: value }))} className="h-9 text-sm" options={data.profiles.map((profile) => ({ value: profile.name, label: profile.name }))} />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-500">
              Priorität
              <CustomSelect value={draft.priority} onChange={(value) => setDraft((current) => ({ ...current, priority: value }))} className="h-9 text-sm" options={["P0", "P1", "P2", "P3", "P4"].map((priority) => ({ value: priority, label: priority }))} />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-500">
              Status
              <CustomSelect value={draft.status} disabled={draft.taskType === "proposal"} onChange={(value) => setDraft((current) => ({ ...current, status: value }))} className="h-9 text-sm" options={taskStatuses.map((status) => ({ value: status, label: status }))} />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-500">
              Aufwand
              <input type="number" min={0} value={draft.hours} onChange={(event) => setDraft((current) => ({ ...current, hours: Number(event.target.value) }))} className="h-9 rounded-md border border-slate-200 px-2 text-sm font-normal text-slate-800" />
            </label>
          </div>

          <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
            <div className="flex flex-wrap items-start justify-between gap-3">
              <div>
                <div className="text-sm font-semibold text-slate-950">Strukturprüfung</div>
                <p className="mt-1 text-xs leading-5 text-slate-500">
                  Deliverables brauchen Epic, Group Commitment und Sprint. Sub-Issues bleiben unter einem Deliverable und sind nicht score-relevant.
                </p>
              </div>
              <label className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-700">
                <input
                  type="checkbox"
                  checked={draft.createGitHubIssue}
                  disabled={draft.taskType !== "deliverable"}
                  onChange={(event) => setDraft((current) => ({ ...current, createGitHubIssue: event.target.checked }))}
                  className="h-4 w-4 rounded border-slate-300"
                />
                Direkt als GitHub-Issue anlegen
              </label>
            </div>
            {deliverableNeedsStructure && <div className="mt-2 text-xs font-semibold text-amber-700">Für ein Deliverable fehlen noch Sprint oder Group Commitment.</div>}
            {invalidDateRange && <div className="mt-2 text-xs font-semibold text-red-700">Das Startdatum darf nicht nach dem Enddatum liegen.</div>}
          </div>

          <div className="grid gap-3 sm:grid-cols-3">
            <label className="grid gap-1 text-xs font-semibold text-slate-500">
              Workstream
              <input value={draft.workstream} onChange={(event) => setDraft((current) => ({ ...current, workstream: event.target.value }))} className="h-9 rounded-md border border-slate-200 px-2 text-sm font-normal text-slate-800" />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-500">
              Start
              <CustomDatePicker value={draft.startDate} onChange={(value) => setDraft((current) => ({ ...current, startDate: value }))} className="h-9 text-sm" />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-500">
              Ende
              <CustomDatePicker value={draft.endDate} onChange={(value) => setDraft((current) => ({ ...current, endDate: value }))} className="h-9 text-sm" />
            </label>
          </div>

          <label className="grid gap-1 text-xs font-semibold text-slate-500">
            Zieltermin
            <CustomDatePicker value={draft.deadline} onChange={(value) => setDraft((current) => ({ ...current, deadline: value }))} className="h-9 text-sm" />
          </label>

          <div className="rounded-lg border border-slate-200 p-3">
            <div className="text-sm font-semibold text-slate-950">Erste Relationship</div>
            <p className="mt-1 text-xs leading-5 text-slate-500">Optional, wenn diese Aufgabe direkt von einer anderen Aufgabe abhängt oder sie blockiert.</p>
            <div className="mt-3 grid gap-3 sm:grid-cols-3">
              <CustomSelect
                value={draft.relationType}
                onChange={(value) => setDraft((current) => ({ ...current, relationType: value as TaskRelationType }))}
                className="h-9 text-sm"
                options={[
                  { value: "blocked_by", label: "Wartet auf" },
                  { value: "blocks", label: "Blockiert" },
                  { value: "relates_to", label: "Verknüpft mit" },
                ]}
              />
              <CustomSelect
                value={draft.relatedTaskId}
                onChange={(value) => setDraft((current) => ({ ...current, relatedTaskId: value }))}
                className="h-9 text-sm sm:col-span-2"
                options={[
                  { value: "", label: "Keine Relationship" },
                  ...data.tasks.filter((task) => task.taskType !== "sub_issue").map((task) => ({ value: task.id, label: `${task.title} · ${task.owner}` })),
                ]}
              />
            </div>
            <input
              value={draft.relationNote}
              onChange={(event) => setDraft((current) => ({ ...current, relationNote: event.target.value }))}
              className="mt-3 h-9 w-full rounded-md border border-slate-200 px-3 text-sm font-normal text-slate-800 outline-none focus:border-blue-400"
              placeholder="Optionaler Hinweis zur Abhängigkeit"
            />
          </div>

          <label className="grid gap-1 text-xs font-semibold text-slate-500">
            Definition of Done
            <textarea value={draft.definitionOfDone} onChange={(event) => setDraft((current) => ({ ...current, definitionOfDone: event.target.value }))} className="min-h-20 rounded-md border border-slate-200 p-3 text-sm font-normal leading-6 text-slate-900 outline-none focus:border-blue-400" placeholder="Allgemeiner Qualitätsstandard oder DoD-Snapshot für dieses Deliverable" />
          </label>
        </div>

        <div className="flex justify-end gap-2 border-t border-slate-200 px-5 py-4">
          <button type="button" onClick={onClose} className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700">Abbrechen</button>
          <button type="submit" disabled={pending || !canCreate} className="h-9 rounded-md bg-blue-600 px-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50">
            Erstellen
          </button>
        </div>
      </form>
    </div>
  );
}

function RelationshipInfo({ title }: { title: string }) {
  const description = relationshipHelpText(title);
  return (
    <span className="group relative inline-flex">
      <span
        tabIndex={0}
        title={description}
        aria-label={`${title}: ${description}`}
        className="grid h-5 w-5 cursor-help place-items-center rounded-full border border-slate-200 bg-white text-slate-400 outline-none transition hover:border-blue-200 hover:text-blue-600 focus:border-blue-300 focus:text-blue-700"
      >
        <CircleHelp size={13} />
      </span>
      <span className="pointer-events-none absolute left-1/2 top-6 z-20 hidden w-64 -translate-x-1/2 rounded-md border border-slate-200 bg-white px-3 py-2 text-xs font-medium leading-5 text-slate-700 shadow-lg group-hover:block group-focus-within:block">
        {description}
      </span>
    </span>
  );
}

function RelationshipList({
  title,
  rows,
  empty,
  canManage,
  onRemove,
}: {
  title: string;
  rows: Array<{ relation: TaskRelation; task?: Task }>;
  empty: string;
  canManage?: boolean;
  onRemove?: (relation: TaskRelation) => void;
}) {
  return (
    <div className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2">
      <div className="flex items-center justify-between gap-2">
        <span className="inline-flex items-center gap-1.5 text-xs font-semibold text-slate-500">
          {title}
          <RelationshipInfo title={title} />
        </span>
        <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-500">{rows.length}</span>
      </div>
      <div className="mt-2 grid gap-1.5">
        {rows.map(({ relation, task }) => (
          <div key={`${relation.id}-${task?.id || "unknown"}`} className="flex items-start justify-between gap-2 rounded-md bg-white px-2 py-1.5 text-xs">
            <div className="min-w-0">
              <div className="break-words font-semibold text-slate-800">{task?.title || relation.relatedTaskId}</div>
              <div className="mt-0.5 text-slate-500">{task ? `${normalizeStatus(task.status)} · ${task.owner}` : "Aufgabe nicht gefunden"}</div>
              {relation.note && <div className="mt-1 break-words text-slate-500">{relation.note}</div>}
            </div>
            {canManage && onRemove && (
              <button
                type="button"
                onClick={() => onRemove(relation)}
                className="grid h-7 w-7 shrink-0 place-items-center rounded-md border border-slate-200 text-slate-400 hover:border-red-200 hover:bg-red-50 hover:text-red-600"
                aria-label={`${title}-Relationship entfernen`}
              >
                <X size={13} />
              </button>
            )}
          </div>
        ))}
        {!rows.length && <div className="text-xs text-slate-500">{empty}</div>}
      </div>
    </div>
  );
}

function TaskDetailPanel({
  task,
  pack,
  comments,
  externalComments,
  activities,
  commentImportNotice,
  commentImportPending,
  blockers,
  subIssues,
  teamProfiles,
  packages,
  sprints,
  milestones,
  decisions,
  decisionTaskLinks,
  focusItems,
  canManageTaskMeta,
  allTasks,
  relations,
  pending,
  githubProviderTokenAvailable,
  onClose,
  onUpdate,
  onAddComment,
  onUploadAttachment,
  onImportGitHubComments,
  onReportBlocker,
  onCreateSubIssue,
  onReconnectGitHub,
  onSyncGitHub,
  onAddRelation,
  onRemoveRelation,
}: {
  task: Task;
  pack?: Package;
  comments: TaskComment[];
  externalComments: TaskExternalComment[];
  activities: TaskActivity[];
  commentImportNotice: string;
  commentImportPending: boolean;
  blockers: TaskBlocker[];
  subIssues: Task[];
  teamProfiles: Profile[];
  packages: Package[];
  sprints: Sprint[];
  milestones: Milestone[];
  decisions: PlanningData["decisions"];
  decisionTaskLinks: DecisionTaskLink[];
  focusItems: TaskFocusItem[];
  canManageTaskMeta: boolean;
  allTasks: Task[];
  relations: TaskRelation[];
  pending: boolean;
  githubProviderTokenAvailable: boolean;
  onClose: () => void;
  onUpdate: (patch: Partial<Task>) => void;
  onAddComment: (comment: string) => void;
  onUploadAttachment: (file: File) => Promise<string>;
  onImportGitHubComments: () => void;
  onReportBlocker: (payload: { reason: string; impact: string; needsHelpFrom: string }) => void;
  onCreateSubIssue: () => void;
  onReconnectGitHub: () => void;
  onSyncGitHub: (options?: { createIfMissing?: boolean }) => void;
  onAddRelation: (payload: { relationType: TaskRelationType; relatedTaskId: string; note: string }) => void;
  onRemoveRelation: (relation: TaskRelation) => void;
}) {
  const [blockerDraft, setBlockerDraft] = useState({ reason: "", impact: "", needsHelpFrom: "" });
  const [relationDraft, setRelationDraft] = useState<{ relationType: TaskRelationType; relatedTaskId: string; note: string }>({
    relationType: "blocked_by",
    relatedTaskId: "",
    note: "",
  });
  const profileName = (profileId: string) => teamProfiles.find((profile) => profile.id === profileId)?.name || profileId || "Unbekannt";
  const ownerProfile = teamProfiles.find((profile) => profile.name === task.owner || profile.id === task.owner);
  const creatorProfile = teamProfiles.find((profile) => profile.name === task.createdBy || profile.id === task.createdBy)
    || teamProfiles.find((profile) => profile.platformRole === "ceo")
    || ownerProfile;
  const currentPackage = packages.find((item) => item.id === task.packageId) || pack;
  const currentSprint = sprints.find((item) => item.id === task.sprintId);
  const currentMilestone = milestones.find((item) => item.id === task.milestoneId);
  const linkedDecisions = decisionTaskLinks
    .filter((link) => link.taskId === task.id)
    .map((link) => ({ link, decision: decisions.find((decision) => decision.id === link.decisionId) }))
    .filter((item) => item.decision);
  const linkedFocusItems = focusItems
    .filter((item) => item.taskId === task.id)
    .sort((left, right) => right.focusDate.localeCompare(left.focusDate) || left.position - right.position)
    .slice(0, 5);
  const statusOptions = canManageTaskMeta
    ? taskStatuses
    : normalizeStatus(task.status) === "Nacharbeit"
      ? (["In Arbeit", "Review", "Blockiert"] as TaskStatus[])
      : taskStatuses.filter((status) => status !== "Erledigt");
  const updatePackage = (packageId: string) => {
    const nextPackage = packages.find((item) => item.id === packageId);
    onUpdate({ packageId, milestoneId: nextPackage?.milestoneId || task.milestoneId });
  };
  const updateMilestone = (milestoneId: string) => {
    const nextPackage = packages.find((item) => !milestoneId || !item.milestoneId || item.milestoneId === milestoneId);
    onUpdate({ milestoneId, packageId: nextPackage?.id || task.packageId });
  };
  const canSyncExistingGitHubIssue = hasGitHubIssue(task);
  const relationshipGroups = relationshipRows(task, allTasks, relations);
  const relationTargetOptions = allTasks
    .filter((item) => item.id !== task.id && item.taskType !== "sub_issue")
    .map((item) => ({ value: item.id, label: `${item.title} · ${item.owner}` }));

  return (
    <>
    <button
      type="button"
      className="fixed inset-0 z-30 cursor-default bg-slate-950/[0.03]"
      aria-label="Detailpanel schließen"
      onClick={onClose}
    />
    <aside className="fixed inset-y-0 right-0 z-40 w-full max-w-[920px] overflow-y-auto border-l border-slate-200 bg-white shadow-2xl">
      <div className="sticky top-0 z-10 border-b border-slate-200 bg-white px-5 py-4">
        <div className="flex items-start justify-between gap-4">
          <div className="min-w-0">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Aufgabendetails</div>
            <h2 className="mt-1 break-words text-xl font-semibold leading-7 text-slate-950">{task.title}</h2>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <span className={`rounded-full border px-2 py-1 text-xs font-semibold ${statusTone(normalizeStatus(task.status))}`}>{normalizeStatus(task.status)}</span>
              <span className={`rounded-full border px-2 py-1 text-xs font-semibold ${priorityTone(task.priority)}`}>{task.priority}</span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-700">
                <Users size={13} />
                {task.owner}
              </span>
              <span className="inline-flex items-center gap-1.5 rounded-full border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-700">
                <CalendarDays size={13} />
                {dateRange(task)}
              </span>
            </div>
          </div>
          <div className="flex shrink-0 items-center gap-2">
            <Link
              href={`/tasks/${task.id}?view=full`}
              className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
            >
              <Maximize2 size={14} />
              Große Ansicht
            </Link>
            <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50" aria-label="Detailpanel schließen">
              <X size={16} />
            </button>
          </div>
        </div>
      </div>

      <div className="grid gap-5 p-5 lg:grid-cols-[minmax(0,1fr)_300px]">
        <main className="grid min-w-0 gap-4">
          <section className="rounded-lg border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-950">Aufgabenbrief</h3>
            <div className="mt-4 grid gap-4">
              <div>
                <h4 className="text-xs font-semibold text-slate-500">Problem Statement</h4>
                <p className="mt-2 whitespace-pre-wrap break-words rounded-md bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-700">
                  {task.problemStatement || task.description || "Kein Problem Statement hinterlegt."}
                </p>
              </div>
              <div>
                <h4 className="text-xs font-semibold text-slate-500">Intended Outcome</h4>
                <p className="mt-2 whitespace-pre-wrap break-words rounded-md bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-700">
                  {task.intendedOutcome || "Kein Intended Outcome hinterlegt."}
                </p>
              </div>
              <div>
                <h4 className="text-xs font-semibold text-slate-500">Scope & Constraints</h4>
                <p className="mt-2 whitespace-pre-wrap break-words rounded-md bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-700">
                  {task.scopeConstraints || "Kein Scope hinterlegt."}
                </p>
              </div>
              <div>
                <h4 className="text-xs font-semibold text-slate-500">Acceptance Criteria</h4>
                <div className="mt-2">
                  <TaskChecklist value={task.acceptanceCriteria || ""} emptyText="Keine Acceptance Criteria hinterlegt." onChange={(nextValue) => onUpdate({ acceptanceCriteria: nextValue })} />
                </div>
              </div>
              <div>
                <h4 className="text-xs font-semibold text-slate-500">Evidence Required</h4>
                <p className="mt-2 whitespace-pre-wrap break-words rounded-md bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-700">
                  {task.evidenceRequired || "Kein erwarteter Nachweis hinterlegt."}
                </p>
              </div>
              <div>
                <h4 className="text-xs font-semibold text-slate-500">Definition of Done</h4>
                <div className="mt-2">
                  <TaskChecklist value={task.definitionOfDone || ""} emptyText="Keine Definition of Done hinterlegt." onChange={(nextValue) => onUpdate({ definitionOfDone: nextValue })} />
                </div>
              </div>
            </div>
          </section>

        <section className="rounded-lg border border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-950">Fokus-Kontext</h3>
          <div className="mt-3 grid gap-2">
            {linkedFocusItems.length ? linkedFocusItems.map((item) => (
              <article key={item.id} className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-slate-800">{profileName(item.profileId)} · {formatDate(item.focusDate)}</span>
                  <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">{focusStatusLabel(item.status)}</span>
                </div>
                <div className="mt-1 text-xs leading-5 text-slate-500">{item.nextStep || "Kein nächster Schritt hinterlegt."}</div>
              </article>
            )) : (
              <div className="rounded-md border border-dashed border-slate-200 px-3 py-4 text-center text-sm text-slate-500">
                Diese Aufgabe ist aktuell in keinem Tagesfokus.
              </div>
            )}
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-950">Begründende Decisions</h3>
          <div className="mt-3 grid gap-2">
            {linkedDecisions.length ? linkedDecisions.map(({ link, decision }) => (
              <article key={link.id} className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-sm">
                <div className="font-semibold text-slate-800">{decision?.title}</div>
                <div className="mt-1 text-xs text-slate-500">{decision ? decisionStatusLabel(decision.status) : "Decision"} · {link.note || "Keine Notiz hinterlegt."}</div>
              </article>
            )) : (
              <div className="rounded-md border border-dashed border-slate-200 px-3 py-4 text-center text-sm text-slate-500">
                Noch keine Decision verknüpft.
              </div>
            )}
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-950">Abhängigkeiten & Evidence</h3>
          <div className="mt-2 grid gap-2 text-sm leading-6 text-slate-600">
            <RelationshipList title="Wartet auf" rows={relationshipGroups.waitsOn} empty="Wartet auf keine andere Aufgabe." canManage={canManageTaskMeta} onRemove={onRemoveRelation} />
            <RelationshipList title="Blockiert" rows={relationshipGroups.blocks} empty="Blockiert keine andere Aufgabe." canManage={canManageTaskMeta} onRemove={onRemoveRelation} />
            <RelationshipList title="Verknüpft mit" rows={relationshipGroups.related} empty="Keine losen Verknüpfungen." canManage={canManageTaskMeta} onRemove={onRemoveRelation} />
            {task.dependsOn && <p className="rounded-md border border-amber-100 bg-amber-50 px-3 py-2 text-xs text-amber-800">Legacy-Notiz: {task.dependsOn}</p>}
            {task.evidenceLink || task.issueUrl ? (
              <div className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2">
                <CommentBody value={task.evidenceLink || task.issueUrl} />
              </div>
            ) : (
              <p>Noch kein Evidence-Link hinterlegt.</p>
            )}
            {canManageTaskMeta && (
              <div className="mt-2 grid gap-2 rounded-md border border-slate-200 bg-white p-3">
                <div className="text-xs font-semibold text-slate-500">Relationship hinzufügen</div>
                <CustomSelect
                  value={relationDraft.relationType}
                  onChange={(value) => setRelationDraft((current) => ({ ...current, relationType: value as TaskRelationType }))}
                  className="h-9 text-sm"
                  options={(["blocked_by", "blocks", "relates_to"] as TaskRelationType[]).map((type) => ({ value: type, label: relationTypeLabel(type) }))}
                />
                <CustomSelect
                  value={relationDraft.relatedTaskId}
                  onChange={(value) => setRelationDraft((current) => ({ ...current, relatedTaskId: value }))}
                  className="h-9 text-sm"
                  options={[{ value: "", label: "Aufgabe auswählen" }, ...relationTargetOptions]}
                />
                <input
                  value={relationDraft.note}
                  onChange={(event) => setRelationDraft((current) => ({ ...current, note: event.target.value }))}
                  className="h-9 rounded-md border border-slate-200 px-3 text-sm outline-none focus:border-blue-400"
                  placeholder="Optionaler Hinweis"
                />
                <button
                  type="button"
                  disabled={pending || !relationDraft.relatedTaskId}
                  onClick={() => {
                    onAddRelation(relationDraft);
                    setRelationDraft({ relationType: "blocked_by", relatedTaskId: "", note: "" });
                  }}
                  className="h-9 rounded-md bg-blue-600 px-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                >
                  Relationship hinzufügen
                </button>
              </div>
            )}
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-950">Sub-Issues</h3>
              <p className="mt-1 text-xs text-slate-500">Persönliche Arbeitsstruktur, nicht score-relevant.</p>
            </div>
            <button type="button" onClick={onCreateSubIssue} className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
              Sub-Issue
            </button>
          </div>
          <div className="mt-3 grid gap-2">
            {subIssues.map((item) => (
              <div key={item.id} className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-sm">
                <div className="font-semibold text-slate-800">{item.title}</div>
                <div className="mt-1 text-xs text-slate-500">{normalizeStatus(item.status)} · {item.owner}</div>
              </div>
            ))}
            {!subIssues.length && <div className="rounded-md border border-dashed border-slate-200 px-3 py-4 text-center text-sm text-slate-500">Noch keine Sub-Issues.</div>}
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 p-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <h3 className="text-sm font-semibold text-slate-950">Blocker</h3>
              <p className="mt-1 text-xs text-slate-500">Blocker früh melden, damit der Sprint planbar bleibt.</p>
            </div>
            <span className="rounded-full border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-600">{blockers.filter((blocker) => blocker.status === "open").length} offen</span>
          </div>
          <div className="mt-3 grid gap-2">
            {blockers.map((blocker) => (
              <article key={blocker.id} className="rounded-md border border-orange-100 bg-orange-50 px-3 py-2 text-sm text-orange-950">
                <div className="flex items-center justify-between gap-2">
                  <span className="font-semibold">{profileName(blocker.profileId)}</span>
                  <span className="text-xs">{blocker.status}</span>
                </div>
                <p className="mt-1 leading-6">{blocker.reason}</p>
                {blocker.impact && <p className="mt-1 text-xs text-orange-800">Impact: {blocker.impact}</p>}
                {blocker.needsHelpFrom && <p className="mt-1 text-xs text-orange-800">Braucht Hilfe von: {blocker.needsHelpFrom}</p>}
              </article>
            ))}
            {!blockers.length && <div className="rounded-md border border-dashed border-slate-200 px-3 py-4 text-center text-sm text-slate-500">Noch kein Blocker gemeldet.</div>}
          </div>
          <div className="mt-3 grid gap-2">
            <textarea
              value={blockerDraft.reason}
              onChange={(event) => setBlockerDraft((current) => ({ ...current, reason: event.target.value }))}
              className="min-h-20 w-full resize-y rounded-md border border-slate-200 p-3 text-sm leading-6 outline-none focus:border-blue-400"
              placeholder="Was blockiert dich konkret?"
            />
            <input
              value={blockerDraft.impact}
              onChange={(event) => setBlockerDraft((current) => ({ ...current, impact: event.target.value }))}
              className="h-9 rounded-md border border-slate-200 px-3 text-sm outline-none focus:border-blue-400"
              placeholder="Auswirkung auf Sprint oder Review"
            />
            <input
              value={blockerDraft.needsHelpFrom}
              onChange={(event) => setBlockerDraft((current) => ({ ...current, needsHelpFrom: event.target.value }))}
              className="h-9 rounded-md border border-slate-200 px-3 text-sm outline-none focus:border-blue-400"
              placeholder="Braucht Hilfe von"
            />
            <div className="flex justify-end">
              <button
                type="button"
                disabled={pending || blockerDraft.reason.trim().length < 5}
                onClick={() => {
                  onReportBlocker(blockerDraft);
                  setBlockerDraft({ reason: "", impact: "", needsHelpFrom: "" });
                }}
                className="h-9 rounded-md border border-orange-200 bg-orange-50 px-3 text-sm font-semibold text-orange-700 disabled:cursor-not-allowed disabled:opacity-50"
              >
                Blocker melden
              </button>
            </div>
          </div>
        </section>

        <TaskCommentThread
          comments={comments}
          externalComments={externalComments}
          activities={activities}
          notice={commentImportNotice}
          profiles={teamProfiles}
          pending={pending}
          importPending={commentImportPending}
          onImportGitHubComments={onImportGitHubComments}
          onUploadAttachment={onUploadAttachment}
          onAddComment={onAddComment}
        />

        <section className="rounded-lg border border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-950">Notizen</h3>
          <textarea
            value={task.note}
            onChange={(event) => onUpdate({ note: event.target.value })}
            className="mt-2 min-h-28 w-full resize-y rounded-md border border-slate-200 p-3 text-sm leading-6 outline-none focus:border-blue-400"
            placeholder="Interne Notiz, Entscheidung oder nächster Schritt"
          />
          <div className="mt-2 text-xs text-slate-500">{pending ? "Speichert..." : "Änderungen werden gespeichert, lokal oder in Supabase je nach Datenquelle."}</div>
        </section>
        </main>

        <div className="grid h-fit min-w-0 gap-4 lg:sticky lg:top-24">
          <section className="rounded-lg border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-950">Steuerung</h3>
            <div className="mt-3 grid gap-3">
              <label className="grid gap-1 text-xs font-semibold text-slate-500">
                Status
                <CustomSelect value={normalizeStatus(task.status)} onChange={(value) => onUpdate({ status: value })} className="h-9 text-sm" options={statusOptions.map((status) => ({ value: status, label: status }))} />
              </label>
              {canManageTaskMeta ? (
                <>
                  <label className="grid gap-1 text-xs font-semibold text-slate-500">
                    Assignee
                    <CustomSelect value={task.owner} onChange={(value) => onUpdate({ owner: value })} className="h-9 text-sm" options={teamProfiles.map((profile) => ({ value: profile.name, label: profile.name }))} />
                  </label>
                  <label className="grid gap-1 text-xs font-semibold text-slate-500">
                    Priorität
                    <CustomSelect value={task.priority} onChange={(value) => onUpdate({ priority: value })} className="h-9 text-sm" options={["P0", "P1", "P2", "P3", "P4"].map((priority) => ({ value: priority, label: priority }))} />
                  </label>
                </>
              ) : (
                <>
                  <div>
                    <div className="text-xs font-semibold text-slate-500">Assignee</div>
                    <div className="mt-1 flex h-9 items-center rounded-md border border-slate-200 bg-slate-50 px-2 text-sm font-semibold text-slate-800">{task.owner}</div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-slate-500">Priorität</div>
                    <div className="mt-1 text-sm font-semibold text-slate-800">{task.priority}</div>
                  </div>
                </>
              )}
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-950">Planung</h3>
            <div className="mt-3 grid gap-3">
              {canManageTaskMeta ? (
                <>
                  <label className="grid gap-1 text-xs font-semibold text-slate-500">
                    Group Commitment
                    <CustomSelect value={task.packageId} onChange={updatePackage} className="h-9 text-sm" options={packages.map((item) => ({ value: item.id, label: `${item.id} · ${item.title}` }))} />
                  </label>
                  <label className="grid gap-1 text-xs font-semibold text-slate-500">
                    Sprint
                    <CustomSelect value={task.sprintId} onChange={(value) => onUpdate({ sprintId: value })} className="h-9 text-sm" options={sprints.map((item) => ({ value: item.id, label: item.name }))} />
                  </label>
                  <label className="grid gap-1 text-xs font-semibold text-slate-500">
                    Epic / Meilenstein
                    <CustomSelect value={task.milestoneId || ""} onChange={updateMilestone} className="h-9 text-sm" options={[{ value: "", label: "Kein Epic" }, ...milestones.map((item) => ({ value: item.id, label: item.title }))]} />
                  </label>
                  <div>
                    <div className="text-xs font-semibold text-slate-500">Zeitraum</div>
                    <div className="mt-1 grid grid-cols-2 gap-2">
                      <CustomDatePicker value={task.startDate || ""} onChange={(value) => onUpdate({ startDate: value })} className="h-9 text-sm" />
                      <CustomDatePicker value={task.endDate || ""} onChange={(value) => onUpdate({ endDate: value })} className="h-9 text-sm" />
                    </div>
                  </div>
                  <label className="grid gap-1 text-xs font-semibold text-slate-500">
                    Zieltermin
                    <CustomDatePicker value={task.deadline || ""} onChange={(value) => onUpdate({ deadline: value })} className="h-9 text-sm" />
                  </label>
                </>
              ) : (
                <>
                  <div>
                    <div className="text-xs font-semibold text-slate-500">Group Commitment</div>
                    <div className="mt-1 break-words text-sm text-slate-800">{currentPackage ? `${currentPackage.id} · ${currentPackage.title}` : "ohne Group Commitment"}</div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-slate-500">Sprint</div>
                    <div className="mt-1 text-sm text-slate-800">{currentSprint?.name || "Kein Sprint"}</div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-slate-500">Epic / Meilenstein</div>
                    <div className="mt-1 break-words text-sm text-slate-800">{currentMilestone?.title || "Kein Epic"}</div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-slate-500">Zeitraum</div>
                    <div className="mt-1 flex items-center gap-2 text-sm text-slate-800"><CalendarDays size={15} />{dateRange(task)}</div>
                  </div>
                  <div>
                    <div className="text-xs font-semibold text-slate-500">Zieltermin</div>
                    <div className="mt-1 text-sm text-slate-800">{task.deadline ? formatDate(task.deadline) : "Kein Zieltermin"}</div>
                  </div>
                </>
              )}
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 p-4">
            <h3 className="text-sm font-semibold text-slate-950">Review & Historie</h3>
            <div className="mt-3 grid gap-3 text-sm text-slate-800">
              <div>
                <div className="text-xs font-semibold text-slate-500">Review</div>
                <div className="mt-1">{reviewLabel(task.reviewStatus)} · {task.scoreFinal ? `${task.scorePoints} Punkte final` : "noch nicht final bewertet"}</div>
              </div>
              <div>
                <div className="text-xs font-semibold text-slate-500">Erstellt von</div>
                <div className="mt-1">{creatorProfile?.name || task.createdBy || "Unbekannt"}</div>
              </div>
              {(task.carriedFromSprintId || task.carryoverReason || task.sprintOutcome) && (
                <div className="rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-sm leading-6 text-blue-900">
                  <div className="font-semibold">Sprint-Verlauf</div>
                  {task.carriedFromSprintId && <div>Aus Sprint {task.carriedFromSprintId} übertragen.</div>}
                  {task.sprintOutcome && <div>Outcome im ursprünglichen Sprint: {task.sprintOutcome}</div>}
                  {task.carryoverReason && <div>{task.carryoverReason}</div>}
                </div>
              )}
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 p-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <h3 className="text-sm font-semibold text-slate-950">GitHub</h3>
                <p className="mt-1 text-xs text-slate-500">Backup ins Management-Repo.</p>
              </div>
              {canSyncExistingGitHubIssue ? (
                <button
                  type="button"
                  disabled={pending || task.githubSyncStatus === "pending" || !githubProviderTokenAvailable}
                  onClick={() => onSyncGitHub()}
                  className="h-8 rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {task.githubSyncStatus === "pending" ? "Sync..." : "Jetzt spiegeln"}
                </button>
              ) : task.taskType === "deliverable" ? (
                <button
                  type="button"
                  disabled={pending || task.githubSyncStatus === "pending" || !githubProviderTokenAvailable}
                  onClick={() => onSyncGitHub({ createIfMissing: true })}
                  className="h-8 rounded-md border border-amber-200 bg-amber-50 px-3 text-xs font-semibold text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {task.githubSyncStatus === "pending" ? "Anlegen..." : "GitHub-Issue anlegen"}
                </button>
              ) : (
                <span className="rounded-full border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-500">Nicht score-relevant</span>
              )}
            </div>
            <div className="mt-3 grid gap-2 text-sm leading-6 text-slate-600">
              <p className="break-words">{task.githubRepo || "findmydoc-platform/management"} · {syncLabel(task.githubSyncStatus)}</p>
              {task.githubIssueUrl ? (
                <a href={task.githubIssueUrl} target="_blank" rel="noreferrer" className="inline-flex min-w-0 items-center gap-1.5 text-blue-700 hover:underline">
                  <Link2 size={15} className="shrink-0" />
                  <span className="truncate">{task.githubIssueUrl}</span>
                </a>
              ) : (
                <p className="inline-flex items-center gap-1.5 text-amber-700">
                  <AlertTriangle size={15} />
                  Noch kein GitHub-Issue verknüpft.
                </p>
              )}
              {!hasGitHubIssue(task) && (
                <p className="text-xs text-slate-500">
                  Diese Aufgabe wird nicht automatisch dupliziert. Nutze “GitHub-Issue anlegen”, wenn sie bewusst ins Management-Repo gespiegelt werden soll.
                </p>
              )}
              {!githubProviderTokenAvailable && (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
                  <div className="font-semibold">GitHub-Rechte müssen erneuert werden.</div>
                  <p className="mt-1">Du bist weiter in der App angemeldet, aber Sync, Kommentare und Anhänge brauchen einen frischen GitHub-Token.</p>
                  <button
                    type="button"
                    onClick={onReconnectGitHub}
                    disabled={pending}
                    className="mt-2 h-8 rounded-md border border-amber-200 bg-white px-3 text-xs font-semibold text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    GitHub-Rechte erneuern
                  </button>
                </div>
              )}
              {task.githubLastSyncedAt && <p className="text-xs text-slate-500">Zuletzt gespiegelt: {task.githubLastSyncedAt}</p>}
              {task.githubSyncError && <p className="break-words text-red-700">{task.githubSyncError}</p>}
            </div>
          </section>
        </div>
      </div>
    </aside>
    </>
  );
}
