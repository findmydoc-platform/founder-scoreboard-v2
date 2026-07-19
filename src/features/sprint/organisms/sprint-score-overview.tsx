"use client";

import { useEffect, useState } from "react";
import { SprintControlsSummary } from "@/features/sprint/molecules/sprint-controls-summary";
import { SprintMeetingAttendanceSection } from "@/features/sprint/molecules/sprint-meeting-attendance-section";
import { SprintPlanningSection } from "@/features/sprint/molecules/sprint-planning-section";
import { SprintFounderScoreTable } from "@/features/sprint/organisms/sprint-founder-score-table";
import { SprintScoreObjections } from "@/features/sprint/organisms/sprint-score-objections";
import { SprintTaskTables } from "@/features/sprint/organisms/sprint-task-tables";
import { buildSprintScoreViewModel } from "@/features/sprint/model/sprint-score-view-model";
import type { SprintPlanningOptions } from "@/features/sprint/model/sprint-planning-options";
import { findCurrentSprint } from "@/lib/planning-schedule";
import type { Meeting, MeetingAttendance, PlanningData, Profile, ScoreObjectionResolutionInput, Sprint, SprintCommitment, Task, TaskStatus } from "@/lib/types";

export function SprintScoreTableOverview({
  data,
  pending,
  onOpenTask,
  onRequestReview,
  onChangeStatus,
  onLockSprint,
  onUpdateSprint,
  onUpdateCommitment,
  onUpdateMeetingAttendance,
  onCreateScoreObjection,
  onReviewScoreObjection,
  onAssignSprint,
  sprintPlanningOptions,
  plannedSprintCount,
  onUpdateSprintPlanning,
  onCreateSprintPlan,
  currentProfile,
  canManageSprint,
  sprintLockMessage,
}: {
  data: PlanningData;
  pending: boolean;
  onOpenTask: (taskId: string) => void;
  onRequestReview: (task: Task) => void;
  onChangeStatus: (task: Task, status: TaskStatus) => void;
  onLockSprint: (sprintId: string) => void;
  onUpdateSprint: (sprint: Sprint, patch: Partial<Sprint>) => void;
  onUpdateCommitment: (commitment: SprintCommitment) => void;
  onUpdateMeetingAttendance: (meeting: Meeting, attendance: MeetingAttendance) => void;
  onCreateScoreObjection: (sprint: Sprint, comment: string) => void;
  onReviewScoreObjection: (sprint: Sprint, objectionId: number, input: ScoreObjectionResolutionInput) => void;
  onAssignSprint: (task: Task, sprintId: string) => void;
  sprintPlanningOptions: SprintPlanningOptions;
  plannedSprintCount: number;
  onUpdateSprintPlanning: (options: SprintPlanningOptions) => void;
  onCreateSprintPlan: (options: SprintPlanningOptions) => void;
  currentProfile: Profile | null;
  canManageSprint: boolean;
  sprintLockMessage: string;
}) {
  const currentSprint = findCurrentSprint(data.sprints);
  const [selectedSprintId, setSelectedSprintId] = useState(currentSprint?.id || "");
  const [scoreObjectionDraft, setScoreObjectionDraft] = useState("");
  useEffect(() => {
    if (!data.sprints.length) return;
    if (!selectedSprintId || !data.sprints.some((item) => item.id === selectedSprintId)) {
      const nextSprintId = findCurrentSprint(data.sprints)?.id || data.sprints[0]?.id || "";
      window.queueMicrotask(() => setSelectedSprintId(nextSprintId));
    }
  }, [data.sprints, selectedSprintId]);

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
  const openObjections = data.scoreObjections.filter((item) => item.sprintId === sprint?.id && item.status === "open");
  const sprintControlsDisabled = pending || !canManageSprint;
  const reviewOwnerName = (task: Task) => task.reviewOwnerProfileId
    ? data.profiles.find((profile) => profile.id === task.reviewOwnerProfileId)?.name || task.reviewOwnerProfileId
    : "Ohne Review Owner";
  const isSelfReview = (task: Task) => Boolean(task.reviewOwnerProfileId && (task.assigneeId === task.reviewOwnerProfileId || task.assignee === task.reviewOwnerProfileId));

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
        canFinalizeSprintScore={currentProfile?.platformRole === "ceo"}
        sprintLockMessage={sprintLockMessage}
        openObjectionsCount={openObjections.length}
        onSelectedSprintChange={setSelectedSprintId}
        onUpdateSprint={onUpdateSprint}
        onLockSprint={onLockSprint}
      />

      <SprintPlanningSection
        disabled={!canManageSprint}
        pending={pending}
        sprintPlanningOptions={sprintPlanningOptions}
        plannedSprintCount={plannedSprintCount}
        onUpdateSprintPlanning={onUpdateSprintPlanning}
        onCreateSprintPlan={onCreateSprintPlan}
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
        pending={pending}
        scoreObjectionDraft={scoreObjectionDraft}
        openObjectionsCount={openObjections.length}
        scores={scoreRows.map((row) => row.v21Score)}
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
        canManageFinalTaskStatus={currentProfile?.platformRole === "ceo"}
        reviewOwnerName={reviewOwnerName}
        isSelfReview={isSelfReview}
        onOpenTask={onOpenTask}
        onRequestReview={onRequestReview}
        onChangeStatus={onChangeStatus}
        onAssignSprint={onAssignSprint}
        onOpenReviewTask={onOpenTask}
      />
    </div>
  );
}
