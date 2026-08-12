"use client";

import { useEffect, useReducer, useState } from "react";
import { SprintControlsSummary } from "@/features/sprint/molecules/sprint-controls-summary";
import { SprintMeetingAttendanceSection } from "@/features/sprint/molecules/sprint-meeting-attendance-section";
import { SprintPlanningSection } from "@/features/sprint/molecules/sprint-planning-section";
import { SprintFounderScoreTable } from "@/features/sprint/organisms/sprint-founder-score-table";
import { SprintScoreObjections } from "@/features/sprint/organisms/sprint-score-objections";
import { SprintTaskTables } from "@/features/sprint/organisms/sprint-task-tables";
import { buildSprintScoreViewModel } from "@/features/sprint/model/sprint-score-view-model";
import type { SprintPlanningOptions } from "@/features/sprint/model/sprint-planning-options";
import { sprintWorkspaceModelToPlanningData } from "@/features/sprint/model/sprint-planning-data-adapter";
import { sprintWorkspaceReducer, type SprintWorkspaceModel } from "@/features/sprint/model/sprint-read-model";
import { findCurrentSprint } from "@/lib/planning-schedule";
import type { Meeting, MeetingAttendance, PlanningData, Profile, ScoreObjectionResolutionInput, Sprint, SprintCommitment, Task, TaskStatus } from "@/lib/types";

export function SprintScoreTableOverview({
  initialModel,
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
  initialModel: SprintWorkspaceModel;
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
  const [model, dispatch] = useReducer(sprintWorkspaceReducer, initialModel);
  useEffect(() => {
    dispatch({
      type: "modelLoaded",
      model: {
        ...initialModel,
        project: data.project,
        people: data.profiles,
        items: data.tasks,
        sprints: data.sprints,
        commitments: data.sprintCommitments,
        scores: data.founderSprintScores,
        strikeStates: data.founderStrikeStates,
        strikeEvents: data.strikeEvents,
        objections: data.scoreObjections,
        meetings: data.meetings,
        attendance: data.meetingAttendance,
      },
    });
  }, [data, initialModel]);
  const sprintData = sprintWorkspaceModelToPlanningData(model);
  const currentSprint = findCurrentSprint(sprintData.sprints);
  const [selectedSprintId, setSelectedSprintId] = useState(currentSprint?.id || "");
  const [scoreObjectionDraft, setScoreObjectionDraft] = useState("");
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
  } = buildSprintScoreViewModel({ data: sprintData, selectedSprintId });
  const openObjections = sprintData.scoreObjections.filter((item) => item.sprintId === sprint?.id && item.status === "open");
  const sprintControlsDisabled = pending || !canManageSprint;
  const reviewOwnerName = (task: Task) => task.reviewOwnerProfileId
    ? sprintData.profiles.find((profile) => profile.id === task.reviewOwnerProfileId)?.name || task.reviewOwnerProfileId
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
        canFinalizeSprintScore={currentProfile?.platformRole === "ceo"}
        sprintLockMessage={sprintLockMessage}
        openObjectionsCount={openObjections.length}
        onSelectedSprintChange={setSelectedSprintId}
        onUpdateSprint={(value, patch) => {
          dispatch({ type: "sprintPatched", sprintId: value.id, patch });
          onUpdateSprint(value, patch);
        }}
        onLockSprint={(sprintId) => {
          dispatch({ type: "sprintLocked", sprintId });
          onLockSprint(sprintId);
        }}
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
        onUpdateCommitment={(commitment) => {
          dispatch({ type: "commitmentUpserted", commitment });
          onUpdateCommitment(commitment);
        }}
      />

      <SprintMeetingAttendanceSection
        data={sprintData}
        meetings={meetings}
        pending={pending}
        currentProfile={currentProfile}
        canManageSprint={canManageSprint}
        onUpdateMeetingAttendance={(meeting, attendance) => {
          dispatch({ type: "attendanceUpserted", attendance });
          onUpdateMeetingAttendance(meeting, attendance);
        }}
      />

      <SprintScoreObjections
        data={sprintData}
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
        data={sprintData}
        sprint={sprint}
        sprintTasks={sprintTasks}
        otherTasks={otherTasks}
        pending={pending}
        canManageFinalTaskStatus={currentProfile?.platformRole === "ceo"}
        reviewOwnerName={reviewOwnerName}
        isSelfReview={isSelfReview}
        onOpenTask={onOpenTask}
        onRequestReview={(task) => {
          dispatch({ type: "itemPatched", itemId: task.id, patch: { status: "Review", reviewStatus: "requested", scoreFinal: false } });
          onRequestReview(task);
        }}
        onChangeStatus={(task, status) => {
          dispatch({ type: "itemPatched", itemId: task.id, patch: { status } });
          onChangeStatus(task, status);
        }}
        onAssignSprint={(task, sprintId) => {
          dispatch({ type: "itemPatched", itemId: task.id, patch: { sprintId } });
          onAssignSprint(task, sprintId);
        }}
        onOpenReviewTask={onOpenTask}
      />
    </div>
  );
}
