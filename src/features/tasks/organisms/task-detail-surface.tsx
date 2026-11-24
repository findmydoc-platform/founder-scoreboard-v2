"use client";

import { usePlanningBusinessState } from "@/features/planning/hooks/use-planning-business-state";
import type { PlanningState, PlanningTaskEditor, PlanningTaskSaveView, PlanningTaskSaveCheck } from "@/features/planning/model/planning-state";
import type { TaskUpdateOptions } from "@/features/tasks/hooks/task-mutation-command-types";

import { useEffect, useEffectEvent, useMemo, useRef, useState, type ReactNode } from "react";
import { ReviewEvidenceGateDialog } from "@/features/reviews/molecules/review-evidence-gate-dialog";
import { TaskReviewSummary } from "@/features/reviews/molecules/task-review-summary";
import { TaskReviewRail } from "@/features/reviews/organisms/task-review-rail";
import {
  taskReviewEvidenceStatus,
  type ReviewEvidenceSubmission,
} from "@/features/reviews/model/review-evidence";
import { isTaskReviewActive, isTaskReviewLocked, reviewLockMessage } from "@/features/reviews/model/task-review-state";
import {
  canApproveDeliverableApproval,
  canDecideInitiativeApproval,
  canRejectDeliverableApproval,
  canReturnInitiativeForRevision,
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
import { TaskDetailPanelChildrenSection } from "@/features/tasks/molecules/task-detail-panel-sub-issues-section";
import { TaskDetailPlanningSection } from "@/features/tasks/molecules/task-detail-planning-section";
import { TaskDetailTabs, type TaskDetailTabId } from "@/features/tasks/molecules/task-detail-tabs";
import { TaskDetailWorkflowStrips } from "@/features/tasks/molecules/task-detail-workflow-strips";
import {
  uniqueRelationshipCount,
  visibleTaskActivityCount,
} from "@/features/tasks/model/task-detail-presentation";
import { canReviewPlanningItem, canSyncPlanningItemToGitHub } from "@/features/tasks/model/planning-item-capabilities";
import { taskOwnedByProfile, taskStatusOptionsForPermissions } from "@/features/tasks/model/task-detail-permissions";
import { buildTaskRelationshipRows, relationTargetOptionsForTask } from "@/features/tasks/model/task-detail-state";
import { taskDetailAvailableTabs } from "@/features/tasks/model/task-detail-tabs-model";
import { taskRelationshipAccess } from "@/features/tasks/model/task-relationship-permissions";
import { taskMentionFieldTargetIds } from "@/features/tasks/model/task-comment-target";
import { TaskCommentThread } from "@/features/tasks/organisms/task-comment-thread";
import { TaskSaveNotice } from "@/features/tasks/molecules/task-save-notice";
import { TaskOverviewPanel } from "@/features/tasks/organisms/task-overview-panel";
import { TaskRelationshipsSection } from "@/features/tasks/organisms/task-relationships-section";
import { normalizeStatus } from "@/lib/status";
import type { ApprovalDecisionAction, AuthenticatedProfile, Profile, ReviewDecision, Sprint, Task, TaskActivity, TaskBlocker, TaskComment, TaskExternalComment, TaskRelation, TaskRelationType, TaskReview, TaskReviewChecklist } from "@/lib/types";
import { classNames, UiButton, UiNotice } from "@/shared/atoms/ui-primitives";

type TaskDetailSurfaceProps = {
  detailReadMode?: "scoped" | "complete";
  tabControl?: { value: TaskDetailTabId; onChange: (tab: TaskDetailTabId) => void };
  childrenDemandOwned?: boolean;
  surface?: "page" | "modal";
  task: Task;
  initiative?: Task;
  comments: TaskComment[];
  externalComments: TaskExternalComment[];
  activities: TaskActivity[];
  reviews: TaskReview[];
  blockers: TaskBlocker[];
  subIssues: Task[];
  teamProfiles: Profile[];
  sprints: Sprint[];
  allTasks: Task[];
  relations: TaskRelation[];
  currentProfile?: Pick<AuthenticatedProfile, "id" | "name" | "platformRole"> | null;
  operationalCorrection?: boolean;
  pending: boolean;
  taskSaves?: readonly PlanningTaskSaveView[];
  relationshipChanges?: readonly import("@/features/tasks/model/task-relationship-change").TaskRelationshipChangeView[];
  onCheckRelationshipChange?: (id: string) => void;
  attachmentUploads?: readonly import("@/features/tasks/model/task-attachment-upload").TaskAttachmentUploadView[];
  onCheckAttachmentUpload?: (id: string) => void;
  githubImport?: import("@/features/tasks/model/task-github-comment-import").TaskGitHubImportView | null;
  externalCommentCompleteness?: "complete" | "partial";
  onCheckGitHubImport?: () => void;
  commentDraft?: import("@/features/tasks/model/task-comment-draft").TaskCommentDraft;
  commentCreations?: readonly import("@/features/tasks/model/task-comment-creation").TaskCommentCreationView[];
  commentCompleteness?: "complete" | "partial";
  onCheckCommentCreation?: (id: string) => void;
  onRetryCommentCreation?: (id: string) => void;
  blockerReports?: readonly import("@/features/tasks/model/task-blocker-report").TaskBlockerReportView[];
  onCheckBlockerReport?: (id: string) => void;
  onCheckTaskSave?: () => Promise<PlanningTaskSaveCheck>;
  error?: string;
  detailDataError?: string;
  requestedCommentTarget?: string;
  detailDataLoading?: boolean;
  onRetryDetailData?: () => void;
  commentImportNotice?: string;
  commentImportPending?: boolean;
  githubInstallationAvailable: boolean;
  onOverviewDirtyChange?: (dirty: boolean) => void;
  onRequestDiscardAction: (action: () => void, force?: boolean) => void;
  onBeginEdit?: () => PlanningTaskEditor;
  onUpdate: (patch: Partial<Task>, options?: TaskUpdateOptions) => Promise<TaskUpdateResult> | void;
  onAddComment: (comment: string) => import("@/features/tasks/model/task-comment-creation").TaskCommentCapture;
  onUploadAttachment: (file: File) => Promise<string>;
  onImportGitHubComments: () => void;
  onReportBlocker: (payload: { reason: string; impact: string; needsHelpFrom: string }) => Promise<TaskActionResult>;
  onCreateSubIssue: () => void;
  onOpenTask: (taskId: string) => void;
  onOpenHierarchyTask?: (taskId: string) => void;
  onSyncGitHub: (options?: { createIfMissing?: boolean }) => void;
  onReview: (task: Task, decision: ReviewDecision, score: number, checklist: TaskReviewChecklist, comment: string) => Promise<boolean> | boolean | void;
  onReopenReview: (task: Task, evidence?: ReviewEvidenceSubmission) => Promise<boolean> | boolean | void;
  onWithdrawReview: (task: Task, reason: string) => Promise<boolean> | boolean | void;
  onWithdraw: (reason: string) => void;
  onAddRelation: (payload: { relationType: TaskRelationType; relatedTaskId: string; note: string }, basis?: Task) => Promise<TaskActionResult>;
  onRemoveRelation: (relation: TaskRelation) => void;
  onDecideApproval: (action: ApprovalDecisionAction, note?: string, basis?: Task) => void;
};

type TaskDetailReadContext = {
  detailOwner: PlanningState | null;
  scopedDetail: boolean;
  directChildType: Task["taskType"] | null;
};
type TaskDetailSurfaceEntryProps = TaskDetailSurfaceProps & TaskDetailReadContext & {
  activeTab: TaskDetailTabId;
  setActiveTab: (tab: TaskDetailTabId) => void;
};

export function TaskDetailSurface(props: TaskDetailSurfaceProps) {
  const detailOwner = usePlanningBusinessState();
  // Protocol capability does not certify target fields or read authority.
  const scopedDetail = props.detailReadMode === "scoped"
    || props.detailReadMode === undefined && detailOwner?.taskDetail(props.task.id).scopedRead === true;
  const directChildType = props.task.taskType === "epic" ? "initiative"
    : props.task.taskType === "initiative" ? "deliverable"
      : props.task.taskType === "deliverable" ? "sub_issue" : null;
  const context: TaskDetailReadContext = { detailOwner, scopedDetail, directChildType };
  return props.tabControl
    ? <TaskDetailSurfaceEntry {...props} {...context} activeTab={props.tabControl.value} setActiveTab={props.tabControl.onChange} />
    : <LocalTaskDetailSurface props={props} context={context} />;
}

function LocalTaskDetailSurface({ props, context }: { props: TaskDetailSurfaceProps; context: TaskDetailReadContext }) {
  const [activeTab, setActiveTab] = useState<TaskDetailTabId>(() => {
    const target = props.requestedCommentTarget || "";
    if (target.startsWith("relation:")) return "relationships";
    if (target.startsWith("field:") || target.startsWith("blocker:")) return "overview";
    return target ? "activity" : "overview";
  });
  return <TaskDetailSurfaceEntry {...props} {...context} activeTab={activeTab} setActiveTab={setActiveTab} />;
}

function TaskDetailSurfaceEntry(props: TaskDetailSurfaceEntryProps) {
  const { detailOwner, scopedDetail, activeTab, setActiveTab, directChildType } = props;
  useEffect(() => {
    if (props.childrenDemandOwned || !detailOwner || !scopedDetail || activeTab !== "overview" || !directChildType) return;
    const controller = new AbortController();
    void detailOwner.loadTaskDetail(props.task.id, { area: "children", signal: controller.signal });
    return () => controller.abort();
  }, [props.childrenDemandOwned, detailOwner, scopedDetail, props.task.id, activeTab, directChildType]);
  if (props.task.detailAvailability === "summary") {
    return (
      <div className="p-6" role="status" aria-live="polite">
        <UiNotice tone={props.detailDataError ? "danger" : "info"}>
          {props.detailDataError || "Aufgabendetails werden geladen …"}
        </UiNotice>
        {props.detailDataError && props.onRetryDetailData ? (
          <UiButton className="mt-3" onClick={props.onRetryDetailData}>Erneut laden</UiButton>
        ) : null}
      </div>
    );
  }
  return (
    <>
      {props.detailDataError && props.onRetryDetailData ? (
        <UiButton className="m-3" onClick={props.onRetryDetailData}>Erneut laden</UiButton>
      ) : null}
      <HydratedTaskDetailSurface {...props} detailOwner={detailOwner} scopedDetail={scopedDetail} activeTab={activeTab} setActiveTab={setActiveTab} directChildType={directChildType} />
    </>
  );
}

function HydratedTaskDetailSurface({
  detailOwner, scopedDetail, activeTab, setActiveTab, directChildType,
  surface = "page",
  task,
  initiative,
  comments,
  externalComments,
  activities,
  reviews,
  blockers,
  subIssues,
  teamProfiles,
  sprints,
  allTasks,
  relations,
  currentProfile = null,
  operationalCorrection = false,
  pending: requestPending,
  taskSaves = [],
  relationshipChanges = [],
  onCheckRelationshipChange,
  attachmentUploads = [],
  onCheckAttachmentUpload,
  githubImport,
  externalCommentCompleteness,
  onCheckGitHubImport,
  commentDraft,
  commentCreations = [],
  commentCompleteness = "complete",
  onCheckCommentCreation,
  onRetryCommentCreation,
  blockerReports = [],
  onCheckBlockerReport,
  onCheckTaskSave,
  error = "",
  detailDataError = "",
  requestedCommentTarget = "",
  detailDataLoading = false,
  commentImportNotice = "",
  commentImportPending = false,
  githubInstallationAvailable,
  onOverviewDirtyChange,
  onRequestDiscardAction,
  onUpdate,
  onBeginEdit,
  onAddComment,
  onUploadAttachment,
  onImportGitHubComments,
  onReportBlocker,
  onCreateSubIssue,
  onOpenTask,
  onOpenHierarchyTask = onOpenTask,
  onSyncGitHub,
  onReview,
  onReopenReview,
  onWithdrawReview,
  onWithdraw,
  onAddRelation,
  onRemoveRelation,
  onDecideApproval,
}: TaskDetailSurfaceEntryProps) {
  const confirmationPending = taskSaves.some(save => save.phase === "unconfirmed" || save.phase === "blocked");
  const pending = requestPending || confirmationPending;
  useEffect(() => {
    if (!detailOwner || !scopedDetail || activeTab !== "activity") return;
    const controller = new AbortController();
    for (const area of ["discussion", "timeline"] as const) {
      if (detailOwner.taskDetail(task.id).areaReadStatus?.[area] !== "current") void detailOwner.loadTaskDetail(task.id, { area, signal: controller.signal });
    }
    return () => controller.abort();
  }, [detailOwner, scopedDetail, task.id, activeTab]);
  const [reviewSetupOpen, setReviewSetupOpen] = useState(false);
  const [reviewEvidenceTask,setReviewEvidenceTask]=useState<Task|null>(null);
  const [reviewEvidenceGateIntent, setReviewEvidenceGateIntent] = useState<"request" | "reopen" | null>(null);
  const [evidenceRetry, setEvidenceRetry] = useState<{ taskId: string; scope: object; intent: "request" | "reopen" } | null>(null);
  const evidenceView = useMemo(() => ({ taskId: task.id, version: task.updatedAt, availability: task.detailAvailability,
    actorId: currentProfile?.id, actorRole: currentProfile?.platformRole, hasOwner: Boolean(detailOwner) }),
  [task.id, task.updatedAt, task.detailAvailability, currentProfile?.id, currentProfile?.platformRole, detailOwner]);
  const activeEvidenceView = useRef<object | null>(null);
  const evidenceAttempt = useRef(0);
  useEffect(() => {
    activeEvidenceView.current = evidenceView;
    return () => { if (activeEvidenceView.current === evidenceView) activeEvidenceView.current = null; evidenceAttempt.current++; };
  }, [evidenceView]);
  const [reviewDraftDirty, setReviewDraftDirty] = useState(false);
  const controller = useTaskDetailController({
    task,
    currentProfile,
    unrestricted: false,
    operationalCorrection,
    onUpdate,
    onBeginEdit,
  });
  const reviewActive = task.taskType === "deliverable" && isTaskReviewActive(task);
  const canDemandReviewBasis = reviewActive && controller.permissions.canOpenReview;
  const reviewBasis = canDemandReviewBasis ? detailOwner?.taskReviewBasis(task.id) : undefined;
  const reviewBasisDemand = Boolean(reviewBasis) && task.detailAvailability !== "stale";
  const reviewDemand = useRef<AbortController | null>(null);
  useEffect(() => {
    if (!detailOwner || !reviewBasisDemand) return;
    const demand = new AbortController();
    reviewDemand.current = demand;
    void detailOwner.loadTaskReviewBasis(task.id, { signal: demand.signal });
    return () => {
      if (reviewDemand.current === demand) reviewDemand.current = null;
      demand.abort();
    };
  }, [detailOwner, task.id, task.updatedAt, reviewBasisDemand]);
  const reviewLocked = task.taskType === "deliverable" && isTaskReviewLocked(task);
  const directChildren = directChildType
    ? subIssues.filter((item) => item.parentTaskId === task.id && item.taskType === directChildType)
    : [];
  const canCreateDirectChild = directChildType === "sub_issue"
    ? controller.permissions.canCreateSubIssue
    : Boolean(directChildType && controller.permissions.canManageTaskMeta);
  const currentInitiative = initiative;
  const parentTask = allTasks.find((item) => item.id === task.parentTaskId);
  const relationshipGroups = buildTaskRelationshipRows(task, allTasks, relations);
  const baseRelationshipAccess = taskRelationshipAccess({ task, initiative: currentInitiative, profile: currentProfile, unrestricted: false, operationalCorrection });
  const relationshipAccess = reviewLocked ? {
    ...baseRelationshipAccess,
    allowedRelationTypes: [],
    canRemoveRelation: () => false,
  } : baseRelationshipAccess;
  const relationTargetOptions = relationTargetOptionsForTask(task, allTasks);
  const profileName = (profileId: string) => teamProfiles.find((profile) => profile.id === profileId)?.name || profileId || "Unbekannt";
  const canApprove = task.taskType === "initiative"
    ? canDecideInitiativeApproval({ approvalStatus: task.approvalStatus || "draft" }, currentProfile)
    : canApproveDeliverableApproval(task, currentInitiative, currentProfile);
  const canReject = task.taskType === "initiative"
    ? canDecideInitiativeApproval({ approvalStatus: task.approvalStatus || "draft" }, currentProfile)
    : canRejectDeliverableApproval(task, currentInitiative, currentProfile);
  const canReturnToDraft = task.taskType === "initiative"
    ? canReturnInitiativeForRevision({ approvalStatus: task.approvalStatus || "draft" }, currentProfile)
    : canReturnDeliverableForRevision(task, currentInitiative, currentProfile);
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
  }, task.taskType);
  const effectivelyApproved = task.taskType === "epic" || task.taskType === "initiative" || isTaskPlanningActive(task);
  const canSelectNextStatus = statusOptions.some((status) => status !== normalizeStatus(task.status));
  const statusLockedReason = reviewLocked
    ? reviewLockMessage(task)
    : !effectivelyApproved
    ? task.taskType === "sub_issue" ? "Parent-Deliverable ist noch nicht freigegeben." : "Deliverable ist noch nicht freigegeben."
    : !controller.permissions.canUpdateStatus ? "Deine Rolle darf diesen Status nicht ändern."
      : !canSelectNextStatus ? "Für deine Rolle ist kein weiterer Status verfügbar." : undefined;
  const areaStatuses = detailOwner?.taskDetail(task.id).areaReadStatus;
  const scopedView = detailOwner?.taskDetail(task.id);
  const relationshipsUnknown = scopedDetail && areaStatuses?.relationships !== "current";
  const relationshipsLoading = scopedDetail && areaStatuses?.relationships === "loading";
  const childrenKnown = !scopedDetail || scopedView?.childrenCoverage === "complete" || scopedView?.childrenCoverage === "complete-empty";
  const childrenLoading = scopedDetail && scopedView?.childrenReadStatus === "loading";
  const loadRetainedDetail = () => { void detailOwner?.loadTaskDetail(task.id); };
  const retryArea = async (area: "discussion" | "timeline", button: HTMLButtonElement) => {
    const focused = document.activeElement === button;
    const panel = button.closest('[role="tabpanel"]');
    const labelledBy = panel?.getAttribute("aria-labelledby");
    await detailOwner?.loadTaskDetail(task.id, { area });
    window.requestAnimationFrame(() => {
      if (!focused || document.activeElement !== document.body && document.activeElement !== button) return;
      const retry = panel?.querySelector<HTMLElement>(`[data-detail-retry="${area}"]`);
      const tab = labelledBy ? document.getElementById(labelledBy) : null;
      (retry || tab)?.focus({ preventScroll: true });
    });
  };
  const activityKnown = scopedDetail ? areaStatuses?.discussion === "current" && areaStatuses?.timeline === "current" : !detailDataLoading && !detailDataError;
  const activityPending = scopedDetail && [areaStatuses?.discussion, areaStatuses?.timeline].some(status => !status || status === "not-loaded" || status === "loading");
  const activityUnavailable = scopedDetail && [areaStatuses?.discussion, areaStatuses?.timeline].some(status => status === "unavailable" || status === "stale");
  const detailDataKnown = !detailDataLoading && !detailDataError;
  const detailDataUnavailable = Boolean(detailDataError);
  const canEditOverview = Object.values(controller.overviewPermissions).some(Boolean);
  const relationshipCount = uniqueRelationshipCount(relationshipGroups);
  const activityCount = visibleTaskActivityCount({ comments, externalComments, activities }) + reviews.length;
  const availableTabs = taskDetailAvailableTabs({
    activityCount: requestedCommentTarget ? Math.max(activityCount, 1) : activityCount,
    activityKnown,
    canAddRelationship: relationshipAccess.allowedRelationTypes.length > 0,
    canComment: controller.permissions.canComment,
    relationshipCount,
    relationshipsKnown: detailDataKnown && !relationshipsUnknown,
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
  const openRequestedComment = useEffectEvent(() => {
    const reveal = (tab: TaskDetailTabId, targetId: string) => {
      changeTab(tab);
      window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
        const target = document.getElementById(targetId);
        target?.scrollIntoView({ behavior: "smooth", block: "center" });
        target?.focus({ preventScroll: true });
      }));
    };
    if (requestedCommentTarget.startsWith("blocker:")) {
      reveal("overview", `task-blocker-${requestedCommentTarget.slice("blocker:".length)}`);
      return;
    }
    if (requestedCommentTarget.startsWith("relation:")) {
      reveal("relationships", `task-relation-${requestedCommentTarget.slice("relation:".length)}`);
      return;
    }
    if (!requestedCommentTarget.startsWith("field:")) {
      changeTab("activity");
      return;
    }
    const field = requestedCommentTarget.slice("field:".length);
    const targetId = taskMentionFieldTargetIds[field as keyof typeof taskMentionFieldTargetIds];
    if (targetId) reveal("overview", targetId);
  });
  useEffect(() => {
    if (!requestedCommentTarget) return;
    openRequestedComment();
  }, [requestedCommentTarget]);
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
  const openHierarchyTask = (taskId: string) => {
    requestDiscardAction(() => {
      if (controller.overviewEditing) controller.cancelOverview();
      onOpenHierarchyTask(taskId);
    });
  };
  const [inlineEditor, setInlineEditor] = useState<{ taskId: string; editor: PlanningTaskEditor } | null>(null);
  useEffect(() => () => inlineEditor?.editor.close(), [inlineEditor]);
  const beginInlineEditing = () => {
    if (inlineEditor?.taskId === task.id && inlineEditor.editor.view().phase === "saving") return inlineEditor.editor;
    const editor = onBeginEdit?.();
    if (editor) setInlineEditor({ taskId: task.id, editor });
    return editor;
  };
  const updateInline = (patch: Partial<Task>) => {
    const existing = inlineEditor?.taskId === task.id ? inlineEditor.editor : null;
    const editor = existing && ["editing", "saving", "conflict", "unconfirmed", "blocked"].includes(existing.view().phase) ? existing : beginInlineEditing();
    return editor ? onUpdate(patch, { editor }) : onUpdate(patch);
  };
  const inlineConflict = inlineEditor?.taskId === task.id && inlineEditor.editor.view().phase === "conflict" ? inlineEditor.editor.view() : null;
  const beginEvidenceAttempt = () => {
    setEvidenceRetry(null);
    return { scope: evidenceView, attempt: ++evidenceAttempt.current };
  };
  const rememberRejectedEvidence = (intent: "request" | "reopen", binding: ReturnType<typeof beginEvidenceAttempt>) => {
    if (activeEvidenceView.current === binding.scope && evidenceAttempt.current === binding.attempt) setEvidenceRetry({ taskId: task.id, scope: binding.scope, intent });
  };
  const guardedUpdate = (patch: Partial<Task>) => {
    const requestsReview = patch.status === "Review" || patch.reviewStatus === "requested";
    const includesEvidence = Boolean(patch.evidenceLinks?.length || patch.reviewEvidenceExceptionNote?.trim());
    const evidenceStatus = taskReviewEvidenceStatus(task, directChildren, { membershipComplete: childrenKnown });
    const binding = requestsReview ? beginEvidenceAttempt() : undefined;
    if (task.taskType === "deliverable" && requestsReview && evidenceStatus === "absent" && !includesEvidence) {
      beginInlineEditing();
      setReviewEvidenceTask(task);
      setReviewEvidenceGateIntent("request");
      return;
    }
    const result = updateInline(patch);
    if (binding && evidenceStatus === "unknown" && result) return result.then(outcome => {
      if (outcome.ok === false) rememberRejectedEvidence("request", binding);
      return outcome;
    });
    return result;
  };
  const reopenReview = () => {
    const binding = beginEvidenceAttempt();
    const evidenceStatus = taskReviewEvidenceStatus(task, directChildren, { membershipComplete: childrenKnown });
    if (evidenceStatus === "absent") {
      setReviewEvidenceTask(task);
      setReviewEvidenceGateIntent("reopen");
      return;
    }
    const result = onReopenReview(task);
    if (evidenceStatus === "unknown") {
      if (result === false) rememberRejectedEvidence("reopen", binding);
      else if (result && typeof result === "object") return result.then(accepted => {
        if (accepted === false) rememberRejectedEvidence("reopen", binding);
        return accepted;
      });
    }
    return result;
  };
  const canCaptureRejectedEvidence = evidenceRetry?.taskId === task.id && evidenceRetry.scope === evidenceView
    && (evidenceRetry.intent === "reopen" ? controller.permissions.canOpenReview : controller.permissions.canUpdateStatus && effectivelyApproved && canSelectNextStatus);
  const captureRejectedEvidence = () => {
    if (!evidenceRetry || !canCaptureRejectedEvidence || pending) return;
    beginEvidenceAttempt();
    setReviewEvidenceTask(task);
    setReviewEvidenceGateIntent(evidenceRetry.intent);
  };
  const submitReviewEvidence = async (submission: ReviewEvidenceSubmission) => {
    if (reviewEvidenceGateIntent === "reopen") {
      const result = await onReopenReview(reviewEvidenceTask||task, submission);
      return result !== false;
    }
    const result = await updateInline({
      status: "Review",
      reviewStatus: "requested",
      scoreFinal: false,
      ...(submission.evidenceLink ? {
        evidenceLinks: [...task.evidenceLinks, submission.evidenceLink],
        reviewEvidenceExceptionNote: "",
      } : {
        reviewEvidenceExceptionNote: submission.evidenceExceptionNote || "",
      }),
    });
    return result?.ok !== false;
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
          subIssues={directChildren}
          subIssueMembershipComplete={childrenKnown}
          verifiedReviewEvidence={reviewBasis?.evidence}
          onOpenTask={openTask}
          profiles={teamProfiles}
          baseline={controller.overviewBaselineDraft}
          draft={controller.overviewDraft}
          permissions={controller.overviewPermissions}
          editing={controller.overviewEditing}
          dirty={controller.overviewDirty}
          saving={controller.overviewSaving}
          error={controller.overviewError}
          flat={reviewActive}
          onCancel={cancelOverview}
          confirmationPending={confirmationPending}
          conflict={controller.overviewConflict}
          canResave={controller.overviewCanResave}
          conflictServerDraft={controller.overviewServerDraft}
          onReloadConflict={controller.refreshOverviewConflict}
          onSave={controller.overviewConflict ? controller.resaveOverview : controller.saveOverview}
          onChange={(patch) => controller.setOverviewDraft((current) => ({ ...current, ...patch }))}
          riskContent={!controller.overviewEditing ? (
            <>
              {reviewActive && !relationshipsUnknown ? (
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
              {detailDataLoading || detailDataUnavailable || blockers.length > 0 || blockerReports.length > 0 || controller.permissions.canReportBlocker ? (
                <TaskDetailPanelBlockerSection
                  canReport={controller.permissions.canReportBlocker}
                  blockers={blockers}
                  reports={blockerReports}
                  onCheckReport={onCheckBlockerReport}
                  blockerDraft={controller.blockerDraft}
                  embedded={task.taskType === "sub_issue"}
                  loading={detailDataLoading}
                  unavailable={detailDataUnavailable || relationshipsUnknown}
                  pending={pending}
                  profiles={teamProfiles}
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
    relationships: (
      <>
      {relationshipsUnknown ? <UiNotice tone="info" className="mb-2">
        Beziehungen und Blocker noch nicht geladen.
        <UiButton type="button" disabled={relationshipsLoading} onClick={loadRetainedDetail}>Beziehungen laden</UiButton>
      </UiNotice> : null}
      <TaskRelationshipsSection
        task={task}
        profiles={teamProfiles}
        waitsOn={relationshipGroups.waitsOn}
        blocks={relationshipGroups.blocks}
        related={relationshipGroups.related}
        legacyDependsOn={task.dependsOn}
        relationshipChanges={relationshipChanges}
        onCheckRelationshipChange={onCheckRelationshipChange}
        relationDraft={controller.relationDraft}
        relationTargetOptions={relationTargetOptions}
        allowedRelationTypes={relationshipAccess.allowedRelationTypes}
        pending={pending}
        loading={detailDataLoading || relationshipsLoading}
        unavailable={detailDataUnavailable || relationshipsUnknown}
        onOpenTask={openTask}
        onRemoveRelation={onRemoveRelation}
        canRemoveRelation={relationshipAccess.canRemoveRelation}
        canEditLegacyDependsOn={controller.permissions.canEditNotes}
        onLegacyEditingStart={beginInlineEditing}
        onUpdateLegacyDependsOn={async (value) => {
          const result = await updateInline({ dependsOn: value });
          return result || { ok: true, task: { dependsOn: value } };
        }}
        onRelationDraftChange={(patch) => controller.setRelationDraft((current) => ({ ...current, ...patch }))}
        onAddRelation={async (basis) => {
          const result = await onAddRelation(controller.relationDraft, basis);
          if (result.ok) {
            controller.setRelationDraft({ relationType: "blocked_by", relatedTaskId: "", note: "" });
          }
          return result;
        }}
      />
      </>
    ),
    activity: (
      <>
      {scopedDetail ? (["discussion", "timeline"] as const).map(area => areaStatuses?.[area] === "unavailable" || areaStatuses?.[area] === "stale" ? (
        <UiNotice key={area} tone="danger" className="mb-2">
          {area === "discussion" ? "Diskussion ist nicht verfügbar." : "Aktivität ist nicht verfügbar."}
          <UiButton type="button" data-detail-retry={area} onClick={event => { void retryArea(area, event.currentTarget); }}>
            {area === "discussion" ? "Diskussion erneut laden" : "Aktivität erneut laden"}
          </UiButton>
        </UiNotice>
      ) : null) : null}
      <TaskCommentThread
        commentDraft={commentDraft}
        comments={comments}
        attachmentUploads={attachmentUploads}
        onCheckAttachmentUpload={onCheckAttachmentUpload}
        githubImport={githubImport}
        externalCommentCompleteness={externalCommentCompleteness}
        onCheckGitHubImport={onCheckGitHubImport}
        commentCreations={commentCreations}
        commentCompleteness={commentCompleteness}
        onCheckCommentCreation={onCheckCommentCreation}
        onRetryCommentCreation={onRetryCommentCreation}
        externalComments={externalComments}
        activities={activities}
        reviews={reviews}
        notice={commentImportNotice}
        profiles={teamProfiles}
        tasks={allTasks}
        sprints={sprints}
        currentProfileId={currentProfile?.id || ""}
        requestedCommentTarget={requestedCommentTarget}
        loading={detailDataLoading || activityPending}
        unavailable={detailDataUnavailable || activityUnavailable}
        pending={pending}
        importPending={commentImportPending}
        readOnly={!controller.permissions.canComment}
        onImportGitHubComments={canSyncPlanningItemToGitHub(task) ? onImportGitHubComments : undefined}
        onUploadAttachment={canSyncPlanningItemToGitHub(task) ? onUploadAttachment : undefined}
        onAddComment={onAddComment}
        title="Aktivität"
        description={canSyncPlanningItemToGitHub(task) ? "Kommentare, GitHub-Updates und relevante Änderungen in einer gemeinsamen Timeline." : "Kommentare und relevante Änderungen in einer gemeinsamen Timeline."}
        footer={<TaskDetailHistorySummary task={task} profiles={teamProfiles} />}
      />
      </>
    ),
  } satisfies Record<TaskDetailTabId, ReactNode>;

  const operationalHeader = (
    <TaskDetailOperationalHeader
      task={task}
      initiative={currentInitiative}
      parentTask={parentTask}
      profiles={teamProfiles}
      subIssues={directChildren}
      subIssuesKnown={!scopedDetail || Boolean(scopedView?.childProgress)}
      childProgress={scopedDetail ? scopedView?.childProgress || null : undefined}
      statusOptions={statusOptions}
      canChangeStatus={controller.permissions.canUpdateStatus && effectivelyApproved && canSelectNextStatus}
      statusLockedReason={statusLockedReason}
      canManageTaskMeta={controller.permissions.canManageTaskMeta}
      pending={pending}
      titleId={surface === "modal" ? "task-detail-panel-title" : "task-detail-page-title"}
      onOpenTask={openHierarchyTask}
      actions={(
        <TaskDetailHeaderActions
          task={task}
          canEditOverview={canEditOverview && !controller.overviewEditing}
        canManageReviewOwner={canReviewPlanningItem(task) && !reviewActive && controller.permissions.canManageReviewOwner}
          canWithdrawTask={canWithdrawTask}
          githubInstallationAvailable={githubInstallationAvailable}
          pending={pending}
          onEditOverview={startOverviewEditing}
          onShowReviewSetup={() => setReviewSetupOpen(true)}
          onSyncGitHub={onSyncGitHub}
          onWithdraw={onWithdraw}
        />
      )}
      onEditingStart={beginInlineEditing}
      onUpdate={guardedUpdate}
    />
  );

  const reviewRail = reviewActive ? (
    <TaskReviewRail
      key={`${task.id}:${task.reviewRequestedAt || "unknown"}:${currentProfile?.id || "anonymous"}`}
      task={task}
      currentProfileId={currentProfile?.id || ""}
      profiles={teamProfiles}
      canReview={controller.permissions.canOpenReview}
      decisionBasis={reviewBasis}
      onRetryDecisionBasis={detailOwner && reviewBasis ? async () => {
        const signal = reviewDemand.current?.signal;
        if (!signal) return false;
        if (reviewBasis.targetChanged) {
          const target = await detailOwner.loadTaskDetail(task.id, { area: "target", signal });
          if (!target.ok || signal.aborted) return false;
        }
        const loaded = await detailOwner.loadTaskReviewBasis(task.id, { refresh: true, signal });
        return loaded && !detailOwner.taskReviewBasis(task.id)?.blockedReason;
      } : undefined}
      canWithdraw={canWithdrawReview}
      canManageReviewOwner={controller.permissions.canManageReviewOwner}
      pending={pending}
      onDirtyChange={setReviewDraftDirty}
      onReview={onReview}
      onWithdraw={onWithdrawReview}
      onEditingStart={beginInlineEditing}
      onReviewOwnerChange={(reviewOwnerProfileId) => updateInline({ reviewOwnerProfileId })}
      onJumpToSection={jumpToReviewSection}
    />
  ) : null;

  const issueContent = (
    <>
      <TaskDetailPlanningSection
        task={task}
        teamProfiles={teamProfiles}
        allTasks={allTasks}
        sprints={sprints}
        canManageTaskMeta={controller.permissions.canManageTaskMeta}
        canReparentSubIssue={controller.permissions.canReparentSubIssue}
        pending={pending}
        onEditingStart={beginInlineEditing}
        onUpdate={guardedUpdate}
      />

      {directChildType ? (
        <div className="mt-5">
          <TaskDetailPanelChildrenSection
            canCreate={canCreateDirectChild}
            childItems={directChildren}
            known={childrenKnown}
            loading={childrenLoading}
            progress={scopedDetail ? scopedView?.childProgress || null : undefined}
            error={scopedDetail && scopedView?.childrenReadStatus === "unavailable" ? "Unteraufgaben konnten nicht geladen werden." : ""}
            onLoad={scopedDetail ? () => { void detailOwner?.loadTaskDetail(task.id, { area: "children", refresh: true }); } : undefined}
            childType={directChildType}
            onCreateChild={onCreateSubIssue}
            onOpenTask={openTask}
          />
        </div>
      ) : null}

      {!reviewActive && !relationshipsUnknown ? (
        <TaskDetailDependencyBand
          waitsOn={relationshipGroups.waitsOn}
          blocks={relationshipGroups.blocks}
          loading={detailDataLoading}
          error={detailDataError}
          onOpenTask={openTask}
        />
      ) : null}

      {task.taskType === "initiative" || task.taskType === "deliverable" ? (
        <TaskDetailWorkflowStrips
          task={task}
          teamProfiles={teamProfiles}
          canApprove={canApprove}
          canReject={canReject}
          canReturnToDraft={canReturnToDraft}
          canManageReviewOwner={task.taskType === "deliverable" && controller.permissions.canManageReviewOwner}
          forceReviewSetup={reviewSetupOpen}
          pending={pending}
          onEditingStart={beginInlineEditing}
        onUpdate={guardedUpdate}
          onDecideApproval={onDecideApproval}
        />
      ) : null}

      {!reviewActive && task.taskType === "deliverable" ? (
        <TaskReviewSummary
          task={task}
          reviews={reviews}
          profiles={teamProfiles}
          canReopen={controller.permissions.canOpenReview}
          pending={pending}
          onReopen={reopenReview}
        />
      ) : null}

      <TaskSaveNotice taskTitle={taskSaves[0]?.checkStatus === "forbidden" ? "Aufgabe" : task.title} saves={taskSaves} labels={{profiles:teamProfiles,tasks:allTasks,sprints}} onCheck={onCheckTaskSave} />
      {inlineConflict ? <UiNotice tone="info" role="alert" className="mt-4">
        <p>Die Aufgabe wurde zwischenzeitlich geändert. Deine abgesendete Änderung bleibt erhalten.</p>
        <p className="mt-2">Aktueller Stand: {inlineConflict.serverTask?.title || "Noch nicht verfügbar"} · {inlineConflict.serverTask?.status}</p>
        <UiButton type="button" size="lg" disabled={!inlineConflict.canResave} onClick={() => { if (inlineConflict.submitted && inlineEditor) void onUpdate(inlineConflict.submitted, { editor: inlineEditor.editor, resave: true }); }}>Änderung erneut speichern</UiButton>
        {!inlineConflict.canResave ? <UiButton type="button" size="lg" onClick={() => { void inlineEditor?.editor.refreshConflict(); }}>Aktuellen Stand erneut laden</UiButton> : null}
      </UiNotice> : null}
      {error ? <div role="alert" className="mt-4 rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm font-semibold text-red-700">
        {error}
        {canCaptureRejectedEvidence ? <UiButton type="button" size="lg" className="mt-3" disabled={pending} onClick={captureRejectedEvidence}>Nachweis ergänzen</UiButton> : null}
      </div> : null}

      <TaskDetailTabs
        value={activeTab}
        onValueChange={changeTab}
        availableTabs={availableTabs}
        className={reviewActive ? "mt-2" : "mt-5"}
        tabListClassName="sticky top-0 z-10 bg-white/95 backdrop-blur"
        counts={{
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
      {reviewEvidenceGateIntent ? (
        <ReviewEvidenceGateDialog
          pending={pending}
          profiles={teamProfiles}
          onClose={() => setReviewEvidenceGateIntent(null)}
          onConfirm={submitReviewEvidence}
        />
      ) : null}
    </>
  );

  if (taskSaves.some(save => save.phase === "unconfirmed") && taskSaves.every(save => save.submitted === null)) {
    return <TaskSaveNotice taskTitle="Aufgabe" saves={taskSaves} labels={{profiles:teamProfiles,tasks:allTasks,sprints}} onCheck={onCheckTaskSave} />;
  }

  if (surface === "modal") {
    return (
      <div className="flex h-full min-h-0 min-w-0 flex-col overflow-y-auto overscroll-contain bg-white sm:overflow-hidden sm:overscroll-auto">
        <div className="shrink-0 px-4 pt-4 sm:px-6">{operationalHeader}</div>
        <div className="min-h-0 shrink-0 overflow-visible px-4 pb-5 sm:flex-1 sm:overflow-y-auto sm:overscroll-contain sm:px-6">
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
