"use client";

import { useEffect, useRef, useState } from "react";
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
import { buildSprintWorkspaceViewModel } from "@/features/sprint/model/sprint-score-view-model";
import type { SprintPlanningOptions } from "@/features/sprint/model/sprint-planning-options";
import { sprintWorkspaceModelToPlanningShellState } from "@/features/sprint/model/sprint-planning-shell-projection";
import type { PlanningState } from "@/features/planning/model/planning-state";
import { UiButton, UiNotice, UiPanel } from "@/shared/atoms/ui-primitives";
import { findCurrentSprint } from "@/lib/planning-schedule";
import type { Profile, Task, TaskStatus } from "@/lib/types";

export function SprintScoreTableOverview({
  planningState,
  pending,
  onOpenTask,
  onRequestReview,
  onChangeStatus,
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
  onAssignSprint: (task: Task, sprintId: string) => void;
  sprintPlanningOptions: SprintPlanningOptions;
  plannedSprintCount: number;
  onUpdateSprintPlanning: (options: SprintPlanningOptions) => void;
  currentProfile: Profile | null;
  canManageSprint: boolean;
  reviewObjectionWindowHours: number;
}) {
  const sprintView = planningState.sprintWorkspace();
  const selectedScope = planningState.selectedSprintScope();
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
    unassignedTasks,
    reviewTasks,
    meetings,
    finalScores,
    openScores,
    sprintHasTasks,
    sprintIsCurrent,
  } = buildSprintWorkspaceViewModel({ data: sprintData, selectedSprintId });
  const scopedPage = selectedScope?.page && selectedScope.page.sprintId === sprint?.id ? selectedScope.page : undefined;
  const membershipCurrent = !selectedScope || Boolean(scopedPage);
  const openObjections = sprintData.scoreObjections.filter((item) => item.sprintId === sprint?.id && item.status === "open");
  const provisionalIds = planningState.sprintPlan().provisionalSprintIds;
  const assessmentId = sprintView.readStatus !== "forbidden" && sprint && !provisionalIds.includes(sprint.id) ? sprint.id : "";
  const assessment = planningState.sprintAssessment(assessmentId);
  const assessmentDemand = useRef<AbortController | null>(null);
  const assessmentRegion = useRef<HTMLElement>(null);
  useEffect(() => {
    if (!assessmentId) return;
    let timer: number | undefined;
    function stop() {
      assessmentDemand.current?.abort();
      assessmentDemand.current = null;
      if (timer !== undefined) window.clearInterval(timer);
      timer = undefined;
    }
    function observe() {
      const signal = assessmentDemand.current?.signal;
      if (signal) void planningState.checkSprintAssessment(assessmentId, { signal });
    }
    function visible() {
      if (document.visibilityState === "hidden") { stop(); return; }
      const started = !assessmentDemand.current;
      assessmentDemand.current ??= new AbortController();
      const signal = assessmentDemand.current.signal;
      const view = planningState.sprintAssessment(assessmentId);
      if (view.readStatus === "current") observe();
      else if (started && view.readStatus === "not-loaded") void planningState.loadSprintAssessment(assessmentId, { signal });
      timer ??= window.setInterval(observe, 60_000);
    }
    queueMicrotask(() => { if (mounted) visible(); });
    document.addEventListener("visibilitychange", visible);
    window.addEventListener("online", visible);
    let mounted = true;
    return () => {
      mounted = false;
      stop();
      document.removeEventListener("visibilitychange", visible);
      window.removeEventListener("online", visible);
    };
  }, [assessmentId, planningState]);
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
        key={`summary:${sprint.id}`}
        data={sprintData}
        sprint={sprint}
        currentSprint={currentSprint}
        sprintTasks={sprintTasks}
        reviewTasksCount={reviewTasks.length}
        finalScores={finalScores}
        openScores={openScores}
        tasksKnown={membershipCurrent}
        sprintTaskCounts={scopedPage?.sprintTaskCounts}
        unassignedTasksCount={selectedScope ? scopedPage?.unassignedTotal ?? null : unassignedTasks.length}
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

      <section ref={assessmentRegion} aria-label="Sprint-Bewertung" aria-busy={assessment.readStatus === "loading"}>
        {assessment.readStatus === "current" ? <SprintFounderScoreTable
          key={sprint.id}
          sprint={{ ...sprint, scoreLocked: assessment.scoreLocked }}
          scoreRows={assessment.scoreRows}
          pending={sprintPending}
          planningState={planningState}
        /> : <UiPanel className="space-y-3">
          <h2 className="font-semibold text-slate-950">FounderOps Score v2.1</h2>
          <UiNotice role="status" tone="info">
            {assessment.readStatus === "forbidden" ? "Keine Berechtigung für diese Sprint-Bewertung."
              : assessment.readStatus === "stale" ? "Die Grundlage der Sprint-Bewertung hat sich geändert."
              : assessment.readStatus === "unavailable" ? "Die Sprint-Bewertung konnte nicht vollständig geladen werden."
              : assessmentId ? "Die Grundlage der Sprint-Bewertung wird geladen."
              : "Die Sprint-Bewertung ist verfügbar, sobald der Sprint bestätigt ist."}
          </UiNotice>
          {assessmentId && ["stale", "unavailable", "forbidden"].includes(assessment.readStatus) && <UiButton data-assessment-retry size="lg" onClick={async event => {
            const trigger = event.currentTarget;
            const signal = assessmentDemand.current?.signal;
            if (!signal) return;
            const ready = await planningState.loadSprintAssessment(assessmentId, { refresh: true, signal });
            window.requestAnimationFrame(() => {
              if (signal.aborted || (document.activeElement !== trigger && document.activeElement !== document.body)) return;
              const selector = ready ? '[aria-label="Founder Score durchsuchen"]' : "[data-assessment-retry]";
              assessmentRegion.current?.querySelector<HTMLElement>(selector)?.focus();
            });
          }}>Sprint-Bewertung neu laden</UiButton>}
        </UiPanel>}
      </section>

      <SprintMeetingAttendanceSection
        data={sprintData}
        meetings={meetings}
        pending={sprintPending}
        currentProfile={currentProfile}
        canManageSprint={canManageSprint}
        planningState={planningState}
      />

      <SprintScoreObjections
        key={`objections:${sprint.id}`}
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
        planningState={planningState}
        scopedSelected={Boolean(selectedScope)}
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
