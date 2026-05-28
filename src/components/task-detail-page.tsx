"use client";

import { AlertTriangle, ArrowLeft, CalendarDays, CircleHelp, GitBranch, Link2, MessageSquareWarning, Pencil, Save, X } from "lucide-react";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState, useTransition } from "react";
import { AppSidebar } from "@/components/app-sidebar";
import { hasGitHubIssue, reviewLabel, syncLabel, taskRelationsFor } from "@/lib/platform";
import { normalizeStatus, priorityTone, statusTone, taskStatuses } from "@/lib/status";
import { getBrowserSupabase } from "@/lib/supabase";
import type { DecisionTaskLink, Milestone, Package, PlanningData, Profile, Sprint, Task, TaskActivity, TaskBlocker, TaskComment, TaskExternalComment, TaskFocusItem, TaskRelation, TaskRelationType, TaskStatus } from "@/lib/types";
import { CustomSelect } from "@/components/custom-select";
import { CustomDatePicker } from "@/components/custom-date-picker";
import { TaskChecklist } from "@/components/task-checklist";
import { CommentBody, TaskCommentThread } from "@/components/task-comment-thread";
import { getRememberedGitHubProviderToken, hasRememberedGitHubProviderToken, rememberGitHubProviderToken } from "@/lib/github-provider-token";

type Props = {
  task: Task;
  pack?: Package;
  packages: Package[];
  sprint?: Sprint;
  subIssues: Task[];
  comments: TaskComment[];
  externalComments: TaskExternalComment[];
  activities: TaskActivity[];
  blockers: TaskBlocker[];
  taskRelations: TaskRelation[];
  allTasks: Task[];
  profiles: Profile[];
  sprints: Sprint[];
  milestones: Milestone[];
  decisions?: PlanningData["decisions"];
  decisionTaskLinks?: DecisionTaskLink[];
  focusItems?: TaskFocusItem[];
  source: "seed" | "supabase";
  commentImportNotice?: string;
};

type EditableTaskState = Pick<Task, "status" | "priority" | "owner" | "packageId" | "sprintId" | "milestoneId" | "startDate" | "endDate" | "deadline" | "dependsOn" | "evidenceLink" | "problemStatement" | "intendedOutcome" | "scopeConstraints" | "acceptanceCriteria" | "evidenceRequired" | "definitionOfDone">;
type DetailsDraft = Pick<EditableTaskState, "priority" | "owner" | "packageId" | "sprintId" | "milestoneId" | "startDate" | "endDate" | "deadline">;

function formatDate(value: string) {
  if (!value) return "ohne Datum";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "short", year: "numeric" }).format(date);
}

function dateRange(task: Task) {
  if (!task.startDate && !task.endDate) return task.deadline || "ohne Datum";
  if (task.startDate === task.endDate) return formatDate(task.startDate);
  return `${formatDate(task.startDate)} - ${formatDate(task.endDate)}`;
}

function availableStatusOptions(status: string, canManageTaskMeta: boolean) {
  if (canManageTaskMeta) return taskStatuses;
  if (normalizeStatus(status) === "Nacharbeit") return ["In Arbeit", "Review", "Blockiert"] as TaskStatus[];
  return taskStatuses.filter((item) => item !== "Erledigt");
}

function relationshipHelpText(title: string) {
  if (title === "Wartet auf") return "Diese Aufgabe kann erst sauber weitergehen, wenn die verknüpfte Aufgabe erledigt oder ausreichend geklärt ist.";
  if (title === "Blockiert") return "Diese Aufgabe hält andere Aufgaben auf. Wenn sie verspätet ist, können die gelisteten Aufgaben ebenfalls nicht sauber abgeschlossen werden.";
  if (title === "Verknüpft mit") return "Diese Aufgaben hängen fachlich zusammen, blockieren sich aber nicht zwingend gegenseitig.";
  return "Zeigt, wie diese Aufgabe mit anderen Aufgaben verbunden ist.";
}

function relationTypeLabel(type: TaskRelationType) {
  if (type === "blocked_by") return "Wartet auf";
  if (type === "blocks") return "Blockiert";
  return "Verknüpft mit";
}

function focusStatusLabel(status: TaskFocusItem["status"]) {
  if (status === "done") return "Erledigt";
  if (status === "blocked") return "Blockiert";
  if (status === "deferred") return "Verschoben";
  if (status === "needs_decision") return "Entscheidung nötig";
  return "Geplant";
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

function RelationshipPanelList({
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

function ProfileAvatar({ profile }: { profile?: Profile }) {
  const login = profile?.githubLogin || "";
  return (
    <span className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full bg-slate-100 text-xs font-semibold text-slate-700">
      {login ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`https://github.com/${login}.png?size=72`} alt="" className="h-full w-full object-cover" />
      ) : (
        profile?.name?.slice(0, 1).toUpperCase() || "?"
      )}
    </span>
  );
}

export function TaskDetailPage({
  task,
  pack,
  packages,
  sprint,
  subIssues,
  comments,
  externalComments,
  activities,
  blockers,
  taskRelations,
  allTasks,
  profiles,
  sprints,
  milestones,
  decisions = [],
  decisionTaskLinks = [],
  focusItems = [],
  source,
  commentImportNotice = "",
}: Props) {
  const [taskComments, setTaskComments] = useState(comments);
  const [taskExternalComments, setTaskExternalComments] = useState(externalComments);
  const [taskActivities, setTaskActivities] = useState(activities);
  const [localCommentImportNotice, setLocalCommentImportNotice] = useState(commentImportNotice);
  const [githubCommentImportPending, setGithubCommentImportPending] = useState(false);
  const autoImportedGitHubCommentsRef = useRef(false);
  const [relations, setRelations] = useState(taskRelations);
  const [relationDraft, setRelationDraft] = useState<{ relationType: TaskRelationType; relatedTaskId: string; note: string }>({
    relationType: "blocked_by",
    relatedTaskId: "",
    note: "",
  });
  const [meta, setMeta] = useState<EditableTaskState>({
    status: normalizeStatus(task.status),
    priority: task.priority,
    owner: task.owner,
    packageId: task.packageId,
    sprintId: task.sprintId,
    milestoneId: task.milestoneId || "",
    startDate: task.startDate,
    endDate: task.endDate,
    deadline: task.deadline,
    dependsOn: task.dependsOn,
    evidenceLink: task.evidenceLink || task.issueUrl,
    problemStatement: task.problemStatement || task.description,
    intendedOutcome: task.intendedOutcome || "",
    scopeConstraints: task.scopeConstraints || "",
    acceptanceCriteria: task.acceptanceCriteria || "",
    evidenceRequired: task.evidenceRequired || "",
    definitionOfDone: task.definitionOfDone || "",
  });
  const [error, setError] = useState("");
  const [saveState, setSaveState] = useState("");
  const [briefEditing, setBriefEditing] = useState(false);
  const [detailsEditing, setDetailsEditing] = useState(false);
  const [detailsEditSnapshot, setDetailsEditSnapshot] = useState<DetailsDraft | null>(null);
  const [githubState, setGithubState] = useState({
    githubRepo: task.githubRepo,
    githubIssueNumber: task.githubIssueNumber,
    githubIssueUrl: task.githubIssueUrl,
    githubSyncStatus: task.githubSyncStatus,
    githubLastSyncedAt: task.githubLastSyncedAt,
    githubSyncError: task.githubSyncError,
  });
  const [currentRole, setCurrentRole] = useState<Profile["platformRole"] | "">(source === "seed" ? "ceo" : "");
  const [githubProviderTokenAvailable, setGithubProviderTokenAvailable] = useState(hasRememberedGitHubProviderToken());
  const [isPending, startTransition] = useTransition();
  const ownerProfile = profiles.find((profile) => profile.name === meta.owner || profile.id === meta.owner);
  const creatorProfile = profiles.find((profile) => profile.name === task.createdBy || profile.id === task.createdBy)
    || profiles.find((profile) => profile.platformRole === "ceo")
    || ownerProfile;
  const currentSprint = sprints.find((item) => item.id === meta.sprintId) || sprint;
  const currentMilestone = milestones.find((item) => item.id === meta.milestoneId);
  const currentPackage = packages.find((item) => item.id === meta.packageId) || pack;
  const profileName = (profileId: string) => profiles.find((profile) => profile.id === profileId)?.name || profileId || "Unbekannt";
  const openBlockers = blockers.filter((blocker) => blocker.status === "open");
  const relationGroups = taskRelationsFor(task.id, relations);
  const taskById = new Map(allTasks.map((item) => [item.id, item]));
  const waitsOn = relationGroups.waitsOn.map((relation) => ({ relation, task: taskById.get(relation.relatedTaskId) }));
  const blocks = relationGroups.blocks.map((relation) => ({ relation, task: taskById.get(relation.taskId === task.id ? relation.relatedTaskId : relation.taskId) }));
  const related = relationGroups.related.map((relation) => ({ relation, task: taskById.get(relation.taskId === task.id ? relation.relatedTaskId : relation.taskId) }));
  const linkedDecisions = decisionTaskLinks
    .filter((link) => link.taskId === task.id)
    .map((link) => ({ link, decision: decisions.find((decision) => decision.id === link.decisionId) }))
    .filter((item) => item.decision);
  const linkedFocusItems = focusItems
    .filter((item) => item.taskId === task.id)
    .sort((left, right) => right.focusDate.localeCompare(left.focusDate) || left.position - right.position)
    .slice(0, 5);
  const relationTargetOptions = allTasks
    .filter((item) => item.id !== task.id && item.taskType !== "sub_issue")
    .map((item) => ({ value: item.id, label: `${item.title} · ${item.owner}` }));
  const canManageTaskMeta = currentRole === "ceo" || currentRole === "deputy";
  const canSyncExistingGitHubIssue = hasGitHubIssue({
    githubIssueNumber: githubState.githubIssueNumber,
    githubIssueUrl: githubState.githubIssueUrl,
    issueNumber: task.issueNumber,
    issueUrl: task.issueUrl,
  });
  const detailsDraft: DetailsDraft = {
    priority: meta.priority,
    owner: meta.owner,
    packageId: meta.packageId,
    sprintId: meta.sprintId,
    milestoneId: meta.milestoneId,
    startDate: meta.startDate,
    endDate: meta.endDate,
    deadline: meta.deadline,
  };
  const briefFields = [
    ["Problem Statement", "problemStatement", "Welches Problem löst diese Aufgabe?"],
    ["Intended Outcome", "intendedOutcome", "Welcher fertige Zustand soll erreicht sein?"],
    ["Scope & Constraints", "scopeConstraints", "Was gehört dazu, was nicht?"],
    ["Acceptance Criteria", "acceptanceCriteria", "Ein messbares Kriterium pro Zeile."],
    ["Evidence Required", "evidenceRequired", "Welcher Nachweis wird erwartet?"],
    ["Definition of Done", "definitionOfDone", "Allgemeiner Qualitätsstandard oder DoD-Snapshot."],
  ] as const;

  useEffect(() => {
    if (source !== "supabase") {
      window.queueMicrotask(() => setCurrentRole("ceo"));
      return;
    }

    const supabase = getBrowserSupabase();
    if (!supabase) return;

    let active = true;
    supabase.auth.getSession().then(({ data }) => {
      if (!active) return;
      rememberGitHubProviderToken(data.session?.provider_token);
      setGithubProviderTokenAvailable(hasRememberedGitHubProviderToken());
      const login = String(data.session?.user.user_metadata?.user_name || data.session?.user.user_metadata?.preferred_username || "");
      const profile = profiles.find((item) => item.githubLogin === login);
      setCurrentRole(profile?.platformRole || "");
    });

    return () => {
      active = false;
    };
  }, [profiles, source]);

  const reconnectGitHub = async () => {
    const supabase = getBrowserSupabase();
    if (!supabase) return;

    setError("");
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "github",
      options: {
        redirectTo: window.location.origin,
        scopes: "repo read:user user:email",
      },
    });

    if (error) setError("GitHub-Anmeldung konnte nicht gestartet werden.");
  };

  const updateTask = (patch: Partial<EditableTaskState>) => {
    const next = { ...meta, ...patch };
    setMeta(next);
    setError("");
    setSaveState("Speichert...");

    if (source !== "supabase") {
      setSaveState("Lokal geändert");
      return;
    }

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
          body: JSON.stringify(patch),
        });
        const body = (await response.json().catch(() => null)) as { error?: string; activities?: TaskActivity[] } | null;
        if (!response.ok) throw new Error(body?.error || "Änderung konnte nicht gespeichert werden.");
        if (body?.activities?.length) {
          setTaskActivities((current) => [...body.activities!, ...current]);
        }
        setSaveState("Gespeichert");
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Änderung konnte nicht gespeichert werden.");
        setSaveState("");
      }
    });
  };

  const setDetailsDraft = (patch: Partial<DetailsDraft>) => {
    setMeta((current) => ({ ...current, ...patch }));
  };

  const setDetailsPackage = (packageId: string) => {
    const nextPackage = packages.find((item) => item.id === packageId);
    setDetailsDraft({ packageId, milestoneId: nextPackage?.milestoneId || meta.milestoneId });
  };

  const setDetailsMilestone = (milestoneId: string) => {
    const nextPackage = packages.find((item) => !milestoneId || !item.milestoneId || item.milestoneId === milestoneId);
    setDetailsDraft({ milestoneId, packageId: nextPackage?.id || meta.packageId });
  };

  const resetDetailsDraft = () => {
    if (detailsEditSnapshot) setMeta((current) => ({ ...current, ...detailsEditSnapshot }));
    setDetailsEditSnapshot(null);
    setDetailsEditing(false);
  };

  const saveDetailsDraft = () => {
    updateTask(detailsDraft);
    setDetailsEditSnapshot(null);
    setDetailsEditing(false);
  };

  const addComment = (comment: string) => {
    setError("");

    if (source !== "supabase") {
      setTaskComments((current) => [
        {
          id: Date.now(),
          taskId: task.id,
          profileId: profiles[0]?.id || "",
          comment,
          createdAt: new Date().toISOString(),
        },
        ...current,
      ]);
      return;
    }

    setGithubCommentImportPending(true);
    startTransition(async () => {
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;
      rememberGitHubProviderToken(session?.data.session?.provider_token);
      const githubProviderToken = getRememberedGitHubProviderToken();

      try {
        const response = await fetch(`/api/tasks/${task.id}/comments`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
            ...(githubProviderToken ? { "x-github-provider-token": githubProviderToken } : {}),
          },
          body: JSON.stringify({ comment }),
        });

        const body = (await response.json().catch(() => null)) as { error?: string; githubSyncError?: string; comment?: PlanningData["taskComments"][number] } | null;
        if (!response.ok || !body?.comment) throw new Error(body?.error || "Kommentar konnte nicht gespeichert werden.");
        setTaskComments((current) => [body.comment!, ...current]);
        if (body.githubSyncError) {
          setError(`Kommentar gespeichert, aber GitHub-Sync ist fehlgeschlagen: ${body.githubSyncError}`);
        }
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Kommentar konnte nicht gespeichert werden.");
      }
    });
  };

  const uploadAttachment = async (file: File) => {
    setError("");

    if (source !== "supabase") {
      throw new Error("Anhänge können nur mit Supabase- und GitHub-Login hochgeladen werden.");
    }

    const session = await getBrowserSupabase()?.auth.getSession();
    const token = session?.data.session?.access_token;
    rememberGitHubProviderToken(session?.data.session?.provider_token);
    const githubProviderToken = getRememberedGitHubProviderToken();
    const formData = new FormData();
    formData.append("file", file);

    const response = await fetch(`/api/tasks/${task.id}/attachments`, {
      method: "POST",
      headers: {
        ...(token ? { authorization: `Bearer ${token}` } : {}),
        ...(githubProviderToken ? { "x-github-provider-token": githubProviderToken } : {}),
      },
      body: formData,
    });

    const body = (await response.json().catch(() => null)) as { error?: string; markdown?: string } | null;
    if (!response.ok || !body?.markdown) throw new Error(body?.error || "Anhang konnte nicht hochgeladen werden.");
    setTaskActivities((current) => [
      {
        id: Date.now(),
        taskId: task.id,
        message: `Anhang hochgeladen: ${file.name}`,
        createdAt: new Date().toISOString(),
      },
      ...current,
    ]);
    return body.markdown;
  };

  const importGitHubComments = useCallback((options: { silent?: boolean } = {}) => {
    if (!options.silent) {
      setError("");
      setLocalCommentImportNotice("");
    }

    if (source !== "supabase") {
      if (!options.silent) setError("GitHub-Kommentarimport ist nur mit Supabase-Datenquelle verfügbar.");
      return;
    }

    startTransition(async () => {
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;
      rememberGitHubProviderToken(session?.data.session?.provider_token);
      const githubProviderToken = getRememberedGitHubProviderToken();

      try {
        const response = await fetch(`/api/tasks/${task.id}/github-comments`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
            ...(githubProviderToken ? { "x-github-provider-token": githubProviderToken } : {}),
          },
        });

        const body = (await response.json().catch(() => null)) as { error?: string; imported?: number; evidenceLink?: string; comments?: TaskExternalComment[] } | null;
        if (!response.ok || !body?.comments) throw new Error(body?.error || "GitHub-Kommentare konnten nicht aktualisiert werden.");
        setTaskExternalComments(body.comments);
        if (body.evidenceLink) {
          setMeta((current) => ({ ...current, evidenceLink: body.evidenceLink || current.evidenceLink }));
        }
        const total = body.comments.length;
        setLocalCommentImportNotice(
          total > 0
            ? `GitHub-Kommentare geladen: ${total} Kommentar${total === 1 ? "" : "e"}.`
            : "GitHub wurde geprüft, aber für dieses Issue wurden keine externen Kommentare gefunden.",
        );
      } catch (caught) {
        if (!options.silent) setError(caught instanceof Error ? caught.message : "GitHub-Kommentare konnten nicht aktualisiert werden.");
      } finally {
        setGithubCommentImportPending(false);
      }
    });
  }, [source, startTransition, task.id]);

  const syncGitHub = (options: { createIfMissing?: boolean } = {}) => {
    setError("");

    if (source !== "supabase") {
      setError("GitHub Sync ist nur mit Supabase-Datenquelle verfügbar.");
      return;
    }

    setGithubState((current) => ({ ...current, githubSyncStatus: "pending", githubSyncError: "" }));

    startTransition(async () => {
      const session = await getBrowserSupabase()?.auth.getSession();
      const token = session?.data.session?.access_token;
      rememberGitHubProviderToken(session?.data.session?.provider_token);
      const githubProviderToken = getRememberedGitHubProviderToken();

      try {
        const response = await fetch(`/api/tasks/${task.id}/sync-github`, {
          method: "POST",
          headers: {
            "content-type": "application/json",
            ...(token ? { authorization: `Bearer ${token}` } : {}),
            ...(githubProviderToken ? { "x-github-provider-token": githubProviderToken } : {}),
          },
          body: JSON.stringify({ createIfMissing: Boolean(options.createIfMissing) }),
        });

        const body = (await response.json().catch(() => null)) as { error?: string; task?: Partial<Task> } | null;
        if (!response.ok || !body?.task) throw new Error(body?.error || "GitHub Sync konnte nicht ausgeführt werden.");

        setGithubState((current) => ({
          githubRepo: body.task?.githubRepo || current.githubRepo,
          githubIssueNumber: body.task?.githubIssueNumber ?? current.githubIssueNumber,
          githubIssueUrl: body.task?.githubIssueUrl || current.githubIssueUrl,
          githubSyncStatus: body.task?.githubSyncStatus || current.githubSyncStatus,
          githubLastSyncedAt: body.task?.githubLastSyncedAt || current.githubLastSyncedAt,
          githubSyncError: body.task?.githubSyncError || "",
        }));
      } catch (caught) {
        const message = caught instanceof Error ? caught.message : "GitHub Sync konnte nicht ausgeführt werden.";
        setGithubState((current) => ({ ...current, githubSyncStatus: "failed", githubSyncError: message }));
        setError(message);
      }
    });
  };

  useEffect(() => {
    if (source !== "supabase") return;
    if (!hasGitHubIssue(task)) return;
    if (autoImportedGitHubCommentsRef.current) return;

    autoImportedGitHubCommentsRef.current = true;
    importGitHubComments({ silent: true });
  }, [importGitHubComments, source, task]);

  const addRelation = () => {
    if (!relationDraft.relatedTaskId || relationDraft.relatedTaskId === task.id) return;

    const localRelation: TaskRelation = {
      id: Date.now(),
      taskId: task.id,
      relatedTaskId: relationDraft.relatedTaskId,
      relationType: relationDraft.relationType,
      note: relationDraft.note,
      createdBy: "",
      createdAt: new Date().toISOString(),
    };

    setRelations((current) => [localRelation, ...current]);
    setRelationDraft({ relationType: "blocked_by", relatedTaskId: "", note: "" });
    setError("");

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
          body: JSON.stringify(relationDraft),
        });
        const body = (await response.json().catch(() => null)) as { error?: string; relation?: TaskRelation } | null;
        if (!response.ok || !body?.relation) throw new Error(body?.error || "Relationship konnte nicht gespeichert werden.");
        setRelations((current) => current.map((relation) => (relation.id === localRelation.id ? body.relation! : relation)));
      } catch (caught) {
        setRelations((current) => current.filter((relation) => relation.id !== localRelation.id));
        setError(caught instanceof Error ? caught.message : "Relationship konnte nicht gespeichert werden.");
      }
    });
  };

  const removeRelation = (relation: TaskRelation) => {
    setRelations((current) => current.filter((item) => item.id !== relation.id));
    setError("");

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
      } catch (caught) {
        setRelations((current) => [relation, ...current]);
        setError(caught instanceof Error ? caught.message : "Relationship konnte nicht entfernt werden.");
      }
    });
  };

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950 lg:pl-16">
      <AppSidebar activeWorkspace="planning" source={source} />

      <header className="border-b border-slate-200 bg-white">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-4">
          <div>
            <Link href="/" className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-blue-700">
              <ArrowLeft size={16} />
              Zur Planung
            </Link>
            <div className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Aufgabendetail</div>
            <h1 className="mt-1 max-w-4xl text-2xl font-semibold tracking-tight text-slate-950">{task.title}</h1>
          </div>
          <div className="flex flex-wrap gap-2">
            <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusTone(normalizeStatus(meta.status))}`}>{normalizeStatus(meta.status)}</span>
            <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${priorityTone(meta.priority)}`}>{meta.priority}</span>
            <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600">{task.hours}h</span>
          </div>
        </div>
      </header>

      <div className="mx-auto grid max-w-7xl gap-5 px-6 py-6 lg:grid-cols-[minmax(0,1fr)_360px]">
        <div className="grid gap-5">
          <section className="rounded-lg border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div className="flex items-center gap-3">
                <ProfileAvatar profile={creatorProfile} />
                <div>
                  <h2 className="text-sm font-semibold text-slate-950">Aufgabenbrief</h2>
                  <p className="text-xs text-slate-500">Erstellt von {creatorProfile?.name || task.createdBy || "Unbekannt"} · Assignee {ownerProfile?.name || meta.owner} · {task.dodTemplateVersion || "founder-deliverable-v2"}</p>
                </div>
              </div>
              <div className="flex items-center gap-2">
                {briefEditing ? (
                  <>
                    <button
                      type="button"
                      onClick={() => {
                        setBriefEditing(false);
                        setMeta((current) => ({
                          ...current,
                          problemStatement: task.problemStatement || task.description,
                          intendedOutcome: task.intendedOutcome || "",
                          scopeConstraints: task.scopeConstraints || "",
                          acceptanceCriteria: task.acceptanceCriteria || "",
                          evidenceRequired: task.evidenceRequired || "",
                          definitionOfDone: task.definitionOfDone || "",
                        }));
                      }}
                      className="grid h-8 w-8 place-items-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50"
                      aria-label="Bearbeitung abbrechen"
                    >
                      <X size={15} />
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        updateTask({
                          problemStatement: meta.problemStatement,
                          intendedOutcome: meta.intendedOutcome,
                          scopeConstraints: meta.scopeConstraints,
                          acceptanceCriteria: meta.acceptanceCriteria,
                          evidenceRequired: meta.evidenceRequired,
                          definitionOfDone: meta.definitionOfDone,
                        });
                        setBriefEditing(false);
                      }}
                      className="inline-flex h-8 items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 text-xs font-semibold text-blue-700"
                    >
                      <Save size={14} />
                      Speichern
                    </button>
                  </>
                ) : (
                  <button
                    type="button"
                    onClick={() => setBriefEditing(true)}
                    className="inline-flex h-8 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                  >
                    <Pencil size={14} />
                    Bearbeiten
                  </button>
                )}
              </div>
            </div>
            {briefFields.map(([label, key, placeholder]) => (
              <div key={key} className="mt-4 grid gap-2 text-sm">
                <div className="font-semibold text-slate-950">{label}</div>
                {briefEditing ? (
                  <textarea
                    value={String(meta[key] || "")}
                    onChange={(event) => setMeta((current) => ({ ...current, [key]: event.target.value }))}
                    className="min-h-20 w-full resize-y rounded-md border border-slate-200 p-3 text-sm leading-6 text-slate-800 outline-none focus:border-blue-400"
                    placeholder={placeholder}
                  />
                ) : key === "acceptanceCriteria" || key === "definitionOfDone" ? (
                  <TaskChecklist
                    value={String(meta[key] || "")}
                    emptyText={placeholder}
                    onChange={(nextValue) => {
                      setMeta((current) => ({ ...current, [key]: nextValue }));
                      updateTask({ [key]: nextValue } as Partial<EditableTaskState>);
                    }}
                  />
                ) : (
                  <p className="whitespace-pre-wrap rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-sm leading-6 text-slate-700">
                    {String(meta[key] || "") || placeholder}
                  </p>
                )}
              </div>
            ))}

            <div className="mt-5 grid gap-4 border-t border-slate-100 pt-5">
              <div>
                <h3 className="text-sm font-semibold text-slate-950">Evidence Link</h3>
                <input
                  value={meta.evidenceLink}
                  onChange={(event) => setMeta((current) => ({ ...current, evidenceLink: event.target.value }))}
                  onBlur={() => updateTask({ evidenceLink: meta.evidenceLink })}
                  className="mt-2 h-9 w-full rounded-md border border-slate-200 px-3 text-sm outline-none focus:border-blue-400"
                  placeholder="Notion, Drive, GitHub oder Evidence-Link"
                />
                {meta.evidenceLink && (
                  <div className="mt-3 rounded-md border border-slate-100 bg-slate-50 px-3 py-2">
                    <CommentBody value={meta.evidenceLink} />
                  </div>
                )}
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-950">Fokus-Kontext</h3>
                <div className="mt-2 grid gap-2">
                  {linkedFocusItems.length ? linkedFocusItems.map((item) => (
                    <article key={item.id} className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-sm">
                      <div className="flex flex-wrap items-center justify-between gap-2">
                        <span className="font-semibold text-slate-800">{profileName(item.profileId)} · {formatDate(item.focusDate)}</span>
                        <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-0.5 text-[11px] font-semibold text-blue-700">{focusStatusLabel(item.status)}</span>
                      </div>
                      <div className="mt-1 text-xs leading-5 text-slate-500">{item.nextStep || "Kein nächster Schritt hinterlegt."}</div>
                    </article>
                  )) : (
                    <div className="rounded-md border border-dashed border-slate-200 px-3 py-4 text-center text-sm text-slate-500">Diese Aufgabe ist aktuell in keinem Tagesfokus.</div>
                  )}
                </div>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-950">Begründende Decisions</h3>
                <div className="mt-2 grid gap-2">
                  {linkedDecisions.length ? linkedDecisions.map(({ link, decision }) => (
                    <article key={link.id} className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-sm">
                      <div className="font-semibold text-slate-800">{decision?.title}</div>
                      <div className="mt-1 text-xs text-slate-500">{decision?.status || "Decision"} · {link.note || "Keine Notiz hinterlegt."}</div>
                    </article>
                  )) : (
                    <div className="rounded-md border border-dashed border-slate-200 px-3 py-4 text-center text-sm text-slate-500">Noch keine Decision verknüpft.</div>
                  )}
                </div>
              </div>
              <div>
                <h3 className="text-sm font-semibold text-slate-950">Relationships</h3>
                <div className="mt-2 grid gap-2">
                  <RelationshipPanelList title="Wartet auf" rows={waitsOn} empty="Wartet auf keine andere Aufgabe." canManage={canManageTaskMeta} onRemove={removeRelation} />
                  <RelationshipPanelList title="Blockiert" rows={blocks} empty="Blockiert keine andere Aufgabe." canManage={canManageTaskMeta} onRemove={removeRelation} />
                  <RelationshipPanelList title="Verknüpft mit" rows={related} empty="Keine losen Verknüpfungen." canManage={canManageTaskMeta} onRemove={removeRelation} />
                </div>
                {meta.dependsOn && (
                  <textarea
                    value={meta.dependsOn}
                    onChange={(event) => setMeta((current) => ({ ...current, dependsOn: event.target.value }))}
                    onBlur={() => updateTask({ dependsOn: meta.dependsOn })}
                    className="mt-2 min-h-16 w-full resize-y rounded-md border border-amber-100 bg-amber-50 p-3 text-xs leading-5 text-amber-800 outline-none focus:border-amber-300"
                    placeholder="Legacy-Notiz"
                  />
                )}
                {canManageTaskMeta && (
                  <div className="mt-3 grid gap-2 rounded-md border border-slate-200 bg-slate-50 p-3">
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
                      disabled={isPending || !relationDraft.relatedTaskId}
                      onClick={addRelation}
                      className="h-9 rounded-md bg-blue-600 px-3 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      Relationship hinzufügen
                    </button>
                  </div>
                )}
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-slate-950">Sub-Issues</h2>
            <div className="mt-3 grid gap-2">
              {subIssues.map((item) => (
                <article key={item.id} className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-sm">
                  <div className="font-semibold text-slate-800">{item.title}</div>
                  <div className="mt-1 text-xs text-slate-500">{normalizeStatus(item.status)} · {item.owner} · nicht score-relevant</div>
                </article>
              ))}
              {!subIssues.length && <div className="rounded-md border border-dashed border-slate-200 px-3 py-4 text-center text-sm text-slate-500">Noch keine Sub-Issues.</div>}
            </div>
          </section>

          <TaskCommentThread
            comments={taskComments}
            externalComments={taskExternalComments}
            activities={taskActivities}
            notice={localCommentImportNotice}
            profiles={profiles}
            pending={isPending}
            importPending={githubCommentImportPending}
            onImportGitHubComments={importGitHubComments}
            onUploadAttachment={uploadAttachment}
            title="Kommentare"
            description="Laufende Abstimmungen, Nachfragen und Updates zur Aufgabe."
            onAddComment={addComment}
          />
          {error && <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div>}
        </div>

        <aside className="grid content-start gap-5">
          <section className="rounded-lg border border-slate-200 bg-white p-5">
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="text-sm font-semibold text-slate-950">Details</h2>
                <span className="text-xs text-slate-500">{isPending ? "Speichert..." : saveState}</span>
              </div>
              {canManageTaskMeta && (
                <div className="flex items-center gap-2">
                  {detailsEditing ? (
                    <>
                      <button
                        type="button"
                        onClick={resetDetailsDraft}
                        className="grid h-8 w-8 place-items-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50"
                        aria-label="Detailbearbeitung abbrechen"
                      >
                        <X size={14} />
                      </button>
                      <button
                        type="button"
                        onClick={saveDetailsDraft}
                        className="inline-flex h-8 items-center gap-2 rounded-md border border-blue-200 bg-blue-50 px-3 text-xs font-semibold text-blue-700"
                      >
                        <Save size={14} />
                        Speichern
                      </button>
                    </>
                  ) : (
                    <button
                      type="button"
                      onClick={() => {
                        setDetailsEditSnapshot(detailsDraft);
                        setDetailsEditing(true);
                      }}
                      className="inline-flex h-8 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
                    >
                      <Pencil size={14} />
                      Bearbeiten
                    </button>
                  )}
                </div>
              )}
            </div>
            <div className="mt-3 grid gap-3 text-sm">
              <label className="grid gap-1 text-xs font-semibold text-slate-500">
                Status
                <CustomSelect value={normalizeStatus(meta.status)} onChange={(value) => updateTask({ status: value as TaskStatus })} className="h-9 text-sm" options={availableStatusOptions(meta.status, canManageTaskMeta).map((status) => ({ value: status, label: status }))} />
              </label>
              <div className="border-t border-slate-100 pt-3">
                <div className="text-xs font-semibold text-slate-500">Erstellt von</div>
                <div className="mt-1 text-sm font-semibold text-slate-800">{creatorProfile?.name || task.createdBy || "Unbekannt"}</div>
              </div>
              {canManageTaskMeta && detailsEditing ? (
                <>
                  <label className="grid gap-1 border-t border-slate-100 pt-3 text-xs font-semibold text-slate-500">
                    Assignee
                    <CustomSelect value={meta.owner} onChange={(value) => setDetailsDraft({ owner: value })} className="h-9 text-sm" options={profiles.map((profile) => ({ value: profile.name, label: profile.name }))} />
                  </label>
                  <label className="grid gap-1 text-xs font-semibold text-slate-500">
                    Priorität
                    <CustomSelect value={meta.priority} onChange={(value) => setDetailsDraft({ priority: value })} className="h-9 text-sm" options={["P0", "P1", "P2", "P3", "P4"].map((priority) => ({ value: priority, label: priority }))} />
                  </label>
                  <label className="grid gap-1 text-xs font-semibold text-slate-500">
                    Group Commitment
                    <CustomSelect value={meta.packageId} onChange={setDetailsPackage} className="h-9 text-sm" options={packages.map((item) => ({ value: item.id, label: `${item.id} · ${item.title}` }))} />
                  </label>
                  <label className="grid gap-1 text-xs font-semibold text-slate-500">
                    Sprint
                    <CustomSelect value={meta.sprintId} onChange={(value) => setDetailsDraft({ sprintId: value })} className="h-9 text-sm" options={sprints.map((item) => ({ value: item.id, label: item.name }))} />
                  </label>
                  <label className="grid gap-1 text-xs font-semibold text-slate-500">
                    Epic / Meilenstein
                    <CustomSelect value={meta.milestoneId || ""} onChange={setDetailsMilestone} className="h-9 text-sm" options={[{ value: "", label: "Kein Epic" }, ...milestones.map((item) => ({ value: item.id, label: item.title }))]} />
                  </label>
                </>
              ) : (
                <>
                  {[
                    ["Assignee", ownerProfile?.name || meta.owner],
                    ["Priorität", meta.priority],
                    ["Group Commitment", currentPackage ? `${currentPackage.id} · ${currentPackage.title}` : "ohne Group Commitment"],
                    ["Sprint", currentSprint?.name || "Kein Sprint"],
                    ["Epic / Meilenstein", currentMilestone?.title || "Kein Epic"],
                  ].map(([label, value]) => (
                    <div key={label} className="border-t border-slate-100 pt-3">
                      <div className="text-xs font-semibold text-slate-500">{label}</div>
                      <div className="mt-1 text-sm font-semibold text-slate-800">{value}</div>
                    </div>
                  ))}
                </>
              )}
              <div className="border-t border-slate-100 pt-3">
                <div className="text-xs font-semibold text-slate-500">Zeitraum</div>
                {canManageTaskMeta && detailsEditing ? (
                  <div className="mt-2 grid gap-2 sm:grid-cols-2">
                    <CustomDatePicker value={meta.startDate || ""} onChange={(value) => setDetailsDraft({ startDate: value })} className="h-9 text-sm" />
                    <CustomDatePicker value={meta.endDate || ""} onChange={(value) => setDetailsDraft({ endDate: value })} className="h-9 text-sm" />
                  </div>
                ) : (
                  <div className="mt-1 flex items-center gap-2 text-sm font-semibold text-slate-800"><CalendarDays size={15} />{dateRange({ ...task, startDate: meta.startDate, endDate: meta.endDate, deadline: meta.deadline })}</div>
                )}
              </div>
              <div>
                <div className="text-xs font-semibold text-slate-500">Zieltermin</div>
                {canManageTaskMeta && detailsEditing ? (
                  <CustomDatePicker value={meta.deadline || ""} onChange={(value) => setDetailsDraft({ deadline: value })} className="mt-2 h-9 text-sm" />
                ) : (
                  <div className="mt-1 text-sm font-semibold text-slate-800">{meta.deadline ? formatDate(meta.deadline) : "Kein Zieltermin"}</div>
                )}
              </div>
              <div className="border-t border-slate-100 pt-3">
                <div className="text-xs font-semibold text-slate-500">Review</div>
                <div className="mt-1 text-sm font-semibold text-slate-800">{reviewLabel(task.reviewStatus)}</div>
              </div>
              <div>
                <div className="text-xs font-semibold text-slate-500">Score</div>
                <div className="mt-1 text-sm font-semibold text-slate-800">{task.scoreFinal ? `${task.scorePoints} final` : `${task.scorePoints} offen`}</div>
              </div>
              <div className="border-t border-slate-100 pt-3">
                <div className="text-xs font-semibold text-slate-500">Assignee</div>
                <div className="mt-1 text-sm font-semibold text-slate-800">{ownerProfile?.githubLogin || ownerProfile?.name || meta.owner}</div>
              </div>
              <div>
                <div className="text-xs font-semibold text-slate-500">Epic-Ziel</div>
                <div className="mt-1 text-sm text-slate-700">{currentMilestone?.targetDate ? formatDate(currentMilestone.targetDate) : "Kein Zieltermin"}</div>
              </div>
              <div>
                <div className="text-xs font-semibold text-slate-500">Sprint-Zeitraum</div>
                <div className="mt-1 text-sm text-slate-700">{currentSprint ? `${formatDate(currentSprint.startDate)} bis ${formatDate(currentSprint.endDate)}` : "Kein Sprint"}</div>
              </div>
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-5">
            <h2 className="text-sm font-semibold text-slate-950">Blocker</h2>
            <div className="mt-2 text-sm text-slate-600">{openBlockers.length} offen</div>
            <div className="mt-3 grid gap-2">
              {blockers.map((blocker) => (
                <article key={blocker.id} className="rounded-md border border-orange-100 bg-orange-50 px-3 py-2 text-xs text-orange-950">
                  <div className="font-semibold">{profileName(blocker.profileId)} · {blocker.status}</div>
                  <p className="mt-1 leading-5">{blocker.reason}</p>
                </article>
              ))}
              {!blockers.length && <div className="text-sm text-slate-500">Keine Blocker gemeldet.</div>}
            </div>
          </section>

          <section className="rounded-lg border border-slate-200 bg-white p-5">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <h2 className="flex items-center gap-2 text-sm font-semibold text-slate-950">
                <GitBranch size={16} />
                GitHub Sync
              </h2>
              {canSyncExistingGitHubIssue ? (
                <button
                  type="button"
                  disabled={isPending || githubState.githubSyncStatus === "pending" || !githubProviderTokenAvailable}
                  onClick={() => syncGitHub()}
                  className="h-8 rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {githubState.githubSyncStatus === "pending" ? "Sync..." : "Jetzt spiegeln"}
                </button>
              ) : task.taskType === "deliverable" ? (
                <button
                  type="button"
                  disabled={isPending || githubState.githubSyncStatus === "pending" || !githubProviderTokenAvailable}
                  onClick={() => syncGitHub({ createIfMissing: true })}
                  className="h-8 rounded-md border border-amber-200 bg-amber-50 px-3 text-xs font-semibold text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                >
                  {githubState.githubSyncStatus === "pending" ? "Anlegen..." : "GitHub-Issue anlegen"}
                </button>
              ) : null}
            </div>
            <div className="mt-3 grid gap-2 text-sm leading-6 text-slate-600">
              <p>{githubState.githubRepo || "findmydoc-platform/management"} · {syncLabel(githubState.githubSyncStatus)}</p>
              {githubState.githubIssueUrl ? (
                <a href={githubState.githubIssueUrl} target="_blank" rel="noreferrer" className="inline-flex items-center gap-2 text-blue-700 hover:underline">
                  <Link2 size={14} />
                  GitHub-Issue öffnen
                </a>
              ) : (
                <p className="inline-flex items-center gap-1.5 text-amber-700">
                  <AlertTriangle size={15} />
                  Nur in der App: noch kein GitHub-Issue verknüpft.
                </p>
              )}
              {!canSyncExistingGitHubIssue && <p className="text-xs text-slate-500">Diese Aufgabe wird nicht automatisch dupliziert. Nutze “GitHub-Issue anlegen”, wenn sie bewusst ins Management-Repo gespiegelt werden soll.</p>}
              {!githubProviderTokenAvailable && (
                <div className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-xs leading-5 text-amber-900">
                  <div className="font-semibold">GitHub-Rechte müssen erneuert werden.</div>
                  <p className="mt-1">Du bist weiter in der App angemeldet, aber Sync, Kommentare und Anhänge brauchen einen frischen GitHub-Token.</p>
                  <button
                    type="button"
                    onClick={reconnectGitHub}
                    disabled={isPending}
                    className="mt-2 h-8 rounded-md border border-amber-200 bg-white px-3 text-xs font-semibold text-amber-800 hover:bg-amber-100 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    GitHub-Rechte erneuern
                  </button>
                </div>
              )}
              {githubState.githubLastSyncedAt && <p className="text-xs text-slate-500">Zuletzt gespiegelt: {githubState.githubLastSyncedAt}</p>}
              {githubState.githubSyncError && <p className="flex gap-2 text-red-700"><MessageSquareWarning size={16} />{githubState.githubSyncError}</p>}
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}

