import type { PlanningAppController } from "@/features/planning/hooks/use-planning-app-controller";
import { packageById, profileColor, statusOptionsForRole } from "@/features/planning/model/planning-app-model";
import { taskStatuses } from "@/lib/status";
import { GanttView } from "@/features/tasks/organisms/gantt-view";
import { TaskBoardView } from "@/features/tasks/organisms/task-board-view";
import { TaskStructureView } from "@/features/tasks/organisms/task-structure-view";
import { TaskTableView } from "@/features/tasks/organisms/task-table-view";

export function PlanningTaskViewRenderer({ controller }: { controller: PlanningAppController }) {
  const {
    canChangeTaskStatus,
    canManageTaskMeta,
    data,
    dragOverStatus,
    draggedTaskId,
    dropTaskOnStatus,
    endTaskDrag,
    expandedPackages,
    filtersAvailable,
    openTaskPanel,
    setAllPackageCollapse,
    setDragOverStatus,
    setTaskDialogDefaults,
    startTaskDrag,
    togglePackageCollapse,
    updateTask,
    view,
    visibleTasks,
  } = controller;

  if (!filtersAvailable) return null;

  return (
    <>
      {view === "board" && (
        <TaskBoardView
          statuses={taskStatuses}
          visibleTasks={visibleTasks}
          packages={data.packages}
          profiles={data.profiles}
          relations={data.taskRelations}
          allTasks={data.tasks}
          blockers={data.taskBlockers}
          draggedTaskId={draggedTaskId}
          dragOverStatus={dragOverStatus}
          canChangeTaskStatus={canChangeTaskStatus}
          statusOptionsForTask={(task) => statusOptionsForRole(task.status, canManageTaskMeta)}
          packageForTask={(task) => packageById(data.packages, task.packageId)}
          ownerColorForTask={(task) => profileColor(data.profiles.find((profile) => profile.id === task.assigneeId || profile.name === task.assignee))}
          onOpenTask={(task) => openTaskPanel(task.id)}
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
          visibleTasks={visibleTasks}
          relations={data.taskRelations}
          allTasks={data.tasks}
          blockers={data.taskBlockers}
          expandedPackages={expandedPackages}
          canChangeTaskStatus={canChangeTaskStatus}
          statusOptionsForTask={(task) => statusOptionsForRole(task.status, canManageTaskMeta)}
          ownerColorForTask={(task) => profileColor(data.profiles.find((profile) => profile.id === task.assigneeId || profile.name === task.assignee))}
          onOpenTask={(task) => openTaskPanel(task.id)}
          onUpdateTask={updateTask}
          onTogglePackage={togglePackageCollapse}
          onSetAllPackageCollapse={setAllPackageCollapse}
        />
      )}

      {view === "table" && (
        <TaskTableView
          visibleTasks={visibleTasks}
          profiles={data.profiles}
          relations={data.taskRelations}
          allTasks={data.tasks}
          blockers={data.taskBlockers}
          canChangeTaskStatus={canChangeTaskStatus}
          statusOptionsForTask={(task) => statusOptionsForRole(task.status, canManageTaskMeta)}
          onOpenTask={(task) => openTaskPanel(task.id)}
          onUpdateTask={updateTask}
        />
      )}

      {view === "gantt" && (
        <GanttView tasks={visibleTasks} packages={data.packages} sprints={data.sprints} relations={data.taskRelations} onOpen={(task) => openTaskPanel(task.id)} />
      )}
    </>
  );
}
