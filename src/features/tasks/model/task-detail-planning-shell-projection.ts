import type { TaskDetailModel, TaskDetailUnavailableArea } from "@/features/tasks/model/task-detail-read-model";
import type { PlanningShellState } from "@/lib/types";

function modelTasks(model: TaskDetailModel) {
  return [...new Map([
    model.item,
    ...model.ancestors,
    ...model.children,
    ...model.relatedItems,
  ].map((task) => [task.id, task])).values()];
}

function replaceTasks<T extends { id: string }>(current: readonly T[], replacements: readonly T[]): T[] {
  const replacementById = new Map(replacements.map((task) => [task.id, task]));
  const existingIds = new Set(current.map((task) => task.id));
  return [
    ...current.map((task) => replacementById.get(task.id) || task),
    ...replacements.filter((task) => !existingIds.has(task.id)),
  ];
}

export function taskDetailModelToPlanningShellState(model: TaskDetailModel): PlanningShellState {
  const tasks = modelTasks(model);
  return {
    project: model.project,
    profiles: [...model.people],
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

export function applyTaskDetailModel(current: PlanningShellState, model: TaskDetailModel, unavailable: readonly TaskDetailUnavailableArea[] = [], coverage: NonNullable<TaskDetailModel["coverage"]> = model.coverage || { discussion: "complete", relationships: "complete", timeline: "complete" }): PlanningShellState {
  const selectedId = model.item.id;
  function collection<T extends { id: string | number }>(area: TaskDetailUnavailableArea, existing: readonly T[], incoming: readonly T[], belongs: (item: T) => boolean): T[] {
    if (unavailable.includes(area)) return [...existing];
    const retained = coverage[area] === "complete" ? existing.filter(item => !belongs(item)) : existing;
    const incomingIds = new Set(incoming.map(item => item.id));
    return [...incoming, ...retained.filter(item => !incomingIds.has(item.id))];
  }
  const selected = (item: { taskId: string }) => item.taskId === selectedId;
  return {
    ...current,
    tasks: replaceTasks(current.tasks, modelTasks(model)),
    profiles: replaceTasks(current.profiles, model.people),
    sprints: replaceTasks(current.sprints, model.sprints),
    taskComments: collection("discussion", current.taskComments, model.discussion.comments, selected),
    taskExternalComments: collection("discussion", current.taskExternalComments, model.discussion.externalComments, selected),
    taskBlockers: collection("relationships", current.taskBlockers, model.blockers, selected),
    taskActivity: collection("timeline", current.taskActivity, model.activity, selected),
    taskReviews: collection("timeline", current.taskReviews, model.reviews, selected),
    taskRelations: collection("relationships", current.taskRelations, model.relationships, item => selected(item) || item.relatedTaskId === selectedId),
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
