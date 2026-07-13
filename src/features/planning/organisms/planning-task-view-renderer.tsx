import type { PlanningAppController } from "@/features/planning/hooks/use-planning-app-controller";
import { isTaskPlanningActive } from "@/features/planning/model/approval-domain";
import { packageById, profileColor, statusOptionsForRole } from "@/features/planning/model/planning-app-model";
import { taskStatuses } from "@/lib/status";
import { GanttView } from "@/features/tasks/organisms/gantt-view";
import { TaskBoardView } from "@/features/tasks/organisms/task-board-view";
import { TaskStructureView } from "@/features/tasks/organisms/task-structure-view";
import { TaskTableView } from "@/features/tasks/organisms/task-table-view";

const planningBoardStatuses = taskStatuses;

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

  if (!filtersAvailable) return null;

  const planningBoardTasks = visibleTasks.filter(isTaskPlanningActive);

  return (
    <>
      {view === "board" && (
        <TaskBoardView
          statuses={planningBoardStatuses}
          visibleTasks={planningBoardTasks}
          packages={data.packages}
          profiles={data.profiles}
          relations={data.taskRelations}
          allTasks={data.tasks}
          blockers={data.taskBlockers}
          draggedTaskId={draggedTaskId}
          selectedTaskId={selectedTaskId}
          dragOverStatus={dragOverStatus}
          canChangeTaskStatus={canChangeTaskStatus}
          statusOptionsForTask={(task) => statusOptionsForRole(task.status, canManageTaskMeta, canManageFinalTaskStatus)}
          packageForTask={(task) => packageById(data.packages, task.packageId)}
          ownerColorForTask={(task) => profileColor(data.profiles.find((profile) => profile.id === task.assigneeId || profile.name === task.assignee))}
          onOpenTask={openTaskPanel}
          onCreateTask={setTaskDialogDefaults}
          onUpdateTask={updateTask}
          onDragOverStatus={setDragOverStatus}
          onDropTask={dropTaskOnStatus}
          onDragStart={startTaskDrag}
          onDragEnd={endTaskDrag}
        />
      )}

      {view === "structure" && (
        <TaskStructureView
          packages={data.packages}
          visibleTasks={planningBoardTasks}
          relations={data.taskRelations}
          allTasks={data.tasks}
          blockers={data.taskBlockers}
          expandedPackages={expandedPackages}
          canChangeTaskStatus={canChangeTaskStatus}
          statusOptionsForTask={(task) => statusOptionsForRole(task.status, canManageTaskMeta, canManageFinalTaskStatus)}
          ownerColorForTask={(task) => profileColor(data.profiles.find((profile) => profile.id === task.assigneeId || profile.name === task.assignee))}
          onOpenTask={openTaskPanel}
          onUpdateTask={updateTask}
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
          statusOptionsForTask={(task) => statusOptionsForRole(task.status, canManageTaskMeta, canManageFinalTaskStatus)}
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
