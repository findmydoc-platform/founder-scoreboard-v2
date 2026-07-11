import type { PlanningAppController } from "@/features/planning/hooks/use-planning-app-controller";
import { StatusGuardDialog } from "@/features/planning/organisms/status-guard-dialog";
import { InitiativeDialog } from "@/features/projects/organisms/initiative-dialog";
import { NewTaskDialog } from "@/features/tasks/organisms/new-task-dialog";
import { TaskDetailPanel } from "@/features/tasks/organisms/task-detail-panel";

export function PlanningOverlayLayer({ controller }: { controller: PlanningAppController }) {
  const {
    addTaskComment,
    addTaskRelation,
    closeTaskPanel,
    commentImportNotice,
    commentImportPendingTaskIds,
    createTask,
    data,
    deleteTask,
    importGitHubComments,
    initiativeDialogDefaults,
    isPending,
    openReviewSheet,
    removeTaskRelation,
    reportTaskBlocker,
    saveInitiative,
    selectedPackage,
    selectedTask,
    selectedTaskActivity,
    selectedTaskBlockers,
    selectedTaskComments,
    selectedTaskDetailError,
    selectedTaskDetailLoading,
    selectedTaskExternalComments,
    selectedTaskSubIssues,
    setInitiativeDialogDefaults,
    setStatusGuardNotice,
    setStatusGuardTaskId,
    setTaskDialogDefaults,
    statusGuardNotice,
    statusGuardTask,
    syncTaskToGitHub,
    taskDialogDefaults,
    updateTask,
    uploadTaskAttachment,
    currentProfile,
    source,
  } = controller;

  return (
    <>
      {statusGuardNotice && statusGuardTask && (
        <StatusGuardDialog
          task={statusGuardTask}
          notice={statusGuardNotice}
          onUpdate={updateTask}
          onClose={() => { setStatusGuardNotice(""); setStatusGuardTaskId(null); }}
        />
      )}

      {selectedTask && (
        <TaskDetailPanel
          key={selectedTask.id}
          task={selectedTask}
          pack={selectedPackage}
          comments={selectedTaskComments}
          externalComments={selectedTaskExternalComments}
          activities={selectedTaskActivity}
          detailDataError={selectedTaskDetailError}
          detailDataLoading={selectedTaskDetailLoading}
          commentImportNotice={commentImportNotice}
          blockers={selectedTaskBlockers}
          subIssues={selectedTaskSubIssues}
          teamProfiles={data.profiles}
          packages={data.packages}
          sprints={data.sprints}
          milestones={data.milestones}
          currentProfile={currentProfile}
          source={source}
          allTasks={data.tasks}
          relations={data.taskRelations}
          pending={isPending}
          error={controller.saveError}
          githubAppConnected={controller.githubAppConnected}
          commentImportPending={commentImportPendingTaskIds.has(selectedTask.id)}
          onClose={closeTaskPanel}
          onUpdate={(patch) => updateTask(selectedTask, patch)}
          onAddComment={(comment) => addTaskComment(selectedTask, comment)}
          onUploadAttachment={(file) => uploadTaskAttachment(selectedTask, file)}
          onImportGitHubComments={() => importGitHubComments(selectedTask)}
          onReportBlocker={(payload) => reportTaskBlocker(selectedTask, payload)}
          onCreateSubIssue={() => setTaskDialogDefaults({ taskType: "sub_issue", parentTaskId: selectedTask.id, milestoneId: selectedTask.milestoneId, packageId: selectedTask.packageId, assignee: selectedTask.assigneeId || selectedTask.assignee, status: "Offen" })}
          onSyncGitHub={(options) => syncTaskToGitHub(selectedTask, options)}
          onOpenReview={() => openReviewSheet(selectedTask)}
          onDelete={() => deleteTask(selectedTask)}
          onAddRelation={(payload) => addTaskRelation(selectedTask, payload)}
          onRemoveRelation={(relation) => removeTaskRelation(selectedTask, relation)}
        />
      )}
      {taskDialogDefaults && (
        <NewTaskDialog
          defaults={taskDialogDefaults}
          data={data}
          pending={isPending}
          onClose={() => setTaskDialogDefaults(null)}
          onCreate={createTask}
        />
      )}
      {initiativeDialogDefaults && (
        <InitiativeDialog
          defaults={initiativeDialogDefaults}
          data={data}
          pending={isPending}
          onClose={() => setInitiativeDialogDefaults(null)}
          onSave={saveInitiative}
        />
      )}
    </>
  );
}
