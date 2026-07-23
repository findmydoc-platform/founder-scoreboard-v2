"use client";

import { useEffect, useState, type ReactNode } from "react";
import { TaskReviewSummary } from "@/features/reviews/molecules/task-review-summary";
import { TaskReviewRail } from "@/features/reviews/organisms/task-review-rail";
import { isTaskReviewActive, isTaskReviewLocked, reviewLockMessage } from "@/features/reviews/model/task-review-state";
import {
  canApproveDeliverableApproval,
  canRejectDeliverableApproval,
  canReturnDeliverableForRevision,
  isTaskPlanningActive,
} from "@/features/planning/model/approval-domain";
import { canWithdrawPlanningRoot } from "@/features/planning/model/planning-trash-contract";
import type { TaskActionResult, TaskUpdateResult } from "@/features/tasks/hooks/task-mutation-command-types";
import { useTaskDetailController } from "@/features/tasks/hooks/use-task-detail-controller";
import { TaskDetailHeaderActions } from "@/features/tasks/molecules/task-detail-header-actions";
import { TaskDetailHistorySummary } from "@/features/tasks/molecules/task-detail-history-summary";
import {
  TaskDetailDependencyBand,
  TaskDetailOperationalHeader,
} from "@/features/tasks/molecules/task-detail-operational-header";
import { TaskDetailPanelBlockerSection } from "@/features/tasks/molecules/task-detail-panel-blocker-section";
import { TaskDetailPanelSubIssuesSection } from "@/features/tasks/molecules/task-detail-panel-sub-issues-section";
import { TaskDetailPlanningSection } from "@/features/tasks/molecules/task-detail-planning-section";
import { TaskDetailTabs, type TaskDetailTabId } from "@/features/tasks/molecules/task-detail-tabs";
import { TaskDetailWorkflowStrips } from "@/features/tasks/molecules/task-detail-workflow-strips";
import {
  partitionSubIssues,
  uniqueRelationshipCount,
  visibleTaskActivityCount,
} from "@/features/tasks/model/task-detail-presentation";
import { taskOwnedByProfile, taskStatusOptionsForPermissions } from "@/features/tasks/model/task-detail-permissions";
import { buildTaskRelationshipRows, relationTargetOptionsForTask } from "@/features/tasks/model/task-detail-state";
import { taskDetailAvailableTabs } from "@/features/tasks/model/task-detail-tabs-model";
import { taskRelationshipAccess } from "@/features/tasks/model/task-relationship-permissions";
import { TaskCommentThread } from "@/features/tasks/organisms/task-comment-thread";
import { TaskOverviewPanel } from "@/features/tasks/organisms/task-overview-panel";
import { TaskRelationshipsSection } from "@/features/tasks/organisms/task-relationships-section";
import { normalizeStatus } from "@/lib/status";
import type { ApprovalDecisionAction, AuthenticatedProfile, Milestone, Package, Profile, ReviewDecision, Sprint, Task, TaskActivity, TaskBlocker, TaskComment, TaskExternalComment, TaskRelation, TaskRelationType, TaskReview, TaskReviewChecklist } from "@/lib/types";
import { classNames, UiNotice } from "@/shared/atoms/ui-primitives";

type TaskDetailSurfaceProps = {
  surface?: "page" | "modal";
  task: Task;
  pack?: Package;
  comments: TaskComment[];
  externalComments: TaskExternalComment[];
  activities: TaskActivity[];
  reviews: TaskReview[];
  blockers: TaskBlocker[];
  subIssues: Task[];
  teamProfiles: Profile[];
  packages: Package[];
  sprints: Sprint[];
  milestones: Milestone[];
  allTasks: Task[];
  relations: TaskRelation[];
  currentProfile?: Pick<AuthenticatedProfile, "id" | "name" | "platformRole"> | null;
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
  onReview: (task: Task, decision: ReviewDecision, score: number, checklist: TaskReviewChecklist, comment: string) => Promise<boolean> | boolean | void;
  onReopenReview: (task: Task) => void;
  onWithdrawReview: (task: Task, reason: string) => Promise<boolean> | boolean | void;
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
  reviews,
  blockers,
  subIssues,
  teamProfiles,
  packages,
  sprints,
  milestones,
  allTasks,
  relations,
  currentProfile = null,
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
  onReview,
  onReopenReview,
  onWithdrawReview,
  onWithdraw,
  onAddRelation,
  onRemoveRelation,
  onDecideApproval,
}: TaskDetailSurfaceProps) {
  const [activeTab, setActiveTab] = useState<TaskDetailTabId>("overview");
  const [reviewSetupOpen, setReviewSetupOpen] = useState(false);
  const [reviewDraftDirty, setReviewDraftDirty] = useState(false);
  const controller = useTaskDetailController({
    task,
    currentProfile,
    unrestricted: false,
    onUpdate,
  });
  const reviewActive = isTaskReviewActive(task);
  const reviewLocked = isTaskReviewLocked(task);
  const currentPackage = packages.find((item) => item.id === task.packageId) || pack;
  const currentMilestoneId = task.milestoneId || currentPackage?.milestoneId || "";
  const currentMilestone = milestones.find((item) => item.id === currentMilestoneId);
  const parentTask = allTasks.find((item) => item.id === task.parentTaskId);
  const relationshipGroups = buildTaskRelationshipRows(task, allTasks, relations);
  const baseRelationshipAccess = taskRelationshipAccess({ task, initiative: currentPackage, profile: currentProfile, unrestricted: false });
  const relationshipAccess = reviewLocked ? {
    ...baseRelationshipAccess,
    allowedRelationTypes: [],
    canRemoveRelation: () => false,
  } : baseRelationshipAccess;
  const relationTargetOptions = relationTargetOptionsForTask(task, allTasks);
  const profileName = (profileId: string) => teamProfiles.find((profile) => profile.id === profileId)?.name || profileId || "Unbekannt";
  const canApprove = canApproveDeliverableApproval(task, currentPackage, currentProfile);
  const canReject = canRejectDeliverableApproval(task, currentPackage, currentProfile);
  const canReturnToDraft = canReturnDeliverableForRevision(task, currentPackage, currentProfile);
  const canWithdrawTask = !reviewLocked && task.taskType === "deliverable" && canWithdrawPlanningRoot({
    rootType: "deliverable",
    approvalStatus: task.approvalStatus,
    proposedById: task.proposedById,
  }, currentProfile, false);
  const canWithdrawReview = reviewActive && (currentProfile?.platformRole === "ceo"
    || currentProfile?.platformRole === "deputy"
    || taskOwnedByProfile(task, currentProfile));
  const statusOptions = taskStatusOptionsForPermissions(task.status, {
    canCompleteSubIssue: controller.permissions.canCompleteSubIssue,
    canManageFinalStatus: controller.permissions.canManageFinalStatus,
    canReopenSubIssue: controller.permissions.canReopenSubIssue,
    canUpdateWorkingStatus: controller.permissions.canUpdateWorkingStatus,
  });
  const effectivelyApproved = isTaskPlanningActive(task);
  const canSelectNextStatus = statusOptions.some((status) => status !== normalizeStatus(task.status));
  const statusLockedReason = reviewLocked
    ? reviewLockMessage(task)
    : !effectivelyApproved
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

  const detailDirty = controller.overviewDirty || reviewDraftDirty;

  useEffect(() => {
    onOverviewDirtyChange?.(detailDirty);
    return () => onOverviewDirtyChange?.(false);
  }, [detailDirty, onOverviewDirtyChange]);

  useEffect(() => {
    if (!detailDirty) return;
    const handleBeforeUnload = (event: BeforeUnloadEvent) => {
      event.preventDefault();
      event.returnValue = "";
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [detailDirty]);

  const requestDiscardAction = (action: () => void) => {
    if (!detailDirty) {
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
    const applyTabChange = () => {
      if (controller.overviewEditing) controller.cancelOverview();
      setActiveTab(nextTab);
    };
    if (!controller.overviewDirty) {
      applyTabChange();
      return;
    }
    onRequestDiscardAction(applyTabChange, true);
  };
  const jumpToReviewSection = (targetId: string) => {
    const revealTarget = () => {
      const target = document.getElementById(targetId);
      if (!target) return;
      target.scrollIntoView({ behavior: "smooth", block: "start" });
      target.focus({ preventScroll: true });
    };
    if (activeTab === "overview") {
      revealTarget();
      return;
    }
    setActiveTab("overview");
    window.requestAnimationFrame(() => window.requestAnimationFrame(revealTarget));
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

  const panels = {
    overview: (
      <>
        {reviewActive ? (
          <UiNotice tone="info" className="mb-1 border-blue-200 bg-blue-50/70">
            Der fachliche Inhalt ist während der Prüfung geschützt. Kommentare und Anhänge bleiben verfügbar.
          </UiNotice>
        ) : null}
        <TaskOverviewPanel
          task={task}
          baseline={controller.overviewBaselineDraft}
          draft={controller.overviewDraft}
          permissions={controller.overviewPermissions}
          editing={controller.overviewEditing}
          dirty={controller.overviewDirty}
          saving={controller.overviewSaving}
          error={controller.overviewError}
          flat={reviewActive}
          onCancel={cancelOverview}
          onSave={controller.saveOverview}
          onChange={(patch) => controller.setOverviewDraft((current) => ({ ...current, ...patch }))}
          riskContent={!controller.overviewEditing ? (
            <>
              {reviewActive ? (
                <TaskDetailDependencyBand
                  anchorId="task-review-dependencies"
                  waitsOn={relationshipGroups.waitsOn}
                  blocks={relationshipGroups.blocks}
                  loading={detailDataLoading}
                  error={detailDataError}
                  onOpenTask={openTask}
                  variant="review"
                />
              ) : null}
              {detailDataLoading || detailDataUnavailable || blockers.length > 0 || controller.permissions.canReportBlocker ? (
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
            </>
          ) : null}
        />
      </>
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
        tasks={allTasks}
        sprints={sprints}
        packages={packages}
        milestones={milestones}
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
        footer={<TaskDetailHistorySummary task={task} profiles={teamProfiles} />}
      />
    ),
  } satisfies Record<TaskDetailTabId, ReactNode>;

  const operationalHeader = (
    <TaskDetailOperationalHeader
      task={task}
      initiative={currentPackage}
      milestone={currentMilestone}
      parentTask={parentTask}
      profiles={teamProfiles}
      subIssues={subIssues}
      statusOptions={statusOptions}
      canChangeStatus={controller.permissions.canUpdateStatus && effectivelyApproved && canSelectNextStatus}
      statusLockedReason={statusLockedReason}
      canManageTaskMeta={controller.permissions.canManageTaskMeta}
      pending={pending}
      titleId={surface === "modal" ? "task-detail-panel-title" : "task-detail-page-title"}
      actions={(
        <TaskDetailHeaderActions
          task={task}
          canEditOverview={canEditOverview && !controller.overviewEditing}
          canManageReviewOwner={!reviewActive && controller.permissions.canManageReviewOwner}
          canWithdrawTask={canWithdrawTask}
          githubInstallationAvailable={githubInstallationAvailable}
          pending={pending}
          onEditOverview={startOverviewEditing}
          onShowReviewSetup={() => setReviewSetupOpen(true)}
          onSyncGitHub={onSyncGitHub}
          onWithdraw={onWithdraw}
        />
      )}
      onUpdate={onUpdate}
    />
  );

  const reviewRail = reviewActive ? (
    <TaskReviewRail
      key={`${task.id}:${task.reviewRequestedAt || "unknown"}:${currentProfile?.id || "anonymous"}`}
      task={task}
      currentProfileId={currentProfile?.id || ""}
      profiles={teamProfiles}
      canReview={controller.permissions.canOpenReview}
      canWithdraw={canWithdrawReview}
      canManageReviewOwner={controller.permissions.canManageReviewOwner}
      pending={pending}
      onDirtyChange={setReviewDraftDirty}
      onReview={onReview}
      onWithdraw={onWithdrawReview}
      onReviewOwnerChange={(reviewOwnerProfileId) => onUpdate({ reviewOwnerProfileId })}
      onJumpToSection={jumpToReviewSection}
    />
  ) : null;

  const issueContent = (
    <>
      <TaskDetailPlanningSection
        task={task}
        pack={currentPackage}
        teamProfiles={teamProfiles}
        packages={packages}
        parentDeliverables={allTasks.filter((item) => item.taskType === "deliverable")}
        sprints={sprints}
        milestones={milestones}
        canManageTaskMeta={controller.permissions.canManageTaskMeta}
        canReparentSubIssue={controller.permissions.canReparentSubIssue}
        pending={pending}
        onUpdate={onUpdate}
      />

      {!reviewActive ? (
        <TaskDetailDependencyBand
          waitsOn={relationshipGroups.waitsOn}
          blocks={relationshipGroups.blocks}
          loading={detailDataLoading}
          error={detailDataError}
          onOpenTask={openTask}
        />
      ) : null}

      <TaskDetailWorkflowStrips
        task={task}
        teamProfiles={teamProfiles}
        canApprove={canApprove}
        canReject={canReject}
        canReturnToDraft={canReturnToDraft}
        canManageReviewOwner={controller.permissions.canManageReviewOwner}
        forceReviewSetup={reviewSetupOpen}
        pending={pending}
        onUpdate={onUpdate}
        onDecideApproval={onDecideApproval}
      />

      {!reviewActive ? (
        <TaskReviewSummary
          task={task}
          reviews={reviews}
          profiles={teamProfiles}
          canReopen={controller.permissions.canOpenReview}
          pending={pending}
          onReopen={onReopenReview}
        />
      ) : null}

      {error ? <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">{error}</div> : null}

      <TaskDetailTabs
        value={activeTab}
        onValueChange={changeTab}
        availableTabs={availableTabs}
        className={reviewActive ? "mt-2" : "mt-5"}
        tabListClassName="sticky top-0 z-10 bg-white/95 backdrop-blur"
        counts={{
          subIssues: subIssues.length ? `${completedSubIssues.length}/${subIssues.length}` : "",
          relationships: detailDataKnown && relationshipCount > 0 ? relationshipCount : "",
          activity: detailDataKnown && activityCount > 0 ? activityCount : "",
        }}
        panels={panels}
        panelAside={reviewRail}
        panelClassName={reviewActive ? "xl:pr-8" : undefined}
        panelLayoutClassName={reviewActive ? classNames(
          "grid grid-cols-1",
          surface === "modal"
            ? "xl:grid-cols-[minmax(0,1fr)_460px]"
            : "xl:grid-cols-[minmax(0,3fr)_minmax(420px,2fr)]",
        ) : undefined}
      />
    </>
  );

  if (surface === "modal") {
    return (
      <div className="flex h-full min-h-0 min-w-0 flex-col bg-white">
        <div className="shrink-0 px-4 pt-4 sm:px-6">{operationalHeader}</div>
        <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-4 pb-5 sm:px-6">
          {issueContent}
        </div>
      </div>
    );
  }

  return (
    <div className="min-w-0">
      {operationalHeader}
      {issueContent}
    </div>
  );
}
