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
import { TaskSaveNotice } from "@/features/tasks/molecules/task-save-notice";
import { TaskBoardView } from "@/features/tasks/organisms/task-board-view";
import { UiButton, UiNotice } from "@/shared/atoms/ui-primitives";

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
    canChangeTaskStatus: mayChangeTaskStatus,
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
    updateBoardTask,
    beginBoardTaskEdit,
    boardTaskEditConflict,
    resaveBoardTask,
    reloadBoardTaskConflict,
    view,
    viewerOpenSubIssueIdsByDeliverableId,
    visibleTasks,
  } = controller;

  const canChangeTaskStatus = (task: (typeof data.tasks)[number]) => mayChangeTaskStatus(task) && controller.planningState.taskDetail(task.id).saveStatus !== "unconfirmed";

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
      {data.tasks.map(task => <TaskSaveNotice key={task.id} taskTitle={controller.planningState.taskDetail(task.id).task ? task.title : "Aufgabe"} saves={controller.planningState.taskSaves(task.id)} onCheck={() => controller.planningState.checkTaskSave(task.id)} />)}
      {boardTaskEditConflict ? <UiNotice tone="info" role="alert" className="mb-4">
        <p>Die Aufgabe wurde zwischenzeitlich geändert. Deine abgesendete Änderung bleibt erhalten.</p>
        <p className="mt-2">Aktueller Serverstand: {boardTaskEditConflict.serverTask?.title || "Noch nicht verfügbar"}</p>
        <UiButton size="lg" type="button" disabled={!boardTaskEditConflict.canResave} onClick={() => { void resaveBoardTask(); }}>Änderung erneut speichern</UiButton>
        {!boardTaskEditConflict.canResave ? <UiButton size="lg" type="button" onClick={() => { void reloadBoardTaskConflict(); }}>Aktuellen Stand erneut laden</UiButton> : null}
      </UiNotice> : null}
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
            onBeginTaskEdit={beginBoardTaskEdit}
            onChangeTaskStatus={(task, status) => { void updateBoardTask(task, { status }); }}
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
              onBeginTaskEdit={beginBoardTaskEdit}
              onUpdateTask={updateBoardTask}
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
