"use client";

import dynamic from "next/dynamic";
import type { PlanningAppController } from "@/features/planning/hooks/use-planning-app-controller";

type OverlayLoadingFallbackProps = {
  label: string;
  surface: "dialog" | "notice" | "panel";
};

function OverlayLoadingFallback({ label, surface }: OverlayLoadingFallbackProps) {
  const message = (
    <div
      role="status"
      aria-live="polite"
      aria-busy="true"
      className="flex items-center gap-3 rounded-lg border border-slate-200 bg-white px-4 py-3 text-sm font-medium text-slate-700 shadow-xl"
    >
      <span aria-hidden="true" className="h-2.5 w-2.5 animate-pulse rounded-full bg-blue-500" />
      {label}
    </div>
  );

  if (surface === "notice") {
    return <div className="fixed inset-x-4 top-24 z-50 mx-auto max-w-md">{message}</div>;
  }

  if (surface === "panel") {
    return (
      <>
        <div aria-hidden="true" className="fixed inset-0 z-30 bg-slate-950/20 backdrop-blur-[1px]" />
        <aside className="fixed inset-y-0 right-0 z-40 w-full max-w-[920px] border-l border-slate-200 bg-white p-5 shadow-2xl">
          {message}
        </aside>
      </>
    );
  }

  return <div className="fixed inset-0 z-50 grid place-items-center bg-slate-950/40 p-4">{message}</div>;
}

const StatusGuardDialog = dynamic(
  () => import("@/features/planning/organisms/status-guard-dialog").then((module) => module.StatusGuardDialog),
  { loading: () => <OverlayLoadingFallback label="Statusdialog wird geladen …" surface="notice" /> },
);
const InitiativeDialog = dynamic(
  () => import("@/features/projects/organisms/initiative-dialog").then((module) => module.InitiativeDialog),
  { loading: () => <OverlayLoadingFallback label="Initiativenformular wird geladen …" surface="dialog" /> },
);
const NewTaskDialog = dynamic(
  () => import("@/features/tasks/organisms/new-task-dialog").then((module) => module.NewTaskDialog),
  { loading: () => <OverlayLoadingFallback label="Aufgabenformular wird geladen …" surface="dialog" /> },
);
const TaskDetailPanel = dynamic(
  () => import("@/features/tasks/organisms/task-detail-panel").then((module) => module.TaskDetailPanel),
  { loading: () => <OverlayLoadingFallback label="Aufgabendetails werden geladen …" surface="panel" /> },
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
