"use client";

import { useEffect, useState } from "react";
import { SprintControlsSummary } from "@/features/sprint/molecules/sprint-controls-summary";
import { SprintMeetingAttendanceSection } from "@/features/sprint/molecules/sprint-meeting-attendance-section";
import { SprintPlanningSection } from "@/features/sprint/molecules/sprint-planning-section";
import { SprintReviewWindowSettings } from "@/features/sprint/molecules/sprint-review-window-settings";
import { SprintFounderScoreTable } from "@/features/sprint/organisms/sprint-founder-score-table";
import { SprintScoreObjections } from "@/features/sprint/organisms/sprint-score-objections";
import { SprintTaskTables } from "@/features/sprint/organisms/sprint-task-tables";
import { ReviewEvidenceGateDialog } from "@/features/reviews/molecules/review-evidence-gate-dialog";
import {
  taskHasValidReviewEvidence,
  type ReviewEvidenceSubmission,
} from "@/features/reviews/model/review-evidence";
import { buildSprintScoreViewModel } from "@/features/sprint/model/sprint-score-view-model";
import type { SprintPlanningOptions } from "@/features/sprint/model/sprint-planning-options";
import { sprintWorkspaceModelToPlanningShellState } from "@/features/sprint/model/sprint-planning-shell-projection";
import type { PlanningState } from "@/features/planning/model/planning-state";
import { findCurrentSprint } from "@/lib/planning-schedule";
import type { Meeting, MeetingAttendance, Profile, Task, TaskStatus } from "@/lib/types";

export function SprintScoreTableOverview({
  planningState,
  pending,
  onOpenTask,
  onRequestReview,
  onChangeStatus,
  onUpdateMeetingAttendance,
  onAssignSprint,
  sprintPlanningOptions,
  plannedSprintCount,
  onUpdateSprintPlanning,

  currentProfile,
  canManageSprint,
  reviewObjectionWindowHours,
}: {
  planningState: PlanningState;
  pending: boolean;
  onOpenTask: (taskId: string) => void;
  onRequestReview: (task: Task, evidence?: ReviewEvidenceSubmission) => Promise<boolean> | boolean | void;
  onChangeStatus: (task: Task, status: TaskStatus) => void;
  onUpdateMeetingAttendance: (meeting: Meeting, attendance: MeetingAttendance) => void;
  onAssignSprint: (task: Task, sprintId: string) => void;
  sprintPlanningOptions: SprintPlanningOptions;
  plannedSprintCount: number;
  onUpdateSprintPlanning: (options: SprintPlanningOptions) => void;
  currentProfile: Profile | null;
  canManageSprint: boolean;
  reviewObjectionWindowHours: number;
}) {
  const sprintView = planningState.sprintWorkspace();
  const sprintData = sprintWorkspaceModelToPlanningShellState(sprintView.model);
  const currentSprint = findCurrentSprint(sprintData.sprints);
  const [selectedSprintId, setSelectedSprintId] = useState(currentSprint?.id || "");
  const [reviewEvidenceTask, setReviewEvidenceTask] = useState<Task | null>(null);
  useEffect(() => {
    if (!sprintData.sprints.length) return;
    if (!selectedSprintId || !sprintData.sprints.some((item) => item.id === selectedSprintId)) {
      const nextSprintId = findCurrentSprint(sprintData.sprints)?.id || sprintData.sprints[0]?.id || "";
      window.queueMicrotask(() => setSelectedSprintId(nextSprintId));
    }
  }, [sprintData.sprints, selectedSprintId]);

  const {
    sprint,
    sprintTasks,
    otherTasks,
    unassignedTasks,
    scoreRows,
    reviewTasks,
    meetings,
    finalScores,
    openScores,
    sprintHasTasks,
    sprintIsCurrent,
  } = buildSprintScoreViewModel({ data: sprintData, selectedSprintId, coverage: sprintView.model.coverage });
  const openObjections = sprintData.scoreObjections.filter((item) => item.sprintId === sprint?.id && item.status === "open");
  const provisionalIds = planningState.sprintPlan().provisionalSprintIds;
  const sprintPending = pending || provisionalIds.includes(sprint?.id || "");
  const sprintControlsDisabled = sprintPending || !canManageSprint;
  const reviewOwnerName = (task: Task) => task.reviewOwnerProfileId
    ? sprintData.profiles.find((profile) => profile.id === task.reviewOwnerProfileId)?.name || task.reviewOwnerProfileId
    : "Ohne Review Owner";
  const isSelfReview = (task: Task) => Boolean(task.reviewOwnerProfileId && (task.assigneeId === task.reviewOwnerProfileId || task.assignee === task.reviewOwnerProfileId));
  const requestReview = (task: Task) => {
    if (!taskHasValidReviewEvidence(task, sprintData.tasks)) {
      setReviewEvidenceTask(task);
      return;
    }
    return onRequestReview(task);
  };

  if (sprintView.readStatus === "forbidden" || !sprint) {
    const message = sprintView.readStatus === "forbidden" ? "Keine Berechtigung für diesen Sprint-Bereich."
      : sprintView.readStatus === "unavailable" ? "Sprint-Daten sind derzeit nicht verfügbar."
      : sprintView.readStatus === "loading" || sprintView.readStatus === "not-loaded" ? "Sprint-Daten werden geladen."
      : sprintView.model.coverage.sprints !== "complete" ? "Die Sprint-Liste ist noch nicht vollständig geladen."
      : "Noch kein Sprint angelegt.";
    return (
      <div className="grid min-w-0 gap-4"><section className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
        {message}
      </section>{sprintView.readStatus !== "forbidden" && canManageSprint && <SprintPlanningSection disabled={!canManageSprint} pending={pending} sprintPlanningOptions={sprintPlanningOptions} plannedSprintCount={plannedSprintCount} onUpdateSprintPlanning={onUpdateSprintPlanning} planningState={planningState} />}</div>
    );
  }

  return (
    <div className="grid min-w-0 gap-4">
      {currentProfile?.platformRole === "ceo" && (
        <SprintReviewWindowSettings
          disabled={currentProfile.platformRole !== "ceo"}
          pending={pending}
          reviewObjectionWindowHours={reviewObjectionWindowHours}
          planningState={planningState}
        />
      )}
      <SprintControlsSummary
        key={sprint.id}
        data={sprintData}
        sprint={sprint}
        currentSprint={currentSprint}
        sprintTasks={sprintTasks}
        reviewTasksCount={reviewTasks.length}
        finalScores={finalScores}
        openScores={openScores}
        unassignedTasksCount={unassignedTasks.length}
        sprintHasTasks={sprintHasTasks}
        sprintIsCurrent={sprintIsCurrent}
        sprintControlsDisabled={sprintControlsDisabled}
        openObjectionsCount={openObjections.length}
        objectionsComplete={sprintView.model.coverage.objections==="complete"}
        canFinalizeSprintScore={currentProfile?.platformRole === "ceo"}
        sprintPlanningOptions={sprintPlanningOptions}
        onSelectedSprintChange={setSelectedSprintId}
        planningState={planningState}
      />

      <SprintPlanningSection
        disabled={!canManageSprint}
        pending={pending}
        sprintPlanningOptions={sprintPlanningOptions}
        plannedSprintCount={plannedSprintCount}
        onUpdateSprintPlanning={onUpdateSprintPlanning}
        planningState={planningState}
      />

      <SprintFounderScoreTable
        sprint={sprint}
        scoreRows={scoreRows}
        pending={sprintPending}
        planningState={planningState}
      />

      <SprintMeetingAttendanceSection
        data={sprintData}
        meetings={meetings}
        pending={sprintPending}
        currentProfile={currentProfile}
        canManageSprint={canManageSprint}
        onUpdateMeetingAttendance={(meeting, attendance) => {
          onUpdateMeetingAttendance(meeting, attendance);
        }}
      />

      <SprintScoreObjections
        key={sprint.id}
        data={sprintData}
        sprint={sprint}
        currentProfile={currentProfile}
        pending={sprintPending}
        planningState={planningState}
      />

      <SprintTaskTables
        data={{ ...sprintData, sprints: sprintData.sprints.filter(item => !provisionalIds.includes(item.id)) }}
        sprint={sprint}
        sprintTasks={sprintTasks}
        otherTasks={otherTasks}
        pending={pending}
        canManageFinalTaskStatus={currentProfile?.platformRole === "ceo"}
        reviewOwnerName={reviewOwnerName}
        isSelfReview={isSelfReview}
        onOpenTask={onOpenTask}
        onRequestReview={(task) => {
          requestReview(task);
        }}
        onChangeStatus={(task, status) => {
          if (status === "Review") {
            requestReview(task);
            return;
          }
          onChangeStatus(task, status);
        }}
        onAssignSprint={(task, sprintId) => {
          onAssignSprint(task, sprintId);
        }}
        onOpenReviewTask={onOpenTask}
      />
      {reviewEvidenceTask ? (
        <ReviewEvidenceGateDialog
          pending={pending}
          onClose={() => setReviewEvidenceTask(null)}
          onConfirm={async (submission) => {
            const task = reviewEvidenceTask;
            const result = await onRequestReview(task, submission);
            if (result === false) return false;
            return true;
          }}
        />
      ) : null}
    </div>
  );
}
