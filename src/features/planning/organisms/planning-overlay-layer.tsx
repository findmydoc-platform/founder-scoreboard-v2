import type { PlanningAppController } from "@/features/planning/hooks/use-planning-app-controller";
import { StatusGuardDialog } from "@/features/planning/organisms/status-guard-dialog";
import { FeedbackDialog } from "@/features/settings/molecules/feedback-dialog";
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
    createFeedback,
    createTask,
    data,
    deleteTask,
    feedbackDialogOpen,
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
    selectedTaskExternalComments,
    selectedTaskSubIssues,
    setFeedbackDialogOpen,
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
    canChangeTaskStatus,
    canManageTaskMeta,
    currentProfile,
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
          commentImportNotice={commentImportNotice}
          blockers={selectedTaskBlockers}
          subIssues={selectedTaskSubIssues}
          teamProfiles={data.profiles}
          packages={data.packages}
          sprints={data.sprints}
          milestones={data.milestones}
          focusItems={data.taskFocusItems}
          canManageTaskMeta={canManageTaskMeta}
          canManageReviewOwner={currentProfile?.platformRole === "ceo"}
          canChangeTaskStatus={canChangeTaskStatus(selectedTask)}
          allTasks={data.tasks}
          relations={data.taskRelations}
          pending={isPending}
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
      {feedbackDialogOpen && (
        <FeedbackDialog
          pending={isPending}
          onClose={() => setFeedbackDialogOpen(false)}
          onSubmit={createFeedback}
        />
      )}
    </>
  );
}
