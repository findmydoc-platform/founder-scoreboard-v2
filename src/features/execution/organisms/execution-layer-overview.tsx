"use client";

import { useState } from "react";
import type { NewTaskDraft } from "@/features/tasks/organisms/new-task-dialog";
import { ExecutionMetricsStrip } from "@/features/execution/molecules/execution-metrics-strip";
import { ExecutionDecisionFollowups } from "@/features/execution/organisms/execution-decision-followups";
import { ExecutionFocusPanel } from "@/features/execution/organisms/execution-focus-panel";
import { ExecutionHygieneAlerts } from "@/features/execution/organisms/execution-hygiene-alerts";
import { ExecutionReviewQueue } from "@/features/execution/organisms/execution-review-queue";
import { buildExecutionLayerViewModel, type HygieneAlert, type HygieneAlertAreaFilter, type HygieneAlertSeverityFilter } from "@/features/execution/model/execution-layer-view-model";
import type { DecisionTaskLink, PlanningData, Profile, Task, TaskFocusItem } from "@/lib/types";

export function ExecutionLayerOverview({
  data,
  currentProfile,
  focusItems,
  hygieneAlerts,
  pending,
  onOpenTask,
  onSetFocus,
  onRemoveFocus,
  onLinkDecisionTask,
  onRemoveDecisionTaskLink,
  onCreateTask,
}: {
  data: PlanningData;
  currentProfile: Profile | null;
  focusItems: TaskFocusItem[];
  hygieneAlerts: HygieneAlert[];
  pending: boolean;
  onOpenTask: (task: Task) => void;
  onSetFocus: (task: Task, nextStep: string, status?: TaskFocusItem["status"]) => void;
  onRemoveFocus: (focusItem: TaskFocusItem) => void;
  onLinkDecisionTask: (decisionId: number, taskId: string, note: string) => void;
  onRemoveDecisionTaskLink: (link: DecisionTaskLink) => void;
  onCreateTask: (draft: Partial<NewTaskDraft>) => void;
}) {
  const [focusDrafts, setFocusDrafts] = useState<Record<string, string>>({});
  const [decisionTaskDrafts, setDecisionTaskDrafts] = useState<Record<number, string>>({});
  const [decisionNoteDrafts, setDecisionNoteDrafts] = useState<Record<number, string>>({});
  const [alertSeverityFilter, setAlertSeverityFilter] = useState<HygieneAlertSeverityFilter>("all");
  const [alertAreaFilter, setAlertAreaFilter] = useState<HygieneAlertAreaFilter>("all");
  const {
    taskById,
    isOperationalLead,
    openTasks,
    focusStatusCounts,
    endOfDayOpenItems,
    endOfDayCompletion,
    todayTeamFocusItems,
    focusHistoryByDate,
    focusHistoryDates,
    teamFocusCoverage,
    executionMetrics,
    myReviewTasks,
    teamReviewTasks,
    reviewTasksWithoutOwner,
    overdueReviewTasks,
    suggestedTasks,
    filteredAlerts,
    visibleAlerts,
    visibleProfiles,
  } = buildExecutionLayerViewModel({
    data,
    currentProfile,
    focusItems,
    hygieneAlerts,
    alertSeverityFilter,
    alertAreaFilter,
  });

  return (
    <div className="grid grid-cols-1 min-w-0 gap-5 xl:grid-cols-[minmax(0,1.2fr)_minmax(0,0.8fr)]">
      <ExecutionMetricsStrip
        isOperationalLead={isOperationalLead}
        executionMetrics={executionMetrics}
        teamFocusCoverage={teamFocusCoverage}
        focusItems={focusItems}
      />
      <ExecutionReviewQueue
        profiles={data.profiles}
        isOperationalLead={isOperationalLead}
        myReviewTasks={myReviewTasks}
        teamReviewTasks={teamReviewTasks}
        reviewTasksWithoutOwner={reviewTasksWithoutOwner}
        overdueReviewTasks={overdueReviewTasks}
        onOpenTask={onOpenTask}
      />
      <ExecutionFocusPanel
        currentProfile={currentProfile}
        isOperationalLead={isOperationalLead}
        focusItems={focusItems}
        focusDrafts={focusDrafts}
        setFocusDrafts={setFocusDrafts}
        taskById={taskById}
        focusStatusCounts={focusStatusCounts}
        endOfDayOpenItems={endOfDayOpenItems}
        endOfDayCompletion={endOfDayCompletion}
        todayTeamFocusItems={todayTeamFocusItems}
        focusHistoryByDate={focusHistoryByDate}
        focusHistoryDates={focusHistoryDates}
        visibleProfiles={visibleProfiles}
        suggestedTasks={suggestedTasks}
        allTasks={data.tasks}
        taskRelations={data.taskRelations}
        pending={pending}
        onOpenTask={onOpenTask}
        onSetFocus={onSetFocus}
        onRemoveFocus={onRemoveFocus}
      />
      <div className="grid gap-5">
        <ExecutionHygieneAlerts
          alertSeverityFilter={alertSeverityFilter}
          alertAreaFilter={alertAreaFilter}
          filteredAlerts={filteredAlerts}
          hygieneAlerts={hygieneAlerts}
          visibleAlerts={visibleAlerts}
          taskById={taskById}
          allTasks={data.tasks}
          taskRelations={data.taskRelations}
          focusItems={focusItems}
          pending={pending}
          onSeverityFilterChange={setAlertSeverityFilter}
          onAreaFilterChange={setAlertAreaFilter}
          onOpenTask={onOpenTask}
          onSetFocus={onSetFocus}
        />
        <ExecutionDecisionFollowups
          data={data}
          taskById={taskById}
          openTasks={openTasks}
          executionMetrics={executionMetrics}
          decisionTaskDrafts={decisionTaskDrafts}
          decisionNoteDrafts={decisionNoteDrafts}
          pending={pending}
          onDecisionTaskDraftsChange={setDecisionTaskDrafts}
          onDecisionNoteDraftsChange={setDecisionNoteDrafts}
          onOpenTask={onOpenTask}
          onCreateTask={onCreateTask}
          onLinkDecisionTask={onLinkDecisionTask}
          onRemoveDecisionTaskLink={onRemoveDecisionTaskLink}
        />
      </div>
    </div>
  );
}
