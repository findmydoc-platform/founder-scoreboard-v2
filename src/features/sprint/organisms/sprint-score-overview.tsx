"use client";

import { useCallback, useEffect, useState } from "react";
import { SprintControlsSummary } from "@/features/sprint/molecules/sprint-controls-summary";
import { SprintMeetingAttendanceSection } from "@/features/sprint/molecules/sprint-meeting-attendance-section";
import { SprintFounderScoreTable } from "@/features/sprint/organisms/sprint-founder-score-table";
import { SprintReviewSheetSection } from "@/features/sprint/organisms/sprint-review-sheet-section";
import { SprintScoreObjections } from "@/features/sprint/organisms/sprint-score-objections";
import { SprintTaskTables } from "@/features/sprint/organisms/sprint-task-tables";
import { buildSprintScoreViewModel } from "@/features/sprint/model/sprint-score-view-model";
import { findCurrentSprint } from "@/lib/planning-schedule";
import type { Meeting, MeetingAttendance, PlanningData, Profile, Sprint, SprintCommitment, Task, TaskStatus } from "@/lib/types";

type ReviewStatus = "accepted" | "partial" | "changes_requested";
type ReviewChecklist = {
  acceptanceCriteriaMet?: boolean;
  dodMet?: boolean;
  evidenceProvided?: boolean;
  communicationClear?: boolean;
  blockerHandled?: boolean;
};

export function SprintScoreTableOverview({
  data,
  pending,
  onOpen,
  onReview,
  onReopenReview,
  onRequestReview,
  onChangeStatus,
  onLockSprint,
  onUpdateSprint,
  onUpdateCommitment,
  onUpdateMeetingAttendance,
  onCreateScoreObjection,
  onReviewScoreObjection,
  onAssignSprint,
  currentProfile,
  canManageSprint,
  sprintLockMessage,
  focusedReviewTaskId = "",
  onFocusedReviewTaskHandled,
}: {
  data: PlanningData;
  pending: boolean;
  onOpen: (task: Task) => void;
  onReview: (
    task: Task,
    reviewStatus: ReviewStatus,
    scorePoints: number,
    checklist?: ReviewChecklist,
    comment?: string,
  ) => void;
  onReopenReview: (task: Task) => void;
  onRequestReview: (task: Task) => void;
  onChangeStatus: (task: Task, status: TaskStatus) => void;
  onLockSprint: (sprintId: string) => void;
  onUpdateSprint: (sprint: Sprint, patch: Partial<Sprint>) => void;
  onUpdateCommitment: (commitment: SprintCommitment) => void;
  onUpdateMeetingAttendance: (meeting: Meeting, attendance: MeetingAttendance) => void;
  onCreateScoreObjection: (sprint: Sprint, comment: string) => void;
  onReviewScoreObjection: (sprint: Sprint, objectionId: number, status: "reviewed" | "dismissed" | "accepted") => void;
  onAssignSprint: (task: Task, sprintId: string) => void;
  currentProfile: Profile | null;
  canManageSprint: boolean;
  sprintLockMessage: string;
  focusedReviewTaskId?: string;
  onFocusedReviewTaskHandled?: () => void;
}) {
  const currentSprint = findCurrentSprint(data.sprints);
  const [selectedSprintId, setSelectedSprintId] = useState(currentSprint?.id || "");
  const [selectedReviewTaskId, setSelectedReviewTaskId] = useState("");
  const [scoreObjectionDraft, setScoreObjectionDraft] = useState("");
  const scrollToReviewSheet = useCallback(() => {
    window.requestAnimationFrame(() => {
      document.getElementById("accountable-review-sheet")?.scrollIntoView({ behavior: "smooth", block: "start" });
    });
  }, []);
  const selectReviewTask = useCallback((taskId: string) => {
    setSelectedReviewTaskId(taskId);
    scrollToReviewSheet();
  }, [scrollToReviewSheet]);
  useEffect(() => {
    if (!data.sprints.length) return;
    if (!selectedSprintId || !data.sprints.some((item) => item.id === selectedSprintId)) {
      const nextSprintId = findCurrentSprint(data.sprints)?.id || data.sprints[0]?.id || "";
      window.queueMicrotask(() => setSelectedSprintId(nextSprintId));
    }
  }, [data.sprints, selectedSprintId]);

  useEffect(() => {
    if (!focusedReviewTaskId) return;
    const focusedTask = data.tasks.find((task) => task.id === focusedReviewTaskId);
    if (!focusedTask) return;
    if (focusedTask.sprintId && focusedTask.sprintId !== selectedSprintId && data.sprints.some((sprint) => sprint.id === focusedTask.sprintId)) {
      window.queueMicrotask(() => setSelectedSprintId(focusedTask.sprintId));
      return;
    }
    window.queueMicrotask(() => {
      selectReviewTask(focusedReviewTaskId);
      onFocusedReviewTaskHandled?.();
    });
  }, [data.sprints, data.tasks, focusedReviewTaskId, onFocusedReviewTaskHandled, selectReviewTask, selectedSprintId]);

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
  } = buildSprintScoreViewModel({ data, selectedSprintId });
  const selectedReviewTask = reviewTasks.find((task) => task.id === selectedReviewTaskId) || reviewTasks[0];
  const openObjections = data.scoreObjections.filter((item) => item.sprintId === sprint?.id && item.status === "open");
  const sprintControlsDisabled = pending || !canManageSprint;
  const canReviewTask = (task: Task) => Boolean(currentProfile && (canManageSprint || task.reviewOwnerProfileId === currentProfile.id));
  const reviewOwnerName = (task: Task) => task.reviewOwnerProfileId
    ? data.profiles.find((profile) => profile.id === task.reviewOwnerProfileId)?.name || task.reviewOwnerProfileId
    : "Ohne Review Owner";
  const isSelfReview = (task: Task) => Boolean(task.reviewOwnerProfileId && (task.ownerId === task.reviewOwnerProfileId || task.owner === task.reviewOwnerProfileId));

  if (!sprint) {
    return (
      <section className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
        Noch kein Sprint angelegt. Nach der nächsten Migration erscheint hier die Sprint-Tabelle.
      </section>
    );
  }

  return (
    <div className="grid min-w-0 gap-4">
      <SprintControlsSummary
        data={data}
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
        sprintLockMessage={sprintLockMessage}
        openObjectionsCount={openObjections.length}
        onSelectedSprintChange={setSelectedSprintId}
        onUpdateSprint={onUpdateSprint}
        onLockSprint={onLockSprint}
      />

      <SprintFounderScoreTable
        sprint={sprint}
        scoreRows={scoreRows}
        pending={pending}
        onUpdateCommitment={onUpdateCommitment}
      />

      <SprintMeetingAttendanceSection
        data={data}
        meetings={meetings}
        pending={pending}
        currentProfile={currentProfile}
        canManageSprint={canManageSprint}
        onUpdateMeetingAttendance={onUpdateMeetingAttendance}
      />

      <SprintScoreObjections
        data={data}
        sprint={sprint}
        currentProfile={currentProfile}
        canManageSprint={canManageSprint}
        pending={pending}
        scoreObjectionDraft={scoreObjectionDraft}
        openObjectionsCount={openObjections.length}
        onScoreObjectionDraftChange={setScoreObjectionDraft}
        onCreateScoreObjection={onCreateScoreObjection}
        onReviewScoreObjection={onReviewScoreObjection}
      />

      <SprintTaskTables
        data={data}
        sprint={sprint}
        sprintTasks={sprintTasks}
        otherTasks={otherTasks}
        pending={pending}
        canReviewTask={canReviewTask}
        reviewOwnerName={reviewOwnerName}
        isSelfReview={isSelfReview}
        onOpen={onOpen}
        onRequestReview={onRequestReview}
        onChangeStatus={onChangeStatus}
        onAssignSprint={onAssignSprint}
        onSelectReviewTask={selectReviewTask}
      />

      <SprintReviewSheetSection
        selectedReviewTask={selectedReviewTask}
        reviewOwnerName={(task) => `${reviewOwnerName(task)}${isSelfReview(task) ? " · Self-Review" : ""}`}
        canReview={(task) => !sprint.scoreLocked && !task.scoreFinal && canReviewTask(task)}
        canReopen={(task) => !sprint.scoreLocked && task.scoreFinal && canReviewTask(task)}
        pending={pending}
        onReview={onReview}
        onReopen={onReopenReview}
      />
    </div>
  );
}
