"use client";

import dynamic from "next/dynamic";
import type { PlanningAppController } from "@/features/planning/hooks/use-planning-app-controller";

const StatusGuardDialog = dynamic(() =>
  import("@/features/planning/organisms/status-guard-dialog").then((module) => module.StatusGuardDialog)
);
const InitiativeDialog = dynamic(() =>
  import("@/features/projects/organisms/initiative-dialog").then((module) => module.InitiativeDialog)
);
const NewTaskDialog = dynamic(() =>
  import("@/features/tasks/organisms/new-task-dialog").then((module) => module.NewTaskDialog)
);
const TaskDetailPanel = dynamic(() =>
  import("@/features/tasks/organisms/task-detail-panel").then((module) => module.TaskDetailPanel)
);

export function PlanningOverlayLayer({ controller }: { controller: PlanningAppController }) {
  const {
    addTaskComment,
    addTaskRelation,
    backTaskPanel,
    closeTaskPanel,
    commentImportNotice,
    commentImportPendingTaskIds,
    createTask,
    decideTaskApproval,
    data,
    deleteTask,
    importGitHubComments,
    initiativeDialogDefaults,
    isPending,
    openTaskPanel,
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
    taskPanelPreviousTask,
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
          task={selectedTask}
          previousTask={taskPanelPreviousTask}
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
          githubInstallationAvailable={controller.githubInstallationAvailable}
          commentImportPending={commentImportPendingTaskIds.has(selectedTask.id)}
          onBack={taskPanelPreviousTask ? backTaskPanel : undefined}
          onClose={closeTaskPanel}
          onOpenTask={(taskId) => openTaskPanel(taskId, "push")}
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
          onDecideApproval={(action, note) => decideTaskApproval(selectedTask, action, note)}
        />
      )}
      {taskDialogDefaults && (
        <NewTaskDialog
          defaults={taskDialogDefaults}
          data={data}
          canApproveNow={currentProfile?.platformRole === "ceo"}
          pending={isPending}
          onClose={() => setTaskDialogDefaults(null)}
          onCreate={createTask}
        />
      )}
      {initiativeDialogDefaults && (
        <InitiativeDialog
          defaults={initiativeDialogDefaults}
          data={data}
          canApproveNow={currentProfile?.platformRole === "ceo"}
          pending={isPending}
          onClose={() => setInitiativeDialogDefaults(null)}
          onSave={saveInitiative}
        />
      )}
    </>
  );
}
