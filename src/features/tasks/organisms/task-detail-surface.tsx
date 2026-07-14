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
import type { TaskActionResult, TaskUpdateResult } from "@/features/tasks/hooks/task-mutation-command-types";
import { useTaskDetailController } from "@/features/tasks/hooks/use-task-detail-controller";
import {
  TaskDetailDependencyBand,
  TaskDetailOperationalHeader,
} from "@/features/tasks/molecules/task-detail-operational-header";
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
import { taskDetailAvailableTabs } from "@/features/tasks/model/task-detail-tabs-model";
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
  onRequestDiscardAction: (action: () => void, force?: boolean) => void;
  onUpdate: (patch: Partial<Task>) => Promise<TaskUpdateResult> | void;
  onAddComment: (comment: string) => Promise<void> | void;
  onUploadAttachment: (file: File) => Promise<string>;
  onImportGitHubComments: () => void;
  onReportBlocker: (payload: { reason: string; impact: string; needsHelpFrom: string }) => Promise<TaskActionResult>;
  onCreateSubIssue: () => void;
  onOpenTask: (taskId: string) => void;
  onSyncGitHub: (options?: { createIfMissing?: boolean }) => void;
  onOpenReview: () => void;
  onWithdraw: (reason: string) => void;
  onAddRelation: (payload: { relationType: TaskRelationType; relatedTaskId: string; note: string }) => Promise<TaskActionResult>;
  onRemoveRelation: (relation: TaskRelation) => void;
  onDecideApproval: (action: ApprovalDecisionAction, note?: string) => void;
};

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
  onRequestDiscardAction,
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
  const detailDataUnavailable = Boolean(detailDataError);
  const canEditOverview = Object.values(controller.overviewPermissions).some(Boolean);
  const relationshipCount = uniqueRelationshipCount(relationshipGroups);
  const activityCount = visibleTaskActivityCount({ comments, externalComments, activities });
  const availableTabs = taskDetailAvailableTabs({
    activityCount,
    activityKnown: detailDataKnown,
    canAddRelationship: relationshipAccess.allowedRelationTypes.length > 0,
    canComment: controller.permissions.canComment,
    canCreateSubIssue: controller.permissions.canCreateSubIssue,
    relationshipCount,
    relationshipsKnown: detailDataKnown,
    subIssueCount: subIssues.length,
  });

  useEffect(() => {
    if (!controller.overviewDirty) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [controller.overviewDirty]);

  const requestDiscardAction = (action: () => void) => {
    if (!controller.overviewDirty) {
      action();
      return;
    }
    onRequestDiscardAction(action, true);
  };
  const cancelOverview = () => {
    requestDiscardAction(controller.cancelOverview);
  };
  const changeTab = (nextTab: TaskDetailTabId) => {
    if (nextTab === activeTab) return;
    requestDiscardAction(() => {
      if (controller.overviewEditing) controller.cancelOverview();
      setActiveTab(nextTab);
    });
  };
  const startOverviewEditing = () => {
    setActiveTab("overview");
    controller.startOverviewEditing();
  };
  const openTask = (taskId: string) => {
    requestDiscardAction(() => {
      if (controller.overviewEditing) controller.cancelOverview();
      onOpenTask(taskId);
    });
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
        baseline={controller.overviewBaselineDraft}
        draft={controller.overviewDraft}
        permissions={controller.overviewPermissions}
        editing={controller.overviewEditing}
        dirty={controller.overviewDirty}
        saving={controller.overviewSaving}
        error={controller.overviewError}
        onCancel={cancelOverview}
        onSave={controller.saveOverview}
        onChange={(patch) => controller.setOverviewDraft((current) => ({ ...current, ...patch }))}
        riskContent={!controller.overviewEditing && (detailDataLoading || detailDataUnavailable || blockers.length > 0 || controller.permissions.canReportBlocker) ? (
          <TaskDetailPanelBlockerSection
            canReport={controller.permissions.canReportBlocker}
            blockers={blockers}
            blockerDraft={controller.blockerDraft}
            loading={detailDataLoading}
            unavailable={detailDataUnavailable}
            pending={pending}
            profileName={profileName}
            onBlockerDraftChange={(patch) => controller.setBlockerDraft((current) => ({ ...current, ...patch }))}
            onReportBlocker={onReportBlocker}
          />
        ) : null}
      />
    ),
    subIssues: (
      <TaskDetailPanelSubIssuesSection
        canCreate={controller.permissions.canCreateSubIssue}
        subIssues={subIssues}
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
        loading={detailDataLoading}
        unavailable={detailDataUnavailable}
        onOpenTask={openTask}
        onRemoveRelation={onRemoveRelation}
        canRemoveRelation={relationshipAccess.canRemoveRelation}
        canEditLegacyDependsOn={controller.permissions.canEditNotes}
        onUpdateLegacyDependsOn={async (value) => {
          const result = await onUpdate({ dependsOn: value });
          return result || { ok: true, task: { dependsOn: value } };
        }}
        onRelationDraftChange={(patch) => controller.setRelationDraft((current) => ({ ...current, ...patch }))}
        onAddRelation={async () => {
          const result = await onAddRelation(controller.relationDraft);
          if (result.ok) {
            controller.setRelationDraft({ relationType: "blocked_by", relatedTaskId: "", note: "" });
          }
          return result;
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
        loading={detailDataLoading}
        unavailable={detailDataUnavailable}
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

  const operationalHeader = (
    <TaskDetailOperationalHeader
      task={task}
      initiative={currentPackage}
      parentTask={parentTask}
      profiles={teamProfiles}
      subIssues={subIssues}
      statusOptions={statusOptions}
      canChangeStatus={controller.permissions.canUpdateStatus && effectivelyApproved && canSelectNextStatus}
      statusLockedReason={statusLockedReason}
      canManageTaskMeta={controller.permissions.canManageTaskMeta}
      canEditOverview={canEditOverview && !controller.overviewEditing}
      pending={pending}
      titleId={surface === "modal" ? "task-detail-panel-title" : "task-detail-page-title"}
      onEditOverview={startOverviewEditing}
      onUpdate={onUpdate}
    />
  );

  const bodyContent = (
    <>
      <TaskDetailDependencyBand
        waitsOn={relationshipGroups.waitsOn}
        blocks={relationshipGroups.blocks}
        loading={detailDataLoading}
        error={detailDataError}
        onOpenTask={openTask}
      />

      {error ? <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div> : null}

      <div className={surface === "page" ? "xl:grid xl:grid-cols-[minmax(0,1fr)_340px] xl:items-start xl:gap-6" : undefined}>
        <TaskDetailTabs
          value={activeTab}
          onValueChange={changeTab}
          availableTabs={availableTabs}
          className="mt-5"
          tabListClassName="sticky top-0 z-10 bg-white/95 backdrop-blur"
          counts={{
            subIssues: subIssues.length ? `${completedSubIssues.length}/${subIssues.length}` : "",
            relationships: detailDataKnown && relationshipCount > 0 ? relationshipCount : "",
            activity: detailDataKnown && activityCount > 0 ? activityCount : "",
          }}
          panels={panels}
          panelClassName="pt-5"
        />
        {surface === "page" ? <aside aria-label="Weitere Item-Details" className="mt-5 hidden xl:block">{secondaryDetails}</aside> : null}
      </div>

      <details className={surface === "page"
        ? "group mt-5 rounded-xl border border-slate-200 bg-white xl:hidden"
        : "group mt-5 rounded-xl border border-slate-200 bg-white"}
      >
        <summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 px-4 py-3 text-sm font-semibold text-slate-800 focus:outline-none focus:ring-2 focus:ring-blue-400">
          Weitere Details
          <ChevronDown size={17} className="transition group-open:rotate-180" aria-hidden="true" />
        </summary>
        <div className="border-t border-slate-200 p-4">{secondaryDetails}</div>
      </details>
    </>
  );

  if (surface === "modal") {
    return (
      <div className="flex h-full min-h-0 min-w-0 flex-col bg-white">
        <div className="shrink-0 px-4 pt-4 sm:px-5">{operationalHeader}</div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-5 sm:px-5">
          {bodyContent}
        </div>
      </div>
    );
  }

  return (
    <div className="min-w-0">
      {operationalHeader}
      {bodyContent}
    </div>
  );
}
