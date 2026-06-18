"use client";

import { useEffect, useState, useTransition } from "react";
import { AppSidebar } from "@/features/planning/organisms/app-sidebar";
import { getBrowserSupabase } from "@/lib/supabase";
import type { DecisionTaskLink, Milestone, Package, PlanningData, Profile, Sprint, Task, TaskActivity, TaskBlocker, TaskComment, TaskExternalComment, TaskFocusItem, TaskRelation } from "@/lib/types";
import { GitHubConnectionStatus } from "@/features/planning/molecules/github-connection-status";
import { TaskBlockerCard } from "@/features/tasks/molecules/task-blocker-card";
import { TaskBriefSection } from "@/features/tasks/molecules/task-brief-section";
import { TaskContextSection } from "@/features/tasks/molecules/task-context-section";
import { TaskCommentThread } from "@/features/tasks/organisms/task-comment-thread";
import { TaskDetailHeader } from "@/features/tasks/molecules/task-detail-header";
import { TaskDetailsCard, type TaskDetailsDraft } from "@/features/tasks/organisms/task-details-card";
import { TaskEvidenceLinkSection } from "@/features/tasks/molecules/task-evidence-link-section";
import { TaskGitHubSyncCard } from "@/features/tasks/molecules/task-github-sync-card";
import { TaskRelationshipsSection } from "@/features/tasks/organisms/task-relationships-section";
import { TaskSubIssuesSection } from "@/features/tasks/molecules/task-sub-issues-section";
import { getRememberedGitHubProviderToken, hasRememberedGitHubProviderToken, rememberGitHubProviderToken } from "@/lib/github-provider-token";
import { buildDetailsMilestonePatch, buildDetailsPackagePatch, buildEditableTaskState, buildTaskBriefDraft, buildTaskDetailGitHubState, buildTaskDetailsDraft, buildTaskDetailViewModel } from "@/features/tasks/model/task-detail-state";
import { useTaskComments } from "@/features/tasks/hooks/use-task-comments";
import { useTaskRelationships } from "@/features/tasks/hooks/use-task-relationships";
import type { EditableTaskState } from "@/features/tasks/model/task-detail-state";

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
  const [meta, setMeta] = useState<EditableTaskState>(() => buildEditableTaskState(task));
  const [error, setError] = useState("");
  const [saveState, setSaveState] = useState("");
  const [briefEditing, setBriefEditing] = useState(false);
  const [detailsEditing, setDetailsEditing] = useState(false);
  const [detailsEditSnapshot, setDetailsEditSnapshot] = useState<TaskDetailsDraft | null>(null);
  const [githubState, setGithubState] = useState(() => buildTaskDetailGitHubState(task));
  const [currentRole, setCurrentRole] = useState<Profile["platformRole"] | "">(source === "seed" ? "ceo" : "");
  const [githubProviderTokenAvailable, setGithubProviderTokenAvailable] = useState(hasRememberedGitHubProviderToken());
  const [githubReconnectFailed, setGithubReconnectFailed] = useState(false);
  const [isPending, startTransition] = useTransition();
  const { relations, relationDraft, setRelationDraft, addRelation, removeRelation } = useTaskRelationships({
    task,
    initialRelations: taskRelations,
    source,
    startTransition,
    setError,
  });
  const {
    taskComments,
    taskExternalComments,
    taskActivities,
    localCommentImportNotice,
    githubCommentImportPending,
    addComment,
    uploadAttachment,
    importGitHubComments,
    appendTaskActivities,
  } = useTaskComments({
    task,
    initialComments: comments,
    initialExternalComments: externalComments,
    initialActivities: activities,
    commentImportNotice,
    profiles,
    source,
    startTransition,
    setError,
    setMeta,
  });
  const {
    ownerProfile,
    creatorProfile,
    currentSprint,
    currentMilestone,
    currentPackage,
    profileName,
    openBlockers,
    waitsOn,
    blocks,
    related,
    linkedDecisions,
    linkedFocusItems,
    relationTargetOptions,
    canManageTaskMeta,
    canSyncExistingGitHubIssue,
  } = buildTaskDetailViewModel({
    task,
    meta,
    githubState,
    pack,
    packages,
    sprint,
    sprints,
    milestones,
    profiles,
    blockers,
    relations,
    allTasks,
    decisions,
    decisionTaskLinks,
    focusItems,
    currentRole,
  });
  const detailsDraft: TaskDetailsDraft = buildTaskDetailsDraft(meta);
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
      if (data.session?.provider_token) setGithubReconnectFailed(false);
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
    setGithubReconnectFailed(false);
    const { error } = await supabase.auth.signInWithOAuth({
      provider: "github",
      options: {
        redirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(`${window.location.pathname}${window.location.search}${window.location.hash}`)}`,
        scopes: "repo read:user user:email",
      },
    });

    if (error) {
      setGithubReconnectFailed(true);
      setError("GitHub-Anmeldung konnte nicht gestartet werden.");
    }
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
        const body = (await response.json().catch(() => null)) as { error?: string; activities?: TaskActivity[]; task?: Partial<Task> } | null;
        if (!response.ok) throw new Error(body?.error || "Änderung konnte nicht gespeichert werden.");
        if (body?.activities?.length) appendTaskActivities(body.activities);
        if (body?.task) {
          setMeta((current) => ({
            ...current,
            ...(body.task?.status ? { status: body.task.status } : {}),
            ...(body.task?.reviewStatus ? { reviewStatus: body.task.reviewStatus } : {}),
            ...(body.task?.reviewOwnerProfileId !== undefined ? { reviewOwnerProfileId: body.task.reviewOwnerProfileId || "" } : {}),
          }));
        }
        setSaveState("Gespeichert");
      } catch (caught) {
        setError(caught instanceof Error ? caught.message : "Änderung konnte nicht gespeichert werden.");
        setSaveState("");
      }
    });
  };

  const setDetailsDraft = (patch: Partial<TaskDetailsDraft>) => {
    setMeta((current) => ({ ...current, ...patch }));
  };

  const setDetailsPackage = (packageId: string) => {
    setDetailsDraft(buildDetailsPackagePatch(packageId, packages, meta.milestoneId));
  };

  const setDetailsMilestone = (milestoneId: string) => {
    setDetailsDraft(buildDetailsMilestonePatch(milestoneId, packages, meta.packageId));
  };

  const resetDetailsDraft = () => {
    if (detailsEditSnapshot) setMeta((current) => ({ ...current, ...detailsEditSnapshot }));
    setDetailsEditSnapshot(null);
    setDetailsEditing(false);
  };

  const saveDetailsDraft = () => {
    const { reviewOwnerProfileId, ...detailsWithoutReviewOwner } = detailsDraft;
    updateTask(currentRole === "ceo" ? { ...detailsWithoutReviewOwner, reviewOwnerProfileId } : detailsWithoutReviewOwner);
    setDetailsEditSnapshot(null);
    setDetailsEditing(false);
  };

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

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950 lg:pl-16">
      <AppSidebar activeWorkspace="planning" source={source} />

      <TaskDetailHeader
        title={task.title}
        status={meta.status}
        priority={meta.priority}
        hours={task.hours}
        actions={(
          <GitHubConnectionStatus
            authenticated={source === "supabase"}
            available={githubProviderTokenAvailable}
            failed={githubReconnectFailed}
            busy={isPending}
            onReconnect={reconnectGitHub}
          />
        )}
      />

      <div className="mx-auto max-w-7xl px-6 py-6">
        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_360px]">
          <div className="grid min-w-0 gap-5">
            <TaskBriefSection
              task={task}
              brief={meta}
              creatorProfile={creatorProfile}
              ownerProfile={ownerProfile}
              owner={meta.owner}
              editing={briefEditing}
              onEdit={() => setBriefEditing(true)}
              onCancel={() => {
                setBriefEditing(false);
                setMeta((current) => ({ ...current, ...buildTaskBriefDraft(task) }));
              }}
              onSave={() => {
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
              onBriefChange={(patch) => setMeta((current) => ({ ...current, ...patch }))}
              onChecklistChange={(patch) => {
                setMeta((current) => ({ ...current, ...patch }));
                updateTask(patch);
              }}
            >

              <div className="mt-5 grid gap-4 border-t border-slate-100 pt-5">
                <TaskEvidenceLinkSection
                  evidenceLink={meta.evidenceLink}
                  onEvidenceLinkChange={(evidenceLink) => setMeta((current) => ({ ...current, evidenceLink }))}
                  onEvidenceLinkSave={() => updateTask({ evidenceLink: meta.evidenceLink })}
                />
                <TaskContextSection linkedFocusItems={linkedFocusItems} linkedDecisions={linkedDecisions} profileName={profileName} />
                <TaskRelationshipsSection
                  task={task}
                  waitsOn={waitsOn}
                  blocks={blocks}
                  related={related}
                  dependsOn={meta.dependsOn}
                  relationDraft={relationDraft}
                  relationTargetOptions={relationTargetOptions}
                  canManageTaskMeta={canManageTaskMeta}
                  pending={isPending}
                  onRemoveRelation={removeRelation}
                  onDependsOnChange={(dependsOn) => setMeta((current) => ({ ...current, dependsOn }))}
                  onDependsOnSave={() => updateTask({ dependsOn: meta.dependsOn })}
                  onRelationDraftChange={(patch) => setRelationDraft((current) => ({ ...current, ...patch }))}
                  onAddRelation={addRelation}
                />
              </div>
            </TaskBriefSection>

            <TaskSubIssuesSection subIssues={subIssues} />

          </div>

          <aside className="grid content-start gap-5">
            <TaskDetailsCard
              task={task}
              meta={meta}
              detailsDraft={detailsDraft}
              creatorProfile={creatorProfile}
              ownerProfile={ownerProfile}
              currentPackage={currentPackage}
              currentSprint={currentSprint}
              currentMilestone={currentMilestone}
              canManageTaskMeta={canManageTaskMeta}
              canManageReviewOwner={currentRole === "ceo"}
              detailsEditing={detailsEditing}
              pending={isPending}
              saveState={saveState}
              packages={packages}
              profiles={profiles}
              sprints={sprints}
              milestones={milestones}
              onStatusChange={(status) => updateTask({ status })}
              onDetailsDraftChange={setDetailsDraft}
              onDetailsPackageChange={setDetailsPackage}
              onDetailsMilestoneChange={setDetailsMilestone}
              onStartEditing={() => {
                setDetailsEditSnapshot(detailsDraft);
                setDetailsEditing(true);
              }}
              onCancelEditing={resetDetailsDraft}
              onSaveDetails={saveDetailsDraft}
            />

            <TaskBlockerCard blockers={blockers} openBlockerCount={openBlockers.length} profileName={profileName} />

            <TaskGitHubSyncCard
              taskType={task.taskType}
              githubState={githubState}
              canSyncExistingGitHubIssue={canSyncExistingGitHubIssue}
              pending={isPending}
              githubProviderTokenAvailable={githubProviderTokenAvailable}
              onSyncGitHub={() => syncGitHub()}
              onCreateGitHubIssue={() => syncGitHub({ createIfMissing: true })}
            />
          </aside>
        </div>

        <div className="mt-5 min-w-0">
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
        </div>
        {error && <div className="mt-5 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div>}
      </div>
    </main>
  );
}
