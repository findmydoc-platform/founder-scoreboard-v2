"use client";

import { ChevronDown } from "lucide-react";
import { useEffect, useState, type ReactNode } from "react";
import {
  canApproveDeliverableApproval,
  canRejectDeliverableApproval,
  canReturnDeliverableForRevision,
  isTaskPlanningActive,
} from "@/features/planning/model/approval-domain";
import { canWithdrawPlanningRoot } from "@/features/planning/model/planning-trash-contract";
import type { TaskUpdateResult } from "@/features/tasks/hooks/task-mutation-command-types";
import { useTaskDetailController } from "@/features/tasks/hooks/use-task-detail-controller";
import { TaskDetailOperationalHeader } from "@/features/tasks/molecules/task-detail-operational-header";
import { TaskDetailPanelBlockerSection } from "@/features/tasks/molecules/task-detail-panel-blocker-section";
import { TaskDetailPanelSubIssuesSection } from "@/features/tasks/molecules/task-detail-panel-sub-issues-section";
import { TaskDetailTabs, type TaskDetailTabId } from "@/features/tasks/molecules/task-detail-tabs";
import {
  partitionSubIssues,
  uniqueRelationshipCount,
  visibleTaskActivityCount,
} from "@/features/tasks/model/task-detail-presentation";
import { taskStatusOptionsForPermissions } from "@/features/tasks/model/task-detail-permissions";
import { buildTaskRelationshipRows, relationTargetOptionsForTask } from "@/features/tasks/model/task-detail-state";
import { taskRelationshipAccess } from "@/features/tasks/model/task-relationship-permissions";
import { TaskCommentThread } from "@/features/tasks/organisms/task-comment-thread";
import { TaskDetailPanelSidebar } from "@/features/tasks/organisms/task-detail-panel-sidebar";
import { TaskOverviewPanel } from "@/features/tasks/organisms/task-overview-panel";
import { TaskRelationshipsSection } from "@/features/tasks/organisms/task-relationships-section";
import { normalizeStatus } from "@/lib/status";
import type { ApprovalDecisionAction, AuthenticatedProfile, Milestone, Package, Profile, Sprint, Task, TaskActivity, TaskBlocker, TaskComment, TaskExternalComment, TaskRelation, TaskRelationType } from "@/lib/types";

type TaskDetailSurfaceProps = {
  surface?: "page" | "modal";
  task: Task;
  pack?: Package;
  comments: TaskComment[];
  externalComments: TaskExternalComment[];
  activities: TaskActivity[];
  blockers: TaskBlocker[];
  subIssues: Task[];
  teamProfiles: Profile[];
  packages: Package[];
  sprints: Sprint[];
  milestones: Milestone[];
  allTasks: Task[];
  relations: TaskRelation[];
  currentProfile?: Pick<AuthenticatedProfile, "id" | "name" | "platformRole"> | null;
  source: "seed" | "supabase";
  pending: boolean;
  error?: string;
  detailDataError?: string;
  detailDataLoading?: boolean;
  commentImportNotice?: string;
  commentImportPending?: boolean;
  githubInstallationAvailable: boolean;
  onOverviewDirtyChange?: (dirty: boolean) => void;
  onUpdate: (patch: Partial<Task>) => Promise<TaskUpdateResult> | void;
  onAddComment: (comment: string) => Promise<void> | void;
  onUploadAttachment: (file: File) => Promise<string>;
  onImportGitHubComments: () => void;
  onReportBlocker: (payload: { reason: string; impact: string; needsHelpFrom: string }) => void;
  onCreateSubIssue: () => void;
  onOpenTask: (taskId: string) => void;
  onSyncGitHub: (options?: { createIfMissing?: boolean }) => void;
  onOpenReview: () => void;
  onWithdraw: (reason: string) => void;
  onAddRelation: (payload: { relationType: TaskRelationType; relatedTaskId: string; note: string }) => void;
  onRemoveRelation: (relation: TaskRelation) => void;
  onDecideApproval: (action: ApprovalDecisionAction, note?: string) => void;
};

const discardMessage = "Ungespeicherte Änderungen verwerfen?";

export function TaskDetailSurface({
  surface = "page",
  task,
  pack,
  comments,
  externalComments,
  activities,
  blockers,
  subIssues,
  teamProfiles,
  packages,
  sprints,
  milestones,
  allTasks,
  relations,
  currentProfile = null,
  source,
  pending,
  error = "",
  detailDataError = "",
  detailDataLoading = false,
  commentImportNotice = "",
  commentImportPending = false,
  githubInstallationAvailable,
  onOverviewDirtyChange,
  onUpdate,
  onAddComment,
  onUploadAttachment,
  onImportGitHubComments,
  onReportBlocker,
  onCreateSubIssue,
  onOpenTask,
  onSyncGitHub,
  onOpenReview,
  onWithdraw,
  onAddRelation,
  onRemoveRelation,
  onDecideApproval,
}: TaskDetailSurfaceProps) {
  const [activeTab, setActiveTab] = useState<TaskDetailTabId>("overview");
  const controller = useTaskDetailController({
    task,
    currentProfile,
    unrestricted: source === "seed",
    onUpdate,
    onOverviewDirtyChange,
  });
  const currentPackage = packages.find((item) => item.id === task.packageId) || pack;
  const parentTask = allTasks.find((item) => item.id === task.parentTaskId);
  const relationshipGroups = buildTaskRelationshipRows(task, allTasks, relations);
  const relationshipAccess = taskRelationshipAccess({ task, initiative: currentPackage, profile: currentProfile, unrestricted: source === "seed" });
  const relationTargetOptions = relationTargetOptionsForTask(task, allTasks);
  const profileName = (profileId: string) => teamProfiles.find((profile) => profile.id === profileId)?.name || profileId || "Unbekannt";
  const canApprove = canApproveDeliverableApproval(task, currentPackage, currentProfile);
  const canReject = canRejectDeliverableApproval(task, currentPackage, currentProfile);
  const canReturnToDraft = canReturnDeliverableForRevision(task, currentPackage, currentProfile);
  const canWithdrawTask = task.taskType === "deliverable" && canWithdrawPlanningRoot({
    rootType: "deliverable",
    approvalStatus: task.approvalStatus,
    proposedById: task.proposedById,
  }, currentProfile, source === "seed");
  const statusOptions = taskStatusOptionsForPermissions(task.status, {
    canCompleteSubIssue: controller.permissions.canCompleteSubIssue,
    canManageFinalStatus: controller.permissions.canManageFinalStatus,
    canReopenSubIssue: controller.permissions.canReopenSubIssue,
    canUpdateWorkingStatus: controller.permissions.canUpdateWorkingStatus,
  });
  const effectivelyApproved = isTaskPlanningActive(task);
  const canSelectNextStatus = statusOptions.some((status) => status !== normalizeStatus(task.status));
  const statusLockedReason = !effectivelyApproved
    ? task.taskType === "sub_issue" ? "Parent-Deliverable ist noch nicht freigegeben." : "Deliverable ist noch nicht freigegeben."
    : !controller.permissions.canUpdateStatus ? "Deine Rolle darf diesen Status nicht ändern."
      : !canSelectNextStatus ? "Für deine Rolle ist kein weiterer Status verfügbar." : undefined;
  const { completed: completedSubIssues } = partitionSubIssues(subIssues);
  const detailDataKnown = !detailDataLoading && !detailDataError;
  const canEditOverview = Object.values(controller.overviewPermissions).some(Boolean);

  useEffect(() => {
    if (!controller.overviewDirty) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [controller.overviewDirty]);

  const confirmDiscard = () => !controller.overviewDirty || window.confirm(discardMessage);
  const cancelOverview = () => {
    if (!confirmDiscard()) return;
    controller.cancelOverview();
  };
  const changeTab = (nextTab: TaskDetailTabId) => {
    if (nextTab === activeTab) return;
    if (!confirmDiscard()) return;
    if (controller.overviewEditing) controller.cancelOverview();
    setActiveTab(nextTab);
  };
  const startOverviewEditing = () => {
    setActiveTab("overview");
    controller.startOverviewEditing();
  };
  const openTask = (taskId: string) => {
    if (!confirmDiscard()) return;
    if (controller.overviewEditing) controller.cancelOverview();
    onOpenTask(taskId);
  };

  const secondaryDetails = (
    <TaskDetailPanelSidebar
      task={task}
      pack={currentPackage}
      teamProfiles={teamProfiles}
      packages={packages}
      parentDeliverables={allTasks.filter((item) => item.taskType === "deliverable")}
      sprints={sprints}
      milestones={milestones}
      canCompleteSubIssue={controller.permissions.canCompleteSubIssue}
      canManageFinalTaskStatus={controller.permissions.canManageFinalStatus}
      canManageTaskMeta={controller.permissions.canManageTaskMeta}
      canReparentSubIssue={controller.permissions.canReparentSubIssue}
      canManageReviewOwner={controller.permissions.canManageReviewOwner}
      canOpenReview={controller.permissions.canOpenReview}
      canReopenSubIssue={controller.permissions.canReopenSubIssue}
      canWithdrawTask={canWithdrawTask}
      canChangeTaskStatus={controller.permissions.canUpdateStatus}
      canUpdateWorkingTaskStatus={controller.permissions.canUpdateWorkingStatus}
      canApprove={canApprove}
      canReject={canReject}
      canReturnToDraft={canReturnToDraft}
      pending={pending}
      githubInstallationAvailable={githubInstallationAvailable}
      onUpdate={onUpdate}
      onSyncGitHub={onSyncGitHub}
      onOpenReview={onOpenReview}
      onWithdraw={onWithdraw}
      onDecideApproval={onDecideApproval}
    />
  );

  const panels = {
    overview: (
      <TaskOverviewPanel
        task={task}
        draft={controller.overviewDraft}
        permissions={controller.overviewPermissions}
        editing={controller.overviewEditing}
        dirty={controller.overviewDirty}
        saving={controller.overviewSaving}
        error={controller.overviewError}
        onCancel={cancelOverview}
        onSave={controller.saveOverview}
        onChange={(patch) => controller.setOverviewDraft((current) => ({ ...current, ...patch }))}
        riskContent={!controller.overviewEditing ? (
          <TaskDetailPanelBlockerSection
            canReport={controller.permissions.canReportBlocker}
            blockers={blockers}
            blockerDraft={controller.blockerDraft}
            pending={pending}
            profileName={profileName}
            onBlockerDraftChange={(patch) => controller.setBlockerDraft((current) => ({ ...current, ...patch }))}
            onReportBlocker={(draft) => {
              onReportBlocker(draft);
              controller.setBlockerDraft({ reason: "", impact: "", needsHelpFrom: "" });
            }}
          />
        ) : null}
      />
    ),
    subIssues: (
      <TaskDetailPanelSubIssuesSection
        canCreate={controller.permissions.canCreateSubIssue}
        subIssues={subIssues}
        loading={detailDataLoading}
        error={detailDataError}
        onCreateSubIssue={onCreateSubIssue}
        onOpenTask={openTask}
      />
    ),
    relationships: (
      <TaskRelationshipsSection
        task={task}
        waitsOn={relationshipGroups.waitsOn}
        blocks={relationshipGroups.blocks}
        related={relationshipGroups.related}
        legacyDependsOn={task.dependsOn}
        relationDraft={controller.relationDraft}
        relationTargetOptions={relationTargetOptions}
        allowedRelationTypes={relationshipAccess.allowedRelationTypes}
        pending={pending}
        error={detailDataError}
        onOpenTask={openTask}
        onRemoveRelation={onRemoveRelation}
        canRemoveRelation={relationshipAccess.canRemoveRelation}
        onRelationDraftChange={(patch) => controller.setRelationDraft((current) => ({ ...current, ...patch }))}
        onAddRelation={() => {
          onAddRelation(controller.relationDraft);
          controller.setRelationDraft({ relationType: "blocked_by", relatedTaskId: "", note: "" });
        }}
      />
    ),
    activity: (
      <TaskCommentThread
        comments={comments}
        externalComments={externalComments}
        activities={activities}
        notice={commentImportNotice}
        profiles={teamProfiles}
        currentProfileId={currentProfile?.id || ""}
        pending={pending}
        importPending={commentImportPending}
        readOnly={!controller.permissions.canComment}
        onImportGitHubComments={onImportGitHubComments}
        onUploadAttachment={onUploadAttachment}
        onAddComment={onAddComment}
        title="Aktivität"
        description="Kommentare, GitHub-Updates und relevante Änderungen in einer gemeinsamen Timeline."
      />
    ),
  } satisfies Record<TaskDetailTabId, ReactNode>;

  return (
    <div className="min-w-0">
      <TaskDetailOperationalHeader
        task={task}
        initiative={currentPackage}
        parentTask={parentTask}
        profiles={teamProfiles}
        subIssues={subIssues}
        subIssuesKnown={detailDataKnown}
        waitsOn={relationshipGroups.waitsOn}
        blocks={relationshipGroups.blocks}
        relationshipsKnown={detailDataKnown}
        statusOptions={statusOptions}
        canChangeStatus={controller.permissions.canUpdateStatus && effectivelyApproved && canSelectNextStatus}
        statusLockedReason={statusLockedReason}
        canManageTaskMeta={controller.permissions.canManageTaskMeta}
        canEditOverview={canEditOverview && !controller.overviewEditing}
        pending={pending}
        titleId={surface === "modal" ? "task-detail-panel-title" : "task-detail-page-title"}
        onEditOverview={startOverviewEditing}
        onOpenTask={openTask}
        onUpdate={onUpdate}
      />

      {error ? <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div> : null}
      {detailDataLoading ? <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 px-4 py-3 text-sm font-medium text-slate-600">Zusätzliche Item-Daten werden geladen …</div> : null}

      <div className={surface === "page" ? "xl:grid xl:grid-cols-[minmax(0,1fr)_340px] xl:items-start xl:gap-6" : undefined}>
        <TaskDetailTabs
          value={activeTab}
          onValueChange={changeTab}
          className="mt-5"
          tabListClassName="sticky top-0 z-10 bg-white/95 backdrop-blur"
          counts={{
            subIssues: detailDataKnown ? `${completedSubIssues.length}/${subIssues.length}` : "",
            relationships: detailDataKnown ? uniqueRelationshipCount(relationshipGroups.waitsOn, relationshipGroups.blocks, relationshipGroups.related) : "",
            activity: detailDataKnown ? visibleTaskActivityCount({ comments, externalComments, activities }) : "",
          }}
          panels={panels}
          panelClassName="pt-5"
        />
        {surface === "page" ? <aside aria-label="Weitere Item-Details" className="mt-5 hidden xl:block">{secondaryDetails}</aside> : null}
      </div>

      {surface === "page" ? (
        <>
          <details className="group mt-5 rounded-xl border border-slate-200 bg-white xl:hidden">
            <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-400">
              Weitere Details
              <ChevronDown size={17} className="transition group-open:rotate-180" aria-hidden="true" />
            </summary>
            <div className="border-t border-slate-200 p-4">{secondaryDetails}</div>
          </details>
        </>
      ) : (
        <details className="group mt-5 rounded-xl border border-slate-200 bg-white">
          <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-400">
            Weitere Details
            <ChevronDown size={17} className="transition group-open:rotate-180" aria-hidden="true" />
          </summary>
          <div className="border-t border-slate-200 p-4">{secondaryDetails}</div>
        </details>
      )}
    </div>
  );
}
