import { useMemo } from "react";
import type { PlanningAppController } from "@/features/planning/hooks/use-planning-app-controller";
import { isTaskPlanningActive } from "@/features/planning/model/approval-domain";
import { profileColor, statusOptionsForRole } from "@/features/planning/model/planning-app-model";
import { strategicPlanningStatuses } from "@/features/tasks/model/planning-item-capabilities";
import { normalizeStatus, taskStatuses } from "@/lib/status";
import { GanttView } from "@/features/tasks/organisms/gantt-view";
import { TaskBoardView } from "@/features/tasks/organisms/task-board-view";
import { TaskStructureView } from "@/features/tasks/organisms/task-structure-view";
import { TaskTableView } from "@/features/tasks/organisms/task-table-view";
import { UiNotice } from "@/shared/atoms/ui-primitives";

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
    expandedPackages,
    filters,
    filtersAvailable,
    openTaskPanel,
    planningLevel,
    planningParentFilterId,
    selectedTaskId,
    setAllPackageCollapse,
    setDragOverStatus,
    setFilters,
    setTaskDialogDefaults,
    startTaskDrag,
    togglePackageCollapse,
    updateTask,
    view,
    visibleTasks,
  } = controller;

  // Table, Gantt and structure stay deliberately delivery-only in V1.  The
  // level selector above is the sole strategic planning surface here.
  const planningBoardTasks = visibleTasks.filter((task) => task.taskType === "deliverable" && isTaskPlanningActive(task));
  const parentFilterId = planningLevel === "deliverable"
    ? filters.packageId === "Alle" ? "all" : filters.packageId
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
            ownerColorForTask={(task) => profileColor(data.profiles.find((profile) => profile.id === task.assigneeId || profile.name === task.assignee))}
            onOpenTask={openTaskPanel}
            onCreateTask={setTaskDialogDefaults}
            onChangeTaskStatus={(task, status) => updateTask(task, { status })}
            onDragOverStatus={setDragOverStatus}
            onDropTask={dropTaskOnStatus}
            onDragStart={startTaskDrag}
            onDragEnd={endTaskDrag}
            statusOptionsForTask={statusOptionsForTask}
            showParentContext={parentFilterId === "all" && planningLevel !== "epic"}
          />
        </div>
      )}

      {view === "structure" && (
        <TaskStructureView
          packages={data.packages}
          visibleTasks={planningBoardTasks}
          relations={data.taskRelations}
          allTasks={data.tasks}
          blockers={data.taskBlockers}
          expandedPackages={expandedPackages}
          ownerColorForTask={(task) => profileColor(data.profiles.find((profile) => profile.id === task.assigneeId || profile.name === task.assignee))}
          onOpenTask={openTaskPanel}
          onTogglePackage={togglePackageCollapse}
          onSetAllPackageCollapse={setAllPackageCollapse}
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
        <GanttView tasks={planningBoardTasks} packages={data.packages} sprints={data.sprints} relations={data.taskRelations} onOpenTask={openTaskPanel} />
      )}
    </>
  );
}
