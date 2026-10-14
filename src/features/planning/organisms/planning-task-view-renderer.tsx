"use client";

import dynamic from "next/dynamic";
import { useMemo } from "react";
import type { PlanningAppController } from "@/features/planning/hooks/use-planning-app-controller";
import { isTaskPlanningActive } from "@/features/planning/model/approval-domain";
import { initiativePlanningItems, statusOptionsForRole } from "@/features/planning/model/planning-app-model";
import { PlanningViewLoadBoundary } from "@/features/planning/molecules/planning-view-load-boundary";
import { taskAssigneeProfile } from "@/features/tasks/model/task-card-presentation";
import { strategicPlanningStatuses } from "@/features/tasks/model/planning-item-capabilities";
import { normalizeStatus, taskStatuses } from "@/lib/status";
import { TaskBoardView } from "@/features/tasks/organisms/task-board-view";
import { UiNotice } from "@/shared/atoms/ui-primitives";

function TaskViewLoading({ label }: { label: string }) {
  return <UiNotice role="status" tone="info">{label} wird geladen …</UiNotice>;
}

const TaskStructureView = dynamic(
  () => import("@/features/tasks/organisms/task-structure-view").then((module) => module.TaskStructureView),
  { loading: () => <TaskViewLoading label="Struktur" /> },
);
const TaskTableView = dynamic(
  () => import("@/features/tasks/organisms/task-table-view").then((module) => module.TaskTableView),
  { loading: () => <TaskViewLoading label="Tabelle" /> },
);
const GanttView = dynamic(
  () => import("@/features/tasks/organisms/gantt-view").then((module) => module.GanttView),
  { loading: () => <TaskViewLoading label="Gantt" /> },
);

export function PlanningTaskViewRenderer({ controller }: { controller: PlanningAppController }) {
  const {
    canChangeTaskStatus,
    canManageFinalTaskStatus,
    canManageTaskMeta,
    data,
    dragOverStatus,
    draggedTaskId,
    dropTaskOnStatus,
    endTaskDrag,
    expandedInitiatives,
    filters,
    filtersAvailable,
    openTaskPanel,
    planningLevel,
    planningParentFilterId,
    selectedTaskId,
    setAllInitiativeCollapse,
    setDragOverStatus,
    setFilters,
    setTaskDialogDefaults,
    setView,
    startTaskDrag,
    toggleInitiativeCollapse,
    updateTask,
    view,
    viewerOpenSubIssueIdsByDeliverableId,
    visibleTasks,
  } = controller;

  // Table, Gantt and structure stay deliberately delivery-only in V1.  The
  // level selector above is the sole strategic planning surface here.
  const planningBoardTasks = visibleTasks.filter((task) => task.taskType === "deliverable" && isTaskPlanningActive(task));
  const parentFilterId = planningLevel === "deliverable"
    ? filters.initiativeId === "Alle" ? "all" : filters.initiativeId
    : planningParentFilterId;
  const boardTasks = useMemo(() => {
    return visibleTasks.filter((task) => (
      task.taskType === planningLevel
      && (parentFilterId === "all" || task.parentTaskId === parentFilterId)
    ));
  }, [parentFilterId, planningLevel, visibleTasks]);
  const boardStatuses = planningLevel === "deliverable" ? taskStatuses : strategicPlanningStatuses;
  const deliveryOnlyViewLabel = view === "structure" ? "Struktur" : view === "table" ? "Tabelle" : view === "gantt" ? "Gantt" : "";
  const statusOptionsForTask = (task: (typeof data.tasks)[number]) => {
    if (task.taskType !== "epic" && task.taskType !== "initiative") {
      return statusOptionsForRole(task.status, canManageTaskMeta, canManageFinalTaskStatus);
    }
    if (canManageFinalTaskStatus) return strategicPlanningStatuses;
    if (normalizeStatus(task.status) === "Erledigt") return strategicPlanningStatuses.filter((status) => status === "Erledigt");
    return strategicPlanningStatuses.filter((status) => status !== "Erledigt");
  };

  if (!filtersAvailable) return null;

  return (
    <>
      {deliveryOnlyViewLabel ? (
        <UiNotice className="mb-4" role="status" tone="info">
          {deliveryOnlyViewLabel} zeigt in dieser Version ausschließlich Deliverables. Deine gewählte Board-Ebene bleibt erhalten.
        </UiNotice>
      ) : null}
      {view === "board" && (
        <div className="grid gap-4">
          <TaskBoardView
            statuses={boardStatuses}
            itemType={planningLevel}
            visibleTasks={boardTasks}
            relations={data.taskRelations}
            allTasks={data.tasks}
            blockers={data.taskBlockers}
            draggedTaskId={draggedTaskId}
            selectedTaskId={selectedTaskId}
            dragOverStatus={dragOverStatus}
            canChangeTaskStatus={canChangeTaskStatus}
            assigneeProfileForTask={(task) => taskAssigneeProfile(task, data.profiles)}
            onOpenTask={openTaskPanel}
            onCreateTask={setTaskDialogDefaults}
            onChangeTaskStatus={(task, status) => updateTask(task, { status })}
            onDragOverStatus={setDragOverStatus}
            onDropTask={dropTaskOnStatus}
            onDragStart={startTaskDrag}
            onDragEnd={endTaskDrag}
            statusOptionsForTask={statusOptionsForTask}
            viewerOpenSubIssueIdsByDeliverableId={viewerOpenSubIssueIdsByDeliverableId}
            showParentContext={parentFilterId === "all" && planningLevel !== "epic"}
          />
        </div>
      )}

      {view !== "board" && (
        <PlanningViewLoadBoundary key={view} onReturnToBoard={() => setView("board")}>
          {view === "structure" && (
            <TaskStructureView
              initiatives={initiativePlanningItems(data.tasks)}
              visibleTasks={planningBoardTasks}
              relations={data.taskRelations}
              allTasks={data.tasks}
              blockers={data.taskBlockers}
              expandedInitiatives={expandedInitiatives}
              assigneeProfileForTask={(task) => taskAssigneeProfile(task, data.profiles)}
              onOpenTask={openTaskPanel}
              onToggleInitiative={toggleInitiativeCollapse}
              onSetAllInitiativeCollapse={setAllInitiativeCollapse}
            />
          )}

          {view === "table" && (
            <TaskTableView
              visibleTasks={planningBoardTasks}
              profiles={data.profiles}
              sprints={data.sprints}
              relations={data.taskRelations}
              allTasks={data.tasks}
              blockers={data.taskBlockers}
              filters={filters}
              canChangeTaskStatus={canChangeTaskStatus}
              statusOptionsForTask={statusOptionsForTask}
              onOpenTask={openTaskPanel}
              onUpdateTask={updateTask}
              onFiltersChange={setFilters}
            />
          )}

          {view === "gantt" && (
            <GanttView tasks={planningBoardTasks} items={data.tasks} sprints={data.sprints} relations={data.taskRelations} onOpenTask={openTaskPanel} />
          )}
        </PlanningViewLoadBoundary>
      )}
    </>
  );
}
