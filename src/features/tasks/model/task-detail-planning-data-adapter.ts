import type { TaskDetailModel, TaskDetailUnavailableArea } from "@/features/tasks/model/task-detail-read-model";
import { mapLegacyMilestoneFromEpic, mapLegacyPackageFromInitiative } from "@/lib/planning-profile-mappers";
import type { PlanningData, Task } from "@/lib/types";

function modelTasks(model: TaskDetailModel) {
  return [...new Map([
    model.item,
    ...model.ancestors,
    ...model.children,
    ...model.relatedItems,
  ].map((task) => [task.id, task])).values()];
}

function replaceTasks(current: readonly Task[], replacements: readonly Task[]) {
  const replacementById = new Map(replacements.map((task) => [task.id, task]));
  const existingIds = new Set(current.map((task) => task.id));
  return [
    ...current.map((task) => replacementById.get(task.id) || task),
    ...replacements.filter((task) => !existingIds.has(task.id)),
  ];
}

export function taskDetailModelToPlanningData(model: TaskDetailModel): PlanningData {
  const tasks = modelTasks(model);
  return {
    project: model.project,
    profiles: [...model.people],
    packages: tasks.filter((task) => task.taskType === "initiative").map(mapLegacyPackageFromInitiative),
    milestones: tasks.filter((task) => task.taskType === "epic").map(mapLegacyMilestoneFromEpic),
    tasks,
    sprints: [...model.sprints],
    sprintCommitments: [],
    founderSprintScores: [],
    founderStrikeStates: [],
    strikeEvents: [],
    scoreObjections: [],
    taskComments: [...model.discussion.comments],
    taskExternalComments: [...model.discussion.externalComments],
    taskBlockers: [...model.blockers],
    taskRelations: [...model.relationships],
    taskActivity: [...model.activity],
    taskReviews: [...model.reviews],
    taskFocusItems: [],
    notificationEvents: [],
    notificationDeliveries: [],
    notificationPreferences: [],
    profileUiPreferences: [],
    profileFeatureTourAcknowledgements: [],
    fmdTools: [],
    events: [],
    meetings: [],
    meetingAttendance: [],
    audit: [],
  };
}

export function applyTaskDetailModel(current: PlanningData, model: TaskDetailModel): PlanningData {
  const replacements = modelTasks(model);
  const replacementIds = new Set(replacements.map((task) => task.id));
  const selectedId = model.item.id;
  return {
    ...current,
    tasks: replaceTasks(current.tasks, replacements),
    profiles: model.people.length ? [...model.people] : current.profiles,
    packages: [
      ...current.packages.filter((item) => !replacementIds.has(item.id)),
      ...replacements.filter((task) => task.taskType === "initiative").map(mapLegacyPackageFromInitiative),
    ],
    milestones: [
      ...current.milestones.filter((item) => !replacementIds.has(item.id)),
      ...replacements.filter((task) => task.taskType === "epic").map(mapLegacyMilestoneFromEpic),
    ],
    sprints: model.sprints.length ? [...model.sprints] : current.sprints,
    taskComments: [...model.discussion.comments, ...current.taskComments.filter((item) => item.taskId !== selectedId)],
    taskExternalComments: [...model.discussion.externalComments, ...current.taskExternalComments.filter((item) => item.taskId !== selectedId)],
    taskBlockers: [...model.blockers, ...current.taskBlockers.filter((item) => item.taskId !== selectedId)],
    taskActivity: [...model.activity, ...current.taskActivity.filter((item) => item.taskId !== selectedId)],
    taskReviews: [...model.reviews, ...current.taskReviews.filter((item) => item.taskId !== selectedId)],
    taskRelations: [
      ...model.relationships,
      ...current.taskRelations.filter((item) => item.taskId !== selectedId && item.relatedTaskId !== selectedId),
    ],
  };
}

const unavailableLabels: Record<TaskDetailUnavailableArea, string> = {
  discussion: "Diskussion",
  relationships: "Beziehungen und Blocker",
  timeline: "Aktivität und Reviews",
};

export function taskDetailDegradationMessage(unavailable: readonly TaskDetailUnavailableArea[]) {
  return unavailable.length
    ? `${unavailable.map((area) => unavailableLabels[area]).join(", ")} konnten nicht vollständig geladen werden.`
    : "";
}

