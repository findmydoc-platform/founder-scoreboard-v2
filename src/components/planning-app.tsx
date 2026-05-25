"use client";

import {
  Archive,
  CalendarDays,
  CheckCircle2,
  ChevronRight,
  Circle,
  Columns3,
  FileText,
  Filter,
  GanttChart,
  LayoutDashboard,
  Link2,
  ListTree,
  MessageSquare,
  PanelRight,
  Plus,
  Search,
  Settings,
  ShieldCheck,
  Table2,
  Users,
} from "lucide-react";
import type { User } from "@supabase/supabase-js";
import Image from "next/image";
import Link from "next/link";
import { useEffect, useMemo, useRef, useState, useTransition, type DragEvent } from "react";
import { CustomDatePicker } from "@/components/custom-date-picker";
import { CustomSelect } from "@/components/custom-select";
import { normalizeStatus, priorityTone, statusTone, taskStatuses } from "@/lib/status";
import { getBrowserSupabase, hasSupabaseEnv } from "@/lib/supabase";
import { founderScore, reviewLabel, roleLabel, syncLabel } from "@/lib/platform";
import { TaskCommentThread } from "@/components/task-comment-thread";
import type { CommitmentLevel, Meeting, MeetingAttendance, Package, PlanningData, PlatformRole, Profile, Sprint, SprintCommitment, Task, TaskBlocker, TaskComment, TaskStatus, ViewMode } from "@/lib/types";

type Props = {
  initialData: PlanningData;
  source: "seed" | "supabase";
  authRequired: boolean;
};

type Filters = {
  query: string;
  owner: string;
  status: string;
  priority: string;
  packageId: string;
  quick: string;
};

type Workspace = "planning" | "mine" | "sprint" | "decisions" | "meetings" | "projects" | "team" | "settings";

type NewTaskDraft = {
  title: string;
  description: string;
  problemStatement: string;
  intendedOutcome: string;
  scopeConstraints: string;
  acceptanceCriteria: string;
  evidenceRequired: string;
  taskType: "deliverable" | "proposal" | "sub_issue";
  parentTaskId: string;
  milestoneId: string;
  packageId: string;
  sprintId: string;
  owner: string;
  priority: string;
  status: string;
  workstream: string;
  startDate: string;
  endDate: string;
  hours: number;
  definitionOfDone: string;
};

type SprintPlanningOptions = {
  namePattern: string;
  rhythmWeeks: number;
  horizonWeeks: number;
  targetSprintNumber: number;
};

const viewTabs: Array<{ id: ViewMode; label: string; icon: typeof Columns3 }> = [
  { id: "board", label: "Board", icon: Columns3 },
  { id: "structure", label: "Struktur", icon: ListTree },
  { id: "table", label: "Tabelle", icon: Table2 },
  { id: "gantt", label: "Gantt", icon: GanttChart },
];

const navItems = [
  { id: "planning", label: "Planung", icon: LayoutDashboard },
  { id: "mine", label: "Meine Aufgaben", icon: CheckCircle2 },
  { id: "sprint", label: "Sprint & Score", icon: GanttChart },
  { id: "decisions", label: "Decision Log", icon: FileText },
  { id: "meetings", label: "Meeting Finder", icon: CalendarDays },
  { id: "projects", label: "Projekte", icon: Archive },
  { id: "team", label: "Team", icon: Users },
  { id: "settings", label: "Einstellungen", icon: Settings },
] satisfies Array<{ id: Workspace; label: string; icon: typeof LayoutDashboard }>;

const workspaceLabels: Record<Workspace, string> = {
  planning: "Projekt",
  mine: "Meine Aufgaben",
  sprint: "Sprint & Score",
  decisions: "Decision Log",
  meetings: "Meeting Finder",
  projects: "Projekte",
  team: "Team",
  settings: "Einstellungen",
};

const workspaceSubtitles: Record<Workspace, string> = {
  planning: "Gesamtplanung mit Board, Struktur, Tabelle und Gantt.",
  mine: "Fokus auf die Aufgaben von Volkan für die operative Steuerung.",
  sprint: "Review Queue, Punkte und Sprintabschluss.",
  decisions: "CEO-Entscheidungen mit Bestätigung und Locking.",
  meetings: "Freie Slots aus Arbeitszeiten und Abwesenheiten finden.",
  projects: "Projekt- und Commitment-Überblick.",
  team: "Kapazitäten, Rollen und aktuelle Last pro Teammitglied.",
  settings: "Datenquelle, Auth-Status und Setup-Prüfungen.",
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

const quickFilters = [
  { id: "mine", label: "Meine Aufgaben" },
  { id: "open", label: "Offen" },
  { id: "blocked", label: "Blockiert" },
  { id: "week", label: "Diese Woche" },
  { id: "high", label: "Hohe Priorität" },
  { id: "evidence", label: "Ohne Evidence" },
];

const localStateKey = "fmd-planning-local-state-v1";
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

function hexToRgba(hex: string, alpha: number) {
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) return `rgba(100, 116, 139, ${alpha})`;
  const value = match[1];
  const red = Number.parseInt(value.slice(0, 2), 16);
  const green = Number.parseInt(value.slice(2, 4), 16);
  const blue = Number.parseInt(value.slice(4, 6), 16);
  return `rgba(${red}, ${green}, ${blue}, ${alpha})`;
}

function profileColor(profile?: Pick<Profile, "color"> | null) {
  return profile?.color || "#64748b";
}

function packageById(packages: Package[], id: string) {
  return packages.find((item) => item.id === id);
}

function formatDate(value: string) {
  if (!value) return "ohne Datum";
  return new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "short" }).format(new Date(value));
}

function dateRange(task: Task) {
  if (!task.startDate && !task.endDate) return task.deadline || "ohne Datum";
  if (task.startDate === task.endDate) return formatDate(task.startDate);
  return `${formatDate(task.startDate)} - ${formatDate(task.endDate)}`;
}

function sprintNumber(value: string) {
  const match = value.match(/sprint\D*(\d+)/i) || value.match(/(\d+)$/);
  return match ? Number(match[1]) : 0;
}

function sprintNameFromPattern(pattern: string, number: number) {
  const trimmed = pattern.trim() || "Sprint #";
  if (trimmed.includes("#")) return trimmed.replace(/#+/g, String(number));
  return `${trimmed} ${number}`;
}

function addDaysIso(value: string, days: number) {
  const date = value ? new Date(`${value}T00:00:00`) : new Date();
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function futureSprintDrafts(sprints: Sprint[], options: SprintPlanningOptions) {
  const rhythmWeeks = Math.min(Math.max(Number(options.rhythmWeeks) || 2, 1), 12);
  const horizonWeeks = Math.min(Math.max(Number(options.horizonWeeks) || 6, 1), 52);
  const targetSprintNumber = Math.max(Number(options.targetSprintNumber) || 0, 0);
  const sorted = [...sprints].sort((a, b) => (a.startDate || "").localeCompare(b.startDate || ""));
  const latest = sorted[sorted.length - 1];
  const existingIds = new Set(sprints.map((sprint) => sprint.id));
  const lastNumber = Math.max(0, ...sprints.map((sprint) => Math.max(sprintNumber(sprint.name), sprintNumber(sprint.id))));
  const horizonEnd = addDaysIso(new Date().toISOString().slice(0, 10), horizonWeeks * 7);
  let nextNumber = lastNumber + 1;
  let nextStart = latest?.endDate ? addDaysIso(latest.endDate, 1) : new Date().toISOString().slice(0, 10);
  const drafts: Sprint[] = [];

  while (nextStart <= horizonEnd || (targetSprintNumber > 0 && nextNumber <= targetSprintNumber)) {
    const endDate = addDaysIso(nextStart, rhythmWeeks * 7 - 1);
    const baseId = `sprint-${nextNumber}`;
    const id = existingIds.has(baseId) ? `${baseId}-${nextStart.replaceAll("-", "")}` : baseId;
    existingIds.add(id);
    drafts.push({
      id,
      name: sprintNameFromPattern(options.namePattern, nextNumber),
      status: "planning",
      startDate: nextStart,
      endDate,
      reviewDueAt: `${addDaysIso(endDate, -2)}T12:00`,
      scoreLocked: false,
    });
    nextNumber += 1;
    nextStart = addDaysIso(endDate, 1);
  }

  return drafts;
}

function taskText(task: Task) {
  return [
    task.title,
    task.description,
    task.owner,
    task.workstream,
    task.priority,
    task.definitionOfDone,
    task.deadline,
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

function reviewChecklistScore(checklist: { acceptanceCriteriaMet?: boolean; dodMet?: boolean; evidenceProvided?: boolean; communicationClear?: boolean; blockerHandled?: boolean }) {
  const checked = [
    checklist.acceptanceCriteriaMet ?? checklist.dodMet,
    checklist.evidenceProvided,
    checklist.communicationClear,
    checklist.blockerHandled,
  ].filter(Boolean).length;
  return Math.round((checked / 4) * 10);
}

function decisionStatusLabel(status: "draft" | "open_for_confirmation" | "locked") {
  if (status === "locked") return "Gelockt";
  if (status === "open_for_confirmation") return "Zur Bestätigung offen";
  return "Entwurf";
}

function TaskCard({
  task,
  pack,
  ownerProfile,
  onOpen,
  onStatusChange,
  onDragStart,
  onDragEnd,
  isDragging,
}: {
  task: Task;
  pack?: Package;
  ownerProfile?: Profile;
  onOpen: (task: Task) => void;
  onStatusChange: (task: Task, status: TaskStatus) => void;
  onDragStart?: (task: Task, event: DragEvent<HTMLElement>) => void;
  onDragEnd?: () => void;
  isDragging?: boolean;
}) {
  const normalized = normalizeStatus(task.status);
  const ownerColor = profileColor(ownerProfile);

  return (
    <article
      draggable={Boolean(onDragStart)}
      onDragStart={(event) => onDragStart?.(task, event)}
      onDragEnd={onDragEnd}
      className={`rounded-lg border border-slate-200 bg-white p-3 shadow-sm transition ${isDragging ? "opacity-50 ring-2 ring-blue-300" : "cursor-grab active:cursor-grabbing"}`}
      style={{
        borderLeftColor: ownerColor,
        boxShadow: `inset 4px 0 0 ${ownerColor}, 0 1px 3px ${hexToRgba(ownerColor, 0.18)}`,
        background: `linear-gradient(90deg, ${hexToRgba(ownerColor, 0.13)}, #ffffff 34%)`,
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <button
          type="button"
          onClick={() => onOpen(task)}
          className="min-w-0 text-left text-sm font-semibold leading-snug text-slate-900 hover:text-blue-700"
        >
          {task.title}
        </button>
        <button
          type="button"
          onClick={() => onOpen(task)}
          className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50"
          aria-label="Aufgabe öffnen"
        >
          <PanelRight size={15} />
        </button>
      </div>
      <div className="mt-2 flex flex-wrap gap-1.5">
        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${statusTone(normalized)}`}>
          {normalized}
        </span>
        <span className={`rounded-full border px-2 py-0.5 text-[11px] font-semibold ${priorityTone(task.priority)}`}>
          {task.priority}
        </span>
        <span className="rounded-full border border-slate-200 bg-slate-50 px-2 py-0.5 text-[11px] font-semibold text-slate-600">
          {task.hours}h
        </span>
      </div>
      <p className="mt-2 line-clamp-2 text-xs leading-5 text-slate-600">{task.description}</p>
      <div className="mt-3 flex items-center justify-between gap-2 text-xs text-slate-500">
        <span className="inline-flex min-w-0 items-center gap-1.5 truncate">
          <span className="h-2 w-2 shrink-0 rounded-full" style={{ backgroundColor: ownerColor }} />
          <span className="truncate">{pack?.id || "ohne Group Commitment"} · {task.owner}</span>
        </span>
        <span className="shrink-0">{dateRange(task)}</span>
      </div>
      <div className="mt-3 flex items-center justify-between border-t border-slate-100 pt-2">
        <CustomSelect
          value={normalized}
          onChange={(value) => onStatusChange(task, value as TaskStatus)}
          options={taskStatuses.map((status) => ({ value: status, label: status }))}
          className="h-8 w-32 text-xs"
          aria-label="Status ändern"
        />
        <div className="flex items-center gap-2 text-slate-400">
          <MessageSquare size={14} />
          <FileText size={14} />
          <Link2 size={14} className={task.evidenceLink || task.issueUrl ? "text-blue-500" : ""} />
        </div>
      </div>
    </article>
  );
}

function EmptyColumn() {
  return (
    <div className="grid min-h-72 place-items-center rounded-lg border border-dashed border-blue-200 bg-blue-50/40 px-6 text-center">
      <div>
        <div className="mx-auto grid h-16 w-24 place-items-center rounded-lg border border-blue-100 bg-white text-blue-300">
          <Columns3 size={28} />
        </div>
        <p className="mt-4 text-sm font-medium text-slate-600">Keine Treffer in dieser Spalte.</p>
      </div>
    </div>
  );
}

export function PlanningApp({ initialData, source, authRequired }: Props) {
  const sidebarRef = useRef<HTMLElement | null>(null);
  const [data, setData] = useState(initialData);
  const [localStateLoaded, setLocalStateLoaded] = useState(source === "supabase");
  const [workspace, setWorkspace] = useState<Workspace>("planning");
  const [view, setView] = useState<ViewMode>("board");
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);
  const [taskDialogDefaults, setTaskDialogDefaults] = useState<Partial<NewTaskDraft> | null>(null);
  const [draggedTaskId, setDraggedTaskId] = useState<string | null>(null);
  const [dragOverStatus, setDragOverStatus] = useState<TaskStatus | null>(null);
  const [showFilters, setShowFilters] = useState(false);
  const [isPending, startTransition] = useTransition();
  const [authUser, setAuthUser] = useState<User | null>(null);
  const [authChecked, setAuthChecked] = useState(!authRequired);
  const [protectedDataLoaded, setProtectedDataLoaded] = useState(!authRequired);
  const [githubProviderTokenAvailable, setGithubProviderTokenAvailable] = useState(false);
  const [authError, setAuthError] = useState("");
  const [authNotice, setAuthNotice] = useState("");
  const [authBusy, setAuthBusy] = useState(false);
  const [saveError, setSaveError] = useState("");
  const [notificationDispatchMessage, setNotificationDispatchMessage] = useState("");
  const [sprintLockMessage, setSprintLockMessage] = useState("");
  const [sprintPlanningOptions, setSprintPlanningOptions] = useState<SprintPlanningOptions>({
    namePattern: "Sprint #",
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

  const selectedTask = data.tasks.find((task) => task.id === selectedTaskId) || null;
  const selectedPackage = selectedTask ? packageById(data.packages, selectedTask.packageId) : undefined;
  const selectedTaskSubIssues = selectedTask ? sortTasks(data.tasks.filter((task) => task.parentTaskId === selectedTask.id)) : [];
  const selectedTaskComments = selectedTask ? data.taskComments.filter((comment) => comment.taskId === selectedTask.id) : [];
  const selectedTaskBlockers = selectedTask ? data.taskBlockers.filter((blocker) => blocker.taskId === selectedTask.id) : [];
  const authAvailable = hasSupabaseEnv();
  const currentGithubLogin = String(authUser?.user_metadata?.user_name || authUser?.user_metadata?.preferred_username || "");
  const currentProfile = data.profiles.find((profile) => profile.githubLogin === currentGithubLogin) || null;

  useEffect(() => {
    if (source === "supabase") return;

    queueMicrotask(() => {
      try {
        const stored = window.localStorage.getItem(localStateKey);
        if (stored) {
          const parsed = JSON.parse(stored) as Partial<Record<string, Partial<Task>>>;
          setData((current) => ({
            ...current,
            tasks: current.tasks.map((task) => ({ ...task, ...(parsed[task.id] || {}) })),
          }));
        }
      } catch {
        // Keep seed data if local recovery fails.
      } finally {
        setLocalStateLoaded(true);
      }
    });
  }, [source]);

  useEffect(() => {
    const supabase = getBrowserSupabase();
    if (!supabase) {
      queueMicrotask(() => setAuthChecked(true));
      return;
    }

    let active = true;

    supabase.auth.getSession().then(({ data: sessionData }) => {
      if (!active) return;
      setAuthUser(sessionData.session?.user || null);
      setGithubProviderTokenAvailable(Boolean(sessionData.session?.provider_token));
      setAuthChecked(true);
    });

    const { data: subscription } = supabase.auth.onAuthStateChange((event, session) => {
      setAuthUser(session?.user || null);
      setGithubProviderTokenAvailable(Boolean(session?.provider_token));
      setAuthChecked(true);
      setAuthError("");
      if (event === "SIGNED_IN") setAuthNotice("");
      if (event === "SIGNED_OUT") {
        setData(initialData);
        setProtectedDataLoaded(false);
        setSelectedTaskId(null);
        setAuthNotice("Du bist abgemeldet. Der Zugriff auf die Planungsdaten ist gesperrt.");
      }
    });

    return () => {
      active = false;
      subscription.subscription.unsubscribe();
    };
  }, [initialData]);

  useEffect(() => {
    if (!authRequired || source !== "supabase" || !authUser) return;

    let active = true;

    async function loadProtectedPlanningData() {
      setProtectedDataLoaded(false);
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;
      if (!token) return;

      const response = await fetch("/api/planning-data", {
        headers: { authorization: `Bearer ${token}` },
      });
      const payload = await response.json().catch(() => null) as { data?: PlanningData; error?: string } | null;

      if (!active) return;
      if (!response.ok || !payload?.data) {
        setData(initialData);
        setProtectedDataLoaded(false);
        setAuthError(payload?.error || "Planungsdaten konnten nicht geladen werden.");
        return;
      }

      setData(payload.data);
      setProtectedDataLoaded(true);
      setAuthError("");
    }

    loadProtectedPlanningData();

    return () => {
      active = false;
    };
  }, [authRequired, authUser, initialData, source]);

  const signIn = async () => {
    const supabase = getBrowserSupabase();
    if (!supabase) return;

    setAuthBusy(true);
    setAuthError("");
    setAuthNotice("");

    const { error } = await supabase.auth.signInWithOAuth({
      provider: "github",
      options: {
        redirectTo: window.location.origin,
        scopes: "repo read:user user:email",
      },
    });

    setAuthBusy(false);
    if (error) {
      setAuthError("GitHub-Anmeldung konnte nicht gestartet werden.");
      return;
    }
  };

  const signOut = async () => {
    const supabase = getBrowserSupabase();
    if (!supabase) return;

    setAuthBusy(true);
    setAuthError("");
    setAuthNotice("");

    const { error } = await supabase.auth.signOut({ scope: "global" });
    if (error) {
      setAuthError("Abmeldung konnte nicht abgeschlossen werden.");
      setAuthBusy(false);
      return;
    }

    setAuthUser(null);
    setGithubProviderTokenAvailable(false);
    setData(initialData);
    setProtectedDataLoaded(false);
    setSelectedTaskId(null);
    setAuthNotice("Du bist abgemeldet. Der Zugriff auf die Planungsdaten ist gesperrt.");
    setAuthBusy(false);
  };

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
          (filters.quick === "mine" && task.owner === "Volkan") ||
          (filters.quick === "open" && normalized === "Offen") ||
          (filters.quick === "blocked" && (normalized === "Blockiert" || Boolean(task.dependsOn))) ||
          (filters.quick === "week" && isThisWeek(task)) ||
          (filters.quick === "high" && ["P0", "P1"].includes(task.priority)) ||
          (filters.quick === "evidence" && !task.evidenceLink && !task.issueUrl);

        return matchesQuery && matchesOwner && matchesStatus && matchesPriority && matchesPackage && matchesQuick;
      }),
    );
  }, [data.tasks, filters]);

  const visibleTasks = useMemo(() => {
    if (workspace === "mine") return filteredTasks.filter((task) => task.owner === "Volkan");
    return filteredTasks;
  }, [filteredTasks, workspace]);

  const updateTask = (task: Task, patch: Partial<Task>) => {
    setSaveError("");

    setData((current) => {
      const nextData = {
        ...current,
        tasks: current.tasks.map((item) => (item.id === task.id ? { ...item, ...patch } : item)),
      };

      if (source === "seed") {
        try {
          const changedTasks = Object.fromEntries(
            nextData.tasks.map((item) => [
              item.id,
              {
                status: item.status,
                owner: item.owner,
                assignee: item.assignee,
                priority: item.priority,
                startDate: item.startDate,
                endDate: item.endDate,
                note: item.note,
                reviewStatus: item.reviewStatus,
                scorePoints: item.scorePoints,
                githubSyncStatus: item.githubSyncStatus,
                sprintId: item.sprintId,
                milestoneId: item.milestoneId,
                dependsOn: item.dependsOn,
                evidenceLink: item.evidenceLink,
                selfDodChecked: item.selfDodChecked,
                selfEvidenceChecked: item.selfEvidenceChecked,
                selfDocumentedChecked: item.selfDocumentedChecked,
                selfBlockersChecked: item.selfBlockersChecked,
              },
            ]),
          );
          window.localStorage.setItem(localStateKey, JSON.stringify(changedTasks));
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
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({
            status: patch.status,
            owner: patch.owner,
            priority: patch.priority,
            startDate: patch.startDate,
            endDate: patch.endDate,
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

        if (!response.ok) {
          const body = (await response.json().catch(() => null)) as { error?: string } | null;
          throw new Error(body?.error || "Änderung konnte nicht gespeichert werden.");
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

    const owner = draft.owner || currentProfile?.name || data.profiles[0]?.name || "Volkan";
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
      deadline: draft.sprintId,
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

    setData((current) => ({ ...current, tasks: [...current.tasks, localTask] }));
    setTaskDialogDefaults(null);

    if (source !== "supabase") return;

    startTransition(async () => {
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;

      try {
        const response = await fetch("/api/tasks", {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify(draft),
        });

        const body = (await response.json().catch(() => null)) as { error?: string; task?: Task } | null;
        if (!response.ok || !body?.task) throw new Error(body?.error || "Aufgabe konnte nicht erstellt werden.");

        setData((current) => ({
          ...current,
          tasks: current.tasks.map((task) => (task.id === localTask.id ? body.task! : task)),
        }));
      } catch (error) {
        setData((current) => ({ ...current, tasks: current.tasks.filter((task) => task.id !== localTask.id) }));
        setSaveError(error instanceof Error ? error.message : "Aufgabe konnte nicht erstellt werden.");
      }
    });
  };

  const startTaskDrag = (task: Task, event: DragEvent<HTMLElement>) => {
    setDraggedTaskId(task.id);
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData("text/plain", task.id);
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
    const drafts = futureSprintDrafts(data.sprints, options);
    if (!drafts.length) {
      if (!silent) setSprintLockMessage("Der Sprint-Plan deckt den gewünschten Zeitraum bereits ab.");
      return 0;
    }

    const draftIds = new Set(drafts.map((sprint) => sprint.id));
    setData((current) => ({
      ...current,
      sprints: [...current.sprints, ...drafts].sort((a, b) => (a.startDate || "").localeCompare(b.startDate || "")),
    }));

    if (source !== "supabase") {
      if (!silent) setSprintLockMessage(`${drafts.length} Sprint${drafts.length === 1 ? "" : "s"} lokal angelegt.`);
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

      if (!silent) setSprintLockMessage(`${body?.sprints?.length || drafts.length} Sprint${(body?.sprints?.length || drafts.length) === 1 ? "" : "s"} angelegt.`);
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

  const updateMeetingAttendance = (meeting: Meeting, attendance: MeetingAttendance) => {
    setSaveError("");

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
        setSaveError(error instanceof Error ? error.message : "Meeting-Rückmeldung konnte nicht gespeichert werden.");
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
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ decision: reviewStatus, points: scorePoints, checklist, comment }),
        });

        const body = (await response.json().catch(() => null)) as { error?: string } | null;
        if (!response.ok) throw new Error(body?.error || "Review konnte nicht gespeichert werden.");
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

    startTransition(async () => {
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;

      try {
        const response = await fetch(`/api/tasks/${task.id}/comments`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ comment }),
        });

        const body = (await response.json().catch(() => null)) as { error?: string; comment?: PlanningData["taskComments"][number] } | null;
        if (!response.ok || !body?.comment) throw new Error(body?.error || "Kommentar konnte nicht gespeichert werden.");

        setData((current) => ({
          ...current,
          taskComments: [body.comment!, ...current.taskComments],
        }));
      } catch (error) {
        setSaveError(error instanceof Error ? error.message : "Kommentar konnte nicht gespeichert werden.");
      }
    });
  };

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
      tasks: current.tasks.map((item) => (item.id === task.id ? { ...item, status: "Blockiert" } : item)),
      taskBlockers: [localBlocker, ...current.taskBlockers],
    }));

    if (source !== "supabase") return;

    startTransition(async () => {
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;

      try {
        const response = await fetch(`/api/tasks/${task.id}/blockers`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
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

  const syncTaskToGitHub = (task: Task) => {
    setSaveError("");

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

      try {
        const response = await fetch(`/api/tasks/${task.id}/sync-github`, {
          method: "POST",
          headers: {
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
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
        setSaveError(message);
      }
    });
  };

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
      } catch (error) {
        setNotificationDispatchMessage(error instanceof Error ? error.message : "Google-Chat-Dispatch konnte nicht ausgeführt werden.");
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
            ...(token ? { authorization: `Bearer ${token}` } : {}),
          },
        });

        const body = (await response.json().catch(() => null)) as { error?: string; carryover?: { created?: number; evaluated?: number; nextSprintId?: string } } | null;
        if (!response.ok) throw new Error(body?.error || "Sprint konnte nicht gelockt werden.");
        if (body?.carryover) {
          setSprintLockMessage(`${body.carryover.evaluated || 0} offene Deliverables bewertet, ${body.carryover.created || 0} Carry-over-Aufgaben erstellt.`);
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
    blocked: visibleTasks.filter((task) => task.dependsOn || normalizeStatus(task.status) === "Blockiert").length,
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
        <section className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-xl">
          <div className="flex items-start gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-blue-50 text-blue-700">
              <ShieldCheck size={22} />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Geschützter Teamzugriff</div>
              <h1 className="mt-1 text-xl font-semibold text-slate-950">findmydoc Founder Execution</h1>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Bitte melde dich mit GitHub an. Ohne gültige Supabase-Session werden keine Planungsdaten geladen.
              </p>
            </div>
          </div>
          {authNotice && <p className="mt-4 rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-800">{authNotice}</p>}
          {authError && <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{authError}</p>}
          <div className="mt-5">
            {authChecked ? (
              <AuthControl
                user={authUser}
                error={authError}
                busy={authBusy}
                onSignIn={signIn}
                onSignOut={signOut}
              />
            ) : (
              <div className="h-9 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-sm font-medium text-slate-600">Session wird geprüft...</div>
            )}
          </div>
        </section>
      </main>
    );
  }

  if (authRequired && authUser && !protectedDataLoaded) {
    return (
      <main className="grid min-h-screen place-items-center bg-[#f4f7fb] px-4 text-slate-900">
        <section className="w-full max-w-md rounded-lg border border-slate-200 bg-white p-6 shadow-xl">
          <div className="flex items-start gap-3">
            <div className="grid h-11 w-11 shrink-0 place-items-center rounded-lg bg-blue-50 text-blue-700">
              <ShieldCheck size={22} />
            </div>
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Session aktiv</div>
              <h1 className="mt-1 text-xl font-semibold text-slate-950">Planungsdaten werden geladen</h1>
              <p className="mt-2 text-sm leading-6 text-slate-600">
                Die Session ist gültig. Die Daten werden jetzt über die geschützte API geladen.
              </p>
            </div>
          </div>
          {authError && <p className="mt-4 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">{authError}</p>}
          <div className="mt-5">
            <AuthControl
              user={authUser}
              error={authError}
              busy={authBusy}
              onSignIn={signIn}
              onSignOut={signOut}
            />
          </div>
        </section>
      </main>
    );
  }

  return (
    <div className="min-h-screen bg-[#f4f7fb] text-slate-900">
      <aside
        ref={sidebarRef}
        onMouseLeave={releaseSidebarFocus}
        className="group fixed inset-y-0 left-0 z-30 hidden w-16 overflow-hidden border-r border-slate-200 bg-white shadow-none transition-[width,box-shadow] duration-200 ease-out hover:w-64 hover:shadow-xl focus-within:w-64 focus-within:shadow-xl lg:block"
      >
        <div className="border-b border-slate-100 px-3 py-5">
          <div className="flex items-center gap-3">
            <Image src="/assets/icon-mark.svg" alt="" width={40} height={40} className="h-10 w-10 shrink-0" aria-hidden="true" />
            <div className="min-w-0 whitespace-nowrap opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
              <Image src="/assets/logo.svg" alt="findmydoc" width={140} height={26} className="h-5 w-auto max-w-36" priority />
              <div className="mt-1 text-sm font-semibold text-slate-700">Founder Planning</div>
            </div>
          </div>
        </div>
        <nav className="space-y-1 px-3 py-4">
          {navItems.map((item) => {
            const Icon = item.icon;
            return (
              <button
                key={item.label}
                type="button"
                onClick={() => setWorkspace(item.id)}
                title={item.label}
                className={`flex h-10 w-full items-center justify-center gap-0 rounded-md px-3 text-left text-sm font-medium transition-colors group-hover:justify-start group-hover:gap-3 group-focus-within:justify-start group-focus-within:gap-3 ${
                  workspace === item.id ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-50"
                }`}
              >
                <Icon size={18} className="shrink-0" />
                <span className="w-0 overflow-hidden whitespace-nowrap opacity-0 transition-opacity duration-150 group-hover:w-auto group-hover:opacity-100 group-focus-within:w-auto group-focus-within:opacity-100">{item.label}</span>
              </button>
            );
          })}
        </nav>
        <div className="absolute bottom-0 left-0 right-0 border-t border-slate-100 p-4 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
          <div className="rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-600">
            Datenquelle: <span className="font-semibold">{source === "supabase" ? "Supabase" : "Seed-Fallback"}</span>
            <br />
            {source === "supabase" ? "Änderungen werden in Postgres gespeichert." : localStateLoaded ? "Änderungen werden lokal im Browser gespeichert." : "Lokaler Status wird geladen."}
          </div>
          {authAvailable && (
            <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3 text-xs leading-5 text-slate-600">
              <div className="font-semibold text-slate-800">Teamzugriff</div>
              <div className="mt-1 truncate">{authUser ? authUser.email : "Nicht angemeldet"}</div>
            </div>
          )}
        </div>
      </aside>

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
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-4 lg:px-6">
            <div className="min-w-0">
              <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{workspaceLabels[workspace]}</div>
              <h1 className="truncate text-xl font-semibold text-slate-950">{workspace === "planning" ? data.project.name : workspaceLabels[workspace]}</h1>
              <div className="mt-1 text-sm text-slate-500">{workspace === "planning" ? data.project.range : workspaceSubtitles[workspace]}</div>
            </div>
            <div className="flex items-center gap-2">
              {authAvailable && (
                <AuthControl
                  user={authUser}
                  error={authError}
                  busy={authBusy}
                  onSignIn={signIn}
                  onSignOut={signOut}
                />
              )}
              <button
                type="button"
                onClick={() => setTaskDialogDefaults({ taskType: workspace === "mine" ? "proposal" : "deliverable" })}
                className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700"
              >
                <Plus size={16} />
                Neu
              </button>
              <button
                type="button"
                onClick={() => setShowFilters((value) => !value)}
                className={`inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 ${planningWorkspaces.includes(workspace) ? "" : "hidden"}`}
              >
                <Filter size={16} />
                Filter
              </button>
            </div>
          </div>

          {planningWorkspaces.includes(workspace) && <div className="flex items-center gap-2 overflow-x-auto px-4 pb-3 lg:px-6">
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

        {planningWorkspaces.includes(workspace) && <section className="grid gap-3 px-4 py-4 sm:grid-cols-2 xl:grid-cols-4 lg:px-6">
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

        {showFilters && planningWorkspaces.includes(workspace) && (
          <section className="mx-4 mb-4 rounded-lg border border-slate-200 bg-white p-4 shadow-sm lg:mx-6">
            <div className="grid gap-3 xl:grid-cols-[minmax(260px,1fr)_repeat(4,180px)]">
              <label className="relative">
                <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
                <input
                  value={filters.query}
                  onChange={(event) => setFilters({ ...filters, query: event.target.value })}
                  className="h-10 w-full rounded-md border border-slate-200 pl-9 pr-3 text-sm outline-none focus:border-blue-400"
                  placeholder="Nach Aufgabe, DoD oder Workstream suchen"
                />
              </label>
              <CustomSelect value={filters.owner} onChange={(value) => setFilters({ ...filters, owner: value })} className="h-10 text-sm" options={[{ value: "Alle", label: "Alle" }, ...data.profiles.map((profile) => ({ value: profile.name, label: profile.name }))]} />
              <CustomSelect value={filters.status} onChange={(value) => setFilters({ ...filters, status: value })} className="h-10 text-sm" options={[{ value: "Alle", label: "Alle" }, ...taskStatuses.map((status) => ({ value: status, label: status }))]} />
              <CustomSelect value={filters.priority} onChange={(value) => setFilters({ ...filters, priority: value })} className="h-10 text-sm" options={[{ value: "Alle", label: "Alle" }, ...["P0", "P1", "P2", "P3", "P4"].map((priority) => ({ value: priority, label: priority }))]} />
              <CustomSelect value={filters.packageId} onChange={(value) => setFilters({ ...filters, packageId: value })} className="h-10 text-sm" options={[{ value: "Alle", label: "Alle Group Commitments" }, ...data.packages.map((pack) => ({ value: pack.id, label: pack.id }))]} />
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
          {workspace === "projects" && <ProjectsOverview data={data} tasks={data.tasks} />}
          {workspace === "team" && <TeamOverview data={data} tasks={data.tasks} pending={isPending} onUpdateProfile={updateProfile} />}
          {workspace === "sprint" && (
            <SprintScoreTableOverview
              data={data}
              pending={isPending}
              onOpen={(task) => setSelectedTaskId(task.id)}
              onReview={reviewTask}
              onRequestReview={(task) => updateTask(task, { status: "Review", reviewStatus: "requested", scoreFinal: false })}
              onChangeStatus={(task, status) => updateTask(task, { status })}
              onLockSprint={lockSprint}
              onUpdateSprint={updateSprint}
              onUpdateCommitment={updateSprintCommitment}
              onUpdateMeetingAttendance={updateMeetingAttendance}
              onAssignSprint={(task, sprintId) => updateTask(task, { sprintId })}
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
            />
          )}
          {workspace === "meetings" && <MeetingFinderOverview data={data} />}
          {workspace === "settings" && (
            <SettingsOverview
              data={data}
              source={source}
              authAvailable={authAvailable}
              authUserEmail={authUser?.email || ""}
              githubProviderTokenAvailable={githubProviderTokenAvailable}
              pending={isPending}
              notificationDispatchMessage={notificationDispatchMessage}
              sprintPlanningOptions={sprintPlanningOptions}
              plannedSprintCount={futureSprintDrafts(data.sprints, sprintPlanningOptions).length}
              onUpdateSprintPlanning={setSprintPlanningOptions}
              onCreateSprintPlan={createSprintPlan}
              onDispatchNotifications={dispatchNotifications}
            />
          )}

          {planningWorkspaces.includes(workspace) && (
          <>
          {view === "board" && (
            <div className="flex gap-4 overflow-x-auto pb-3">
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
                    className={`w-[360px] shrink-0 rounded-lg border bg-blue-50/60 transition ${dragOverStatus === status ? "border-blue-400 ring-2 ring-blue-200" : "border-blue-100"}`}
                  >
                    <div className="flex items-center justify-between border-b border-blue-100 px-4 py-3">
                      <div className="flex items-center gap-2">
                        <Circle size={15} className="text-blue-600" />
                        <h2 className="text-sm font-semibold text-slate-800">{status}</h2>
                        <span className="text-xs text-slate-500">({tasks.length})</span>
                      </div>
                      <button type="button" onClick={() => setTaskDialogDefaults({ status, taskType: status === "Vorschlag" ? "proposal" : "deliverable" })} className="grid h-7 w-7 place-items-center rounded-md text-slate-500 hover:bg-white" aria-label="Aufgabe hinzufügen">
                        <Plus size={15} />
                      </button>
                    </div>
                    <div className="grid gap-3 p-3">
                      {tasks.length ? tasks.map((task) => (
                        <TaskCard
                          key={task.id}
                          task={task}
                          pack={packageById(data.packages, task.packageId)}
                          ownerProfile={data.profiles.find((profile) => profile.name === task.owner)}
                          onOpen={(nextTask) => setSelectedTaskId(nextTask.id)}
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
              {data.packages.map((pack) => {
                const tasks = visibleTasks.filter((task) => task.packageId === pack.id);
                return (
                  <section key={pack.id} className="rounded-lg border border-slate-200 bg-white shadow-sm">
                    <div className="flex flex-wrap items-center justify-between gap-3 border-b border-slate-100 px-4 py-3">
                      <div>
                        <div className="text-xs font-semibold text-blue-700">{pack.id} · {pack.priority}</div>
                        <h2 className="text-base font-semibold text-slate-950">{pack.title}</h2>
                        <p className="mt-1 text-sm text-slate-500">{pack.goal}</p>
                      </div>
                      <span className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600">{tasks.length} Aufgaben</span>
                    </div>
                    <div className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-3">
                      {tasks.map((task) => (
                        <TaskCard
                          key={task.id}
                          task={task}
                          pack={pack}
                          ownerProfile={data.profiles.find((profile) => profile.name === task.owner)}
                          onOpen={(nextTask) => setSelectedTaskId(nextTask.id)}
                          onStatusChange={(nextTask, nextStatus) => updateTask(nextTask, { status: nextStatus })}
                        />
                      ))}
                    </div>
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
                    {["Status", "Owner", "Priorität", "Workstream", "Aufgabe", "Aufwand", "Zeitraum", "Zieltermin", "Abhängigkeit", "Definition of Done"].map((head) => (
                      <th key={head} className="border-b border-slate-200 px-3 py-3">{head}</th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {visibleTasks.map((task) => (
                    <tr key={task.id} className="border-b border-slate-100 align-top hover:bg-slate-50">
                      <td className="px-3 py-3">
                        <CustomSelect value={normalizeStatus(task.status)} onChange={(value) => updateTask(task, { status: value })} className="h-8 w-32 text-xs" options={taskStatuses.map((status) => ({ value: status, label: status }))} />
                      </td>
                      <td className="px-3 py-3">
                        <CustomSelect value={task.owner} onChange={(value) => updateTask(task, { owner: value })} className="h-8 w-32 text-xs" options={data.profiles.map((profile) => ({ value: profile.name, label: profile.name }))} />
                      </td>
                      <td className="px-3 py-3"><span className={`rounded-full border px-2 py-1 text-xs font-semibold ${priorityTone(task.priority)}`}>{task.priority}</span></td>
                      <td className="px-3 py-3 text-slate-600">{task.workstream}</td>
                      <td className="max-w-sm px-3 py-3">
                        <button type="button" onClick={() => setSelectedTaskId(task.id)} className="text-left font-semibold text-slate-900 hover:text-blue-700">{task.title}</button>
                        <p className="mt-1 line-clamp-2 text-xs text-slate-500">{task.description}</p>
                      </td>
                      <td className="px-3 py-3">{task.hours}h</td>
                      <td className="px-3 py-3">{dateRange(task)}</td>
                      <td className="px-3 py-3">{task.deadline}</td>
                      <td className="max-w-52 px-3 py-3 text-xs text-amber-700">{task.dependsOn || "-"}</td>
                      <td className="max-w-sm px-3 py-3 text-xs leading-5 text-slate-600">{task.definitionOfDone}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {view === "gantt" && (
            <GanttView tasks={visibleTasks} packages={data.packages} onOpen={(task) => setSelectedTaskId(task.id)} />
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
          blockers={selectedTaskBlockers}
          subIssues={selectedTaskSubIssues}
          teamProfiles={data.profiles}
          profiles={data.profiles.map((profile) => profile.name)}
          pending={isPending}
          onClose={() => setSelectedTaskId(null)}
          onUpdate={(patch) => updateTask(selectedTask, patch)}
          onAddComment={(comment) => addTaskComment(selectedTask, comment)}
          onReportBlocker={(payload) => reportTaskBlocker(selectedTask, payload)}
          onCreateSubIssue={() => setTaskDialogDefaults({ taskType: "sub_issue", parentTaskId: selectedTask.id, milestoneId: selectedTask.milestoneId, packageId: selectedTask.packageId, owner: selectedTask.owner, status: "Offen" })}
          onSyncGitHub={() => syncTaskToGitHub(selectedTask)}
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

function TeamOverview({
  data,
  tasks,
  pending,
  onUpdateProfile,
}: {
  data: PlanningData;
  tasks: Task[];
  pending: boolean;
  onUpdateProfile: (profile: Profile, patch: Partial<Profile>) => void;
}) {
  return (
    <div className="grid gap-3 lg:grid-cols-2 xl:grid-cols-3">
      {data.profiles.map((profile) => {
        const ownedTasks = tasks.filter((task) => task.owner === profile.name);
        const openTasks = ownedTasks.filter((task) => normalizeStatus(task.status) !== "Erledigt");
        const highPriority = ownedTasks.filter((task) => ["P0", "P1"].includes(task.priority));
        const load = ownedTasks.reduce((sum, task) => sum + task.hours, 0);
        const isDeputy = profile.platformRole === "deputy";
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
                    disabled={pending}
                    onChange={(value) => {
                      const platformRole = value as PlatformRole;
                      onUpdateProfile(profile, {
                        platformRole,
                        orgRole: platformRole === "ceo" ? "CEO" : platformRole === "founder" ? "Founder" : profile.orgRole,
                        deputyFor: platformRole === "deputy" ? profile.deputyFor || "volkan" : "",
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
                    disabled={pending}
                    onChange={(event) => onUpdateProfile(profile, { orgRole: event.target.value })}
                    className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm font-normal text-slate-800 disabled:opacity-60"
                  />
                </label>
              </div>
              <label className="grid gap-1 text-xs font-semibold text-slate-500">
                GitHub Login
                <input
                  value={profile.githubLogin}
                  disabled={pending}
                  onChange={(event) => onUpdateProfile(profile, { githubLogin: event.target.value })}
                  className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm font-normal text-slate-800 disabled:opacity-60"
                />
              </label>
              <label className="grid gap-1 text-xs font-semibold text-slate-500">
                Fokus
                <textarea
                  value={profile.focus || ""}
                  disabled={pending}
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
                        disabled={pending}
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
                    disabled={pending}
                    onChange={(event) => onUpdateProfile(profile, { weeklyCapacity: Number(event.target.value) })}
                    className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm font-normal text-slate-800 disabled:opacity-60"
                  />
                </label>
                <label className="grid gap-1 text-xs font-semibold text-slate-500">
                  Vertreter für
                  <CustomSelect
                    value={profile.deputyFor || ""}
                    disabled={pending || !isDeputy}
                    onChange={(value) => onUpdateProfile(profile, { deputyFor: value })}
                    className="h-9 text-sm"
                    options={[{ value: "", label: "Keine Vertretung" }, ...data.profiles.filter((item) => item.platformRole === "ceo" || item.id === profile.deputyFor).map((item) => ({ value: item.id, label: item.name }))]}
                  />
                </label>
                <div className="grid grid-cols-2 gap-2">
                  <label className="grid gap-1 text-xs font-semibold text-slate-500">
                    Von
                    <CustomDatePicker value={profile.deputyActiveFrom || ""} disabled={pending || !isDeputy} onChange={(value) => onUpdateProfile(profile, { deputyActiveFrom: value })} className="h-9 text-sm" />
                  </label>
                  <label className="grid gap-1 text-xs font-semibold text-slate-500">
                    Bis
                    <CustomDatePicker value={profile.deputyActiveUntil || ""} disabled={pending || !isDeputy} onChange={(value) => onUpdateProfile(profile, { deputyActiveUntil: value })} className="h-9 text-sm" />
                  </label>
                </div>
              </div>
              <p className="text-xs leading-5 text-slate-500">
                Änderungen sind CEO-geschützt. Deputy bekommt operative Rechte, aber kein Decision-Log-Edit.
              </p>
            </div>
          </article>
        );
      })}
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
  sprintLockMessage: string;
}) {
  const [selectedSprintId, setSelectedSprintId] = useState(data.sprints[0]?.id || "");
  const [selectedReviewTaskId, setSelectedReviewTaskId] = useState("");
  const [reviewComment, setReviewComment] = useState("");
  const [reviewChecklist, setReviewChecklist] = useState({
    acceptanceCriteriaMet: false,
    evidenceProvided: false,
    communicationClear: false,
    blockerHandled: false,
  });
  const reviewScore = reviewChecklistScore(reviewChecklist);
  const sprint = data.sprints.find((item) => item.id === selectedSprintId) || data.sprints[0];
  const sprintTasks = sprint ? data.tasks.filter((task) => task.sprintId === sprint.id) : data.tasks;
  const otherTasks = sprint ? data.tasks.filter((task) => task.sprintId !== sprint.id) : [];
  const unassignedTasks = data.tasks.filter((task) => !task.sprintId);
  const scoreRows = data.profiles.map((profile) => {
    const row = founderScore(sprintTasks, profile);
    const profileTasks = sprintTasks.filter((task) => task.owner === profile.name);
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
            <CustomSelect value={sprint.id} onChange={setSelectedSprintId} className="h-9 text-sm" options={data.sprints.map((item) => ({ value: item.id, label: item.name }))} />
          </label>
          <label className="grid gap-1 text-xs font-semibold text-slate-500">
            Start
            <CustomDatePicker value={sprint.startDate} disabled={pending || sprint.scoreLocked} onChange={(value) => onUpdateSprint(sprint, { startDate: value })} className="h-9 text-sm" />
          </label>
          <label className="grid gap-1 text-xs font-semibold text-slate-500">
            Ende
            <CustomDatePicker value={sprint.endDate} disabled={pending || sprint.scoreLocked} onChange={(value) => onUpdateSprint(sprint, { endDate: value })} className="h-9 text-sm" />
          </label>
          <label className="grid gap-1 text-xs font-semibold text-slate-500">
            Review bis
            <CustomDatePicker mode="datetime" value={sprint.reviewDueAt ? sprint.reviewDueAt.slice(0, 16) : ""} disabled={pending || sprint.scoreLocked} onChange={(value) => onUpdateSprint(sprint, { reviewDueAt: value })} className="h-9 text-sm" />
          </label>
          <label className="grid gap-1 text-xs font-semibold text-slate-500">
            Status
            <CustomSelect
              value={sprint.status}
              disabled={pending || sprint.scoreLocked}
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
            disabled={pending || sprint.scoreLocked}
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
                  return (
                    <tr key={profile.id} className="hover:bg-slate-50">
                      <td className="border-b border-slate-100 px-4 py-3">
                        <div className="font-semibold text-slate-950">{profile.name}</div>
                        <div className="text-xs text-slate-500">{roleLabel(profile)}</div>
                      </td>
                      <td className="border-b border-slate-100 px-3 py-3">
                        <CustomSelect
                          value={attendance.status}
                          disabled={pending}
                          onChange={(value) => patchAttendance({ status: value as MeetingAttendance["status"] })}
                          className="h-8 w-36 text-xs"
                          options={[
                            { value: "pending", label: "Offen" },
                            { value: "present", label: "Anwesend" },
                            { value: "excused", label: "Entschuldigt" },
                            { value: "late_excused", label: "Spät entschuldigt" },
                            { value: "unexcused", label: "Nicht akzeptiert" },
                            { value: "no_show", label: "No-Show" },
                          ]}
                        />
                      </td>
                      <td className="border-b border-slate-100 px-3 py-3">
                        <input
                          value={attendance.absenceReason}
                          disabled={pending}
                          onChange={(event) => patchAttendance({ absenceReason: event.target.value })}
                          className="h-8 w-64 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 disabled:bg-slate-50"
                          placeholder="z.B. Krankheit, Familie, nicht verschiebbar"
                        />
                      </td>
                      <td className="border-b border-slate-100 px-3 py-3">
                        <textarea
                          value={attendance.writtenUpdate}
                          disabled={pending}
                          onChange={(event) => patchAttendance({ writtenUpdate: event.target.value })}
                          className="min-h-12 w-80 resize-y rounded-md border border-slate-200 bg-white px-2 py-1 text-xs leading-5 text-slate-700 disabled:bg-slate-50"
                          placeholder="Kurzupdate, Blocker, nächster Schritt"
                        />
                      </td>
                      <td className="border-b border-slate-100 px-3 py-3">
                        <input
                          type="checkbox"
                          checked={attendance.reasonAccepted}
                          disabled={pending}
                          onChange={(event) => patchAttendance({ reasonAccepted: event.target.checked })}
                          aria-label="Grund akzeptiert"
                        />
                      </td>
                      <td className="border-b border-slate-100 px-3 py-3">
                        <CustomSelect value={attendance.points} disabled={pending} onChange={(value) => patchAttendance({ points: Number(value) })} className="h-8 w-20 text-xs" options={[0, 1, 2, 3, 4].map((point) => ({ value: String(point), label: String(point) }))} />
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
                <th className="border-b border-slate-200 px-3 py-3 font-semibold">Review</th>
                <th className="border-b border-slate-200 px-3 py-3 font-semibold">Score</th>
                <th className="border-b border-slate-200 px-3 py-3 font-semibold">Sprint</th>
                <th className="border-b border-slate-200 px-3 py-3 font-semibold">Zeitraum</th>
                <th className="border-b border-slate-200 px-3 py-3 font-semibold">Review-Aktion</th>
              </tr>
            </thead>
            <tbody>
              {sprintTasks.map((task) => (
                <tr key={task.id} className="hover:bg-slate-50">
                  <td className="max-w-[360px] border-b border-slate-100 px-4 py-3">
                    <button type="button" onClick={() => onOpen(task)} className="block truncate text-left font-semibold text-slate-950 hover:text-blue-700">
                      {task.title}
                    </button>
                    <div className="mt-1 truncate text-xs text-slate-500">{task.workstream} · {task.priority} · {task.hours}h</div>
                    {(task.carriedFromSprintId || task.sprintOutcome) && (
                      <div className="mt-1 flex flex-wrap gap-1">
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
              {[
                ["acceptanceCriteriaMet", "Acceptance Criteria erfüllt"],
                ["evidenceProvided", "Evidence/Link liegt vor"],
                ["communicationClear", "Ergebnis und Kommunikation nachvollziehbar"],
                ["blockerHandled", "Blocker/Abhängigkeiten sauber geklärt"],
              ].map(([key, label]) => (
                <label key={key} className="flex items-center justify-between gap-3 rounded-md border border-slate-100 px-3 py-2 text-sm text-slate-700">
                  <span>{label}</span>
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
              {[
                ["acceptanceCriteriaMet", "Acceptance Criteria erfüllt"],
                ["evidenceProvided", "Evidence/Link liegt vor"],
                ["communicationClear", "Ergebnis und Kommunikation nachvollziehbar"],
                ["blockerHandled", "Blocker/Abhängigkeiten sauber geklärt"],
              ].map(([key, label]) => (
                <label key={key} className="flex items-center justify-between gap-3 rounded-md border border-slate-100 px-3 py-2 text-sm text-slate-700">
                  <span>{label}</span>
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
}: {
  data: PlanningData;
  currentProfileId: string;
  pending: boolean;
  onCreate: (payload: { title: string; context: string; decision: string; requiredProfileIds: string[] }) => void;
  onConfirm: (decisionId: number) => void;
  onEdit: (decisionId: number, payload: { title: string; context: string; decision: string; requiredProfileIds: string[] }) => void;
  onObject: (decisionId: number, comment: string) => void;
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
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
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
                  {decision.confirmedProfileIds.length}/{decision.requiredProfileIds.length} bestätigt · {auditEntries.length} Audit-Einträge
                </span>
              </span>
            </button>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">{decisionStatusLabel(decision.status)}</span>
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

function MeetingFinderOverview({ data }: { data: PlanningData }) {
  const workingHours = data.availability.filter((entry) => entry.type === "working_hours");
  const absences = data.availability.filter((entry) => entry.type === "vacation" || entry.type === "sick" || entry.type === "busy");

  return (
    <div className="grid gap-4 xl:grid-cols-[420px_1fr]">
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-semibold text-slate-950">Meeting Finder V1</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">
          V1 nutzt manuelle Arbeitszeiten und Abwesenheiten. Google Calendar Sync bleibt späterer Ausbau.
        </p>
        <div className="mt-4 grid grid-cols-2 gap-2 text-sm">
          <div className="rounded-md bg-slate-50 p-3"><div className="text-xs text-slate-500">Arbeitszeiten</div><div className="font-semibold">{workingHours.length}</div></div>
          <div className="rounded-md bg-slate-50 p-3"><div className="text-xs text-slate-500">Blocker</div><div className="font-semibold">{absences.length}</div></div>
        </div>
      </section>
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <h2 className="text-base font-semibold text-slate-950">Team-Slots</h2>
        <div className="mt-4 grid gap-2">
          {data.profiles.map((profile) => (
            <div key={profile.id} className="flex items-center justify-between rounded-md border border-slate-100 px-3 py-2 text-sm">
              <span className="font-medium text-slate-800">{profile.name}</span>
              <span className="text-slate-500">{profile.weeklyCapacity}h Kapazität · {roleLabel(profile)}</span>
            </div>
          ))}
        </div>
      </section>
    </div>
  );
}

function SettingsOverview({
  data,
  source,
  authAvailable,
  authUserEmail,
  githubProviderTokenAvailable,
  pending,
  notificationDispatchMessage,
  sprintPlanningOptions,
  plannedSprintCount,
  onUpdateSprintPlanning,
  onCreateSprintPlan,
  onDispatchNotifications,
}: {
  data: PlanningData;
  source: "seed" | "supabase";
  authAvailable: boolean;
  authUserEmail: string;
  githubProviderTokenAvailable: boolean;
  pending: boolean;
  notificationDispatchMessage: string;
  sprintPlanningOptions: SprintPlanningOptions;
  plannedSprintCount: number;
  onUpdateSprintPlanning: (options: SprintPlanningOptions) => void;
  onCreateSprintPlan: (options: SprintPlanningOptions) => void;
  onDispatchNotifications: () => void;
}) {
  const pendingNotifications = data.notificationEvents.filter((event) => event.status === "pending");
  const failedNotifications = data.notificationEvents.filter((event) => event.status === "failed");
  const recentDeliveries = data.notificationDeliveries.slice(0, 5);

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
            <h2 className="text-base font-semibold text-slate-950">Sprint-Planung</h2>
            <p className="mt-1 text-sm text-slate-500">Legt automatisch die nächsten Sprint-Zeiträume an. Der aktuelle Sprint bleibt im Scoreboard sichtbar.</p>
          </div>
          <button
            type="button"
            disabled={pending || plannedSprintCount === 0}
            onClick={() => onCreateSprintPlan(sprintPlanningOptions)}
            className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            {plannedSprintCount > 0 ? `${plannedSprintCount} Sprint${plannedSprintCount === 1 ? "" : "s"} anlegen` : "Plan aktuell"}
          </button>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-2 xl:grid-cols-[minmax(220px,1fr)_140px_140px_140px]">
          <label className="grid gap-1 text-xs font-semibold text-slate-500">
            Namensmuster
            <input
              value={sprintPlanningOptions.namePattern}
              onChange={(event) => onUpdateSprintPlanning({ ...sprintPlanningOptions, namePattern: event.target.value })}
              className="h-9 min-w-0 rounded-md border border-slate-200 bg-white px-2 text-sm font-normal text-slate-900"
              placeholder="Sprint #"
            />
          </label>
          <label className="grid gap-1 text-xs font-semibold text-slate-500">
            Rhythmus (Wochen)
            <input
              type="number"
              min={1}
              max={12}
              value={sprintPlanningOptions.rhythmWeeks}
              onChange={(event) => onUpdateSprintPlanning({ ...sprintPlanningOptions, rhythmWeeks: Number(event.target.value) })}
              className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm font-normal text-slate-900"
            />
          </label>
          <label className="grid gap-1 text-xs font-semibold text-slate-500">
            Wochen voraus
            <input
              type="number"
              min={1}
              max={52}
              value={sprintPlanningOptions.horizonWeeks}
              onChange={(event) => onUpdateSprintPlanning({ ...sprintPlanningOptions, horizonWeeks: Number(event.target.value) })}
              className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm font-normal text-slate-900"
            />
          </label>
          <label className="grid gap-1 text-xs font-semibold text-slate-500">
            Bis Sprint-Nr.
            <input
              type="number"
              min={0}
              value={sprintPlanningOptions.targetSprintNumber || ""}
              onChange={(event) => onUpdateSprintPlanning({ ...sprintPlanningOptions, targetSprintNumber: Number(event.target.value) })}
              className="h-9 rounded-md border border-slate-200 bg-white px-2 text-sm font-normal text-slate-900"
              placeholder="optional"
            />
          </label>
        </div>
      </section>
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm xl:col-span-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-950">Google Chat Outbox</h2>
            <p className="mt-1 text-sm text-slate-500">Pending-Events werden erst nach Konfiguration von GOOGLE_CHAT_WEBHOOK_URL extern gesendet.</p>
          </div>
          <button
            type="button"
            disabled={pending || !pendingNotifications.length}
            onClick={onDispatchNotifications}
            className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Pending senden
          </button>
        </div>
        <div className="mt-4 grid gap-3 md:grid-cols-3">
          <div className="rounded-md bg-slate-50 px-3 py-2 text-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Pending</div>
            <div className="mt-1 text-2xl font-semibold text-slate-950">{pendingNotifications.length}</div>
          </div>
          <div className="rounded-md bg-slate-50 px-3 py-2 text-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Fehlgeschlagen</div>
            <div className="mt-1 text-2xl font-semibold text-slate-950">{failedNotifications.length}</div>
          </div>
          <div className="rounded-md bg-slate-50 px-3 py-2 text-sm">
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Deliveries</div>
            <div className="mt-1 text-2xl font-semibold text-slate-950">{data.notificationDeliveries.length}</div>
          </div>
        </div>
        {notificationDispatchMessage && (
          <p className="mt-3 rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-sm text-blue-800">{notificationDispatchMessage}</p>
        )}
        <div className="mt-4 grid gap-2">
          {pendingNotifications.slice(0, 5).map((event) => (
            <div key={event.id} className="flex items-center justify-between gap-3 rounded-md border border-slate-100 px-3 py-2 text-sm">
              <span className="min-w-0">
                <span className="block truncate font-medium text-slate-800">{event.title}</span>
                <span className="text-xs text-slate-500">{event.type} · {event.entityType}</span>
              </span>
              <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-xs font-semibold text-amber-700">pending</span>
            </div>
          ))}
          {!pendingNotifications.length && <div className="rounded-md border border-dashed border-slate-200 px-3 py-4 text-center text-sm text-slate-500">Keine pending Benachrichtigungen.</div>}
        </div>
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
  onSignIn,
  onSignOut,
}: {
  user: User | null;
  error: string;
  busy: boolean;
  onSignIn: () => void;
  onSignOut: () => void;
}) {
  const [open, setOpen] = useState(false);
  const githubLogin = getUserMetadataString(user, "user_name") || getUserMetadataString(user, "preferred_username");
  const avatarUrl = getUserMetadataString(user, "avatar_url");
  const displayName = getUserMetadataString(user, "full_name") || getUserMetadataString(user, "name") || githubLogin || user?.email || "";

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700"
      >
        <Users size={16} />
        {user ? "Angemeldet" : "Login"}
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-30 w-80 rounded-lg border border-slate-200 bg-white p-4 text-sm shadow-xl">
          {user ? (
            <div className="grid gap-4">
              <div className="flex min-w-0 items-center gap-3">
                {avatarUrl ? (
                  <Image
                    src={avatarUrl}
                    alt=""
                    width={44}
                    height={44}
                    className="h-11 w-11 shrink-0 rounded-full border border-slate-200 bg-slate-100"
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
              <button
                type="button"
                onClick={onSignOut}
                disabled={busy}
                className="h-9 rounded-md bg-slate-900 px-3 text-sm font-semibold text-white disabled:opacity-60"
              >
                Abmelden
              </button>
            </div>
          ) : (
            <form
              className="grid gap-3"
              onSubmit={(event) => {
                event.preventDefault();
                onSignIn();
              }}
            >
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">GitHub Login</div>
                <p className="mt-1 text-xs leading-5 text-slate-500">Rollen werden über das gemappte GitHub-Profil in Supabase bestimmt.</p>
              </div>
              {error && <p className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-xs text-red-700">{error}</p>}
              <button
                type="submit"
                disabled={busy}
                className="h-9 rounded-md bg-blue-600 px-3 text-sm font-semibold text-white disabled:opacity-60"
              >
                {busy ? "GitHub wird geöffnet" : "Mit GitHub anmelden"}
              </button>
            </form>
          )}
        </div>
      )}
    </div>
  );
}

function getUserMetadataString(user: User | null, key: string) {
  const value = user?.user_metadata?.[key];
  return typeof value === "string" ? value : "";
}

function GanttView({ tasks, packages, onOpen }: { tasks: Task[]; packages: Package[]; onOpen: (task: Task) => void }) {
  const start = new Date("2026-05-25");
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
            const taskStart = new Date(task.startDate || start);
            const taskEnd = new Date(task.endDate || task.startDate || start);
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
                {task.dependsOn && <span className="absolute right-2 top-4 h-2 w-2 rounded-full bg-amber-400" title="Hat Abhängigkeit" />}
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
  const defaultOwner = defaults.owner || data.profiles[0]?.name || "Volkan";
  const defaultMilestoneId = defaults.milestoneId || data.milestones.find((milestone) => milestone.status === "active")?.id || data.milestones[0]?.id || "";
  const groupCommitments = data.packages.filter((pack) => !defaultMilestoneId || !pack.milestoneId || pack.milestoneId === defaultMilestoneId);
  const [draft, setDraft] = useState<NewTaskDraft>({
    title: "",
    description: "",
    problemStatement: "",
    intendedOutcome: "",
    scopeConstraints: "",
    acceptanceCriteria: "",
    evidenceRequired: "",
    taskType: defaults.taskType || "deliverable",
    parentTaskId: defaults.parentTaskId || "",
    milestoneId: defaultMilestoneId,
    packageId: defaults.packageId || groupCommitments[0]?.id || data.packages[0]?.id || "",
    sprintId: defaults.sprintId || activeSprint?.id || "",
    owner: defaultOwner,
    priority: defaults.priority || "P2",
    status: defaults.status || "Offen",
    workstream: "",
    startDate: defaults.startDate || activeSprint?.startDate || "",
    endDate: defaults.endDate || activeSprint?.endDate || "",
    hours: defaults.hours || 2,
    definitionOfDone: "",
  });
  const parentTask = data.tasks.find((task) => task.id === draft.parentTaskId);
  const visibleGroupCommitments = data.packages.filter((pack) => !draft.milestoneId || !pack.milestoneId || pack.milestoneId === draft.milestoneId);
  const canCreate = draft.title.trim().length >= 3 && (draft.taskType !== "sub_issue" || draft.parentTaskId);

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
              <CustomSelect value={draft.taskType} onChange={(value) => setDraft((current) => ({ ...current, taskType: value as NewTaskDraft["taskType"] }))} className="h-9 text-sm" options={[{ value: "deliverable", label: "Deliverable" }, { value: "proposal", label: "Vorschlag" }, { value: "sub_issue", label: "Sub-Issue" }]} />
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

function TaskDetailPanel({
  task,
  pack,
  comments,
  blockers,
  subIssues,
  teamProfiles,
  profiles,
  pending,
  onClose,
  onUpdate,
  onAddComment,
  onReportBlocker,
  onCreateSubIssue,
  onSyncGitHub,
}: {
  task: Task;
  pack?: Package;
  comments: TaskComment[];
  blockers: TaskBlocker[];
  subIssues: Task[];
  teamProfiles: Profile[];
  profiles: string[];
  pending: boolean;
  onClose: () => void;
  onUpdate: (patch: Partial<Task>) => void;
  onAddComment: (comment: string) => void;
  onReportBlocker: (payload: { reason: string; impact: string; needsHelpFrom: string }) => void;
  onCreateSubIssue: () => void;
  onSyncGitHub: () => void;
}) {
  const [blockerDraft, setBlockerDraft] = useState({ reason: "", impact: "", needsHelpFrom: "" });
  const profileName = (profileId: string) => teamProfiles.find((profile) => profile.id === profileId)?.name || profileId || "Unbekannt";

  return (
    <aside className="fixed inset-y-0 right-0 z-40 w-full max-w-xl overflow-y-auto border-l border-slate-200 bg-white shadow-2xl">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-slate-200 bg-white px-5 py-4">
        <div>
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Aufgabendetails</div>
          <h2 className="mt-1 text-lg font-semibold text-slate-950">{task.title}</h2>
          <Link href={`/tasks/${task.id}`} className="mt-2 inline-flex h-8 items-center rounded-md border border-slate-200 px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50">
            Große Detailseite öffnen
          </Link>
        </div>
        <button type="button" onClick={onClose} className="grid h-9 w-9 place-items-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50" aria-label="Detailpanel schließen">
          ×
        </button>
      </div>

      <div className="grid gap-4 p-5">
        <section className="rounded-lg border border-slate-200 p-4">
          <div className="grid gap-3 sm:grid-cols-2">
            <label className="grid gap-1 text-xs font-semibold text-slate-500">
              Status
              <CustomSelect value={normalizeStatus(task.status)} onChange={(value) => onUpdate({ status: value })} className="h-9 text-sm" options={taskStatuses.map((status) => ({ value: status, label: status }))} />
            </label>
            <label className="grid gap-1 text-xs font-semibold text-slate-500">
              Owner
              <CustomSelect value={task.owner} onChange={(value) => onUpdate({ owner: value })} className="h-9 text-sm" options={profiles.map((profile) => ({ value: profile, label: profile }))} />
            </label>
            <div>
              <div className="text-xs font-semibold text-slate-500">Group Commitment</div>
              <div className="mt-1 text-sm text-slate-800">{pack ? `${pack.id} · ${pack.title}` : "ohne Group Commitment"}</div>
            </div>
            <div>
              <div className="text-xs font-semibold text-slate-500">Zeitraum</div>
              <div className="mt-1 flex items-center gap-2 text-sm text-slate-800"><CalendarDays size={15} />{dateRange(task)}</div>
            </div>
            <div>
              <div className="text-xs font-semibold text-slate-500">Review</div>
              <div className="mt-1 text-sm text-slate-800">{reviewLabel(task.reviewStatus)} · {task.scoreFinal ? `${task.scorePoints} Punkte final` : "noch nicht final bewertet"}</div>
            </div>
          </div>
          {(task.carriedFromSprintId || task.carryoverReason || task.sprintOutcome) && (
            <div className="mt-3 rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-sm leading-6 text-blue-900">
              <div className="font-semibold">Sprint-Verlauf</div>
              {task.carriedFromSprintId && <div>Aus Sprint {task.carriedFromSprintId} übertragen.</div>}
              {task.sprintOutcome && <div>Outcome im ursprünglichen Sprint: {task.sprintOutcome}</div>}
              {task.carryoverReason && <div>{task.carryoverReason}</div>}
            </div>
          )}
        </section>

        <TaskCommentThread
          comments={comments}
          profiles={teamProfiles}
          pending={pending}
          onAddComment={onAddComment}
        />

        <section className="rounded-lg border border-slate-200 p-4">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-950">GitHub Sync</h3>
              <p className="mt-1 text-xs text-slate-500">One-way Backup ins Management-Repo.</p>
            </div>
            <button
              type="button"
              disabled={pending || task.githubSyncStatus === "pending"}
              onClick={onSyncGitHub}
              className="h-8 rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {task.githubSyncStatus === "pending" ? "Synchronisiert..." : "Jetzt spiegeln"}
            </button>
          </div>
          <div className="mt-2 grid gap-2 text-sm leading-6 text-slate-600">
            <p>{task.githubRepo || "findmydoc-platform/management"} · {syncLabel(task.githubSyncStatus)}</p>
            {task.githubIssueUrl ? (
              <a href={task.githubIssueUrl} target="_blank" rel="noreferrer" className="text-blue-700 hover:underline">{task.githubIssueUrl}</a>
            ) : (
              <p>Noch kein GitHub-Issue gespiegelt.</p>
            )}
            {task.githubLastSyncedAt && <p className="text-xs text-slate-500">Zuletzt gespiegelt: {task.githubLastSyncedAt}</p>}
            {task.githubSyncError && <p className="text-red-700">{task.githubSyncError}</p>}
          </div>
        </section>

        <section className="rounded-lg border border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-950">Beschreibung</h3>
          <p className="mt-2 text-sm leading-6 text-slate-600">{task.description}</p>
        </section>

        <section className="rounded-lg border border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-950">Definition of Done</h3>
          <p className="mt-2 text-sm leading-6 text-slate-600">{task.definitionOfDone}</p>
        </section>

        <section className="rounded-lg border border-slate-200 p-4">
          <h3 className="text-sm font-semibold text-slate-950">Abhängigkeiten & Evidence</h3>
          <div className="mt-2 grid gap-2 text-sm leading-6 text-slate-600">
            <p>{task.dependsOn || "Keine harte Abhängigkeit erfasst."}</p>
            <p>{task.evidenceLink || task.issueUrl || "Noch kein Evidence-Link hinterlegt."}</p>
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
      </div>
    </aside>
  );
}


