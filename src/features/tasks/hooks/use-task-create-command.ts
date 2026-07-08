"use client";

import type { Dispatch, SetStateAction } from "react";
import type { PlanningCommandContext } from "@/features/planning/hooks/planning-command-context";
import {
  profileForOwnerValue,
  reviewOwnerForTask,
} from "@/features/planning/model/planning-app-model";
import * as taskApi from "@/features/tasks/model/task-api-client";
import type { NewTaskDraft } from "@/features/tasks/organisms/new-task-dialog";
import type { Task } from "@/lib/types";

type UseTaskCreateCommandOptions = Pick<
  PlanningCommandContext,
  "apiClient" | "currentProfile" | "data" | "setData" | "setSaveError" | "source" | "startTransition"
> & {
  setTaskDialogDefaults: Dispatch<SetStateAction<Partial<NewTaskDraft> | null>>;
};

export function useTaskCreateCommand({
  apiClient,
  currentProfile,
  data,
  setData,
  setSaveError,
  setTaskDialogDefaults,
  source,
  startTransition,
}: UseTaskCreateCommandOptions) {
  const createTask = (draft: NewTaskDraft) => {
    setSaveError("");

    const ownerProfile = profileForOwnerValue(data.profiles, draft.owner || currentProfile?.id || "");
    const ownerId = draft.taskType === "proposal" && !draft.owner ? "" : ownerProfile?.id || "";
    const owner = ownerId ? ownerProfile?.name || "" : "";
    const localTask: Task = {
      id: `local-${Date.now()}`,
      order: data.tasks.length + 1,
      title: draft.title,
      description: draft.description,
      problemStatement: draft.problemStatement,
      intendedOutcome: draft.intendedOutcome,
      scopeConstraints: draft.scopeConstraints,
      acceptanceCriteria: draft.acceptanceCriteria,
      evidenceRequired: draft.evidenceRequired,
      dodTemplateVersion: "founder-deliverable-v2",
      status: draft.taskType === "proposal" ? "Vorschlag" : draft.status || "Offen",
      priority: draft.priority || "P2",
      ownerId,
      owner,
      assigneeId: ownerId,
      assignee: owner,
      createdById: currentProfile?.id || "",
      workstream: draft.workstream,
      packageId: draft.packageId,
      milestoneId: draft.milestoneId,
      deadline: draft.deadline,
      definitionOfDone: draft.definitionOfDone,
      dependsOn: "",
      evidenceLink: "",
      issueNumber: "",
      issueUrl: "",
      note: "",
      watched: false,
      hours: draft.hours,
      startDate: draft.startDate,
      endDate: draft.endDate,
      sprintId: draft.taskType === "proposal" || draft.taskType === "sub_issue" ? "" : draft.sprintId,
      reviewStatus: "not_requested",
      reviewOwnerProfileId: reviewOwnerForTask({ packageId: draft.packageId }, data.packages),
      scorePoints: 0,
      scoreFinal: false,
      githubRepo: "findmydoc-platform/management",
      githubIssueNumber: null,
      githubIssueUrl: "",
      githubSyncStatus: "not_synced",
      githubLastSyncedAt: "",
      githubSyncError: "",
      taskType: draft.taskType,
      parentTaskId: draft.parentTaskId,
      scoreRelevant: draft.taskType === "deliverable",
      selfDodChecked: false,
      selfEvidenceChecked: false,
      selfDocumentedChecked: false,
      selfBlockersChecked: false,
    };

    setData((current) => ({
      ...current,
      tasks: [...current.tasks, localTask],
    }));
    setTaskDialogDefaults(null);

    if (source !== "supabase") return;

    startTransition(async () => {
      let createdTaskCommitted = false;

      try {
        const { response, body } = await taskApi.createTaskRequest(apiClient, { ...draft, owner: ownerId || draft.owner });
        if (!response.ok || !body?.task) throw new Error(body?.error || "Aufgabe konnte nicht erstellt werden.");

        setData((current) => ({
          ...current,
          tasks: current.tasks.map((task) => (task.id === localTask.id ? body.task! : task)),
        }));
        createdTaskCommitted = true;

        if (draft.relatedTaskId && draft.relatedTaskId !== body.task.id) {
          const { response: relationResponse, body: relationBody } = await taskApi.addTaskRelationshipRequest(apiClient, body.task.id, {
            relationType: draft.relationType,
            relatedTaskId: draft.relatedTaskId,
            note: draft.relationNote,
          });
          if (!relationResponse.ok || !relationBody?.relation) throw new Error(relationBody?.error || "Abhängigkeit konnte nicht gespeichert werden.");
          setData((current) => ({
            ...current,
            taskRelations: [relationBody.relation!, ...current.taskRelations],
            tasks: current.tasks.map((task) =>
              task.id === body.task!.id || task.id === draft.relatedTaskId
                ? { ...task, githubSyncStatus: "not_synced", githubSyncError: "" }
                : task,
            ),
          }));
        }

        if (draft.createGitHubIssue && body.task.taskType === "deliverable") {
          const { response: syncResponse, body: syncBody } = await taskApi.syncTaskToGitHubRequest(apiClient, body.task.id, { createIfMissing: true });
          if (!syncResponse.ok || !syncBody?.task) throw new Error(syncBody?.error || "Externe Ablage konnte nicht angelegt werden.");
          setData((current) => ({
            ...current,
            tasks: current.tasks.map((task) => (task.id === body.task!.id ? { ...task, ...syncBody.task } : task)),
          }));
        }
      } catch (error) {
        if (!createdTaskCommitted) {
          setData((current) => ({
            ...current,
            tasks: current.tasks.filter((task) => task.id !== localTask.id),
          }));
        }
        setSaveError(error instanceof Error ? error.message : "Aufgabe konnte nicht erstellt werden.");
      }
    });
  };

  return { createTask };
}
