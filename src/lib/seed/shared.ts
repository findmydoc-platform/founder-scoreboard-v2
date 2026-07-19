import type { PlanningData, Task } from "../types";
import seedSource from "./source.json";

type EmptySeedCollections = Omit<PlanningData, "project" | "profiles" | "packages" | "tasks" | "sprints" | "fmdTools" | "meetings">;
type SeedTaskDefaults = Pick<Task, "status" | "evidenceLink" | "issueNumber" | "issueUrl" | "note" | "watched" | "sprintId" | "reviewStatus" | "scorePoints" | "scoreFinal" | "githubRepo" | "githubIssueNumber" | "githubIssueUrl" | "githubIssueSyncStatus" | "githubIssueLastSyncedAt" | "githubIssueSyncError" | "taskType" | "parentTaskId" | "approvalStatus" | "approvalRevision" | "parentApprovalStatus" | "scoreRelevant">;
export type SeedTaskInput = Omit<Task, keyof SeedTaskDefaults | "owner" | "assignee"> & Partial<SeedTaskDefaults> & {
  assigneeId: string;
  ownerId?: string;
};

type SeedSource = {
  project: PlanningData["project"];
  profiles: PlanningData["profiles"];
  packages: PlanningData["packages"];
  sprints: PlanningData["sprints"];
  fmdTools: PlanningData["fmdTools"];
  meetings: PlanningData["meetings"];
  emptyCollections: EmptySeedCollections;
  taskDefaults: SeedTaskDefaults;
  tasks: SeedTaskInput[];
};

const source = seedSource as unknown as SeedSource;

export const seedProject = source.project;
export const seedProfiles = source.profiles;
export const seedPackages = source.packages.map((pack) => ({
  ...pack,
  approvalStatus: pack.approvalStatus || "approved",
  approvalRevision: pack.approvalRevision || 1,
}));
export const seedSprints = source.sprints;
export const seedFmdTools = source.fmdTools;
export const seedMeetings = source.meetings;
export const emptySeedCollections = source.emptyCollections;
export const taskDefaults = source.taskDefaults;
export const seedTaskDefinitions = source.tasks;

const profileNameById = new Map(seedProfiles.map((profile) => [profile.id, profile.name]));

export function defineTask(input: SeedTaskInput): Task {
  const assigneeId = input.assigneeId;
  const ownerId = input.ownerId || assigneeId;

  return {
    ...taskDefaults,
    ...input,
    approvalStatus: input.taskType === "sub_issue" ? null : input.approvalStatus || "approved",
    approvalRevision: input.approvalRevision || 1,
    parentApprovalStatus: input.taskType === "sub_issue" ? input.parentApprovalStatus || "approved" : null,
    ownerId,
    assigneeId,
    owner: profileNameById.get(ownerId) || ownerId,
    assignee: profileNameById.get(assigneeId) || assigneeId,
  };
}

export function defineTasks(inputs: SeedTaskInput[]): Task[] {
  return inputs.map(defineTask);
}

export const seedTasks = defineTasks(seedTaskDefinitions);

export function createPlanningSeed(tasks: Task[] = seedTasks): PlanningData {
  return {
    project: seedProject,
    profiles: seedProfiles,
    packages: seedPackages,
    tasks,
    sprints: seedSprints,
    sprintCommitments: emptySeedCollections.sprintCommitments,
    founderSprintScores: emptySeedCollections.founderSprintScores,
    founderStrikeStates: emptySeedCollections.founderStrikeStates,
    strikeEvents: emptySeedCollections.strikeEvents,
    scoreObjections: emptySeedCollections.scoreObjections,
    milestones: emptySeedCollections.milestones,
    taskComments: emptySeedCollections.taskComments,
    taskExternalComments: emptySeedCollections.taskExternalComments,
    taskBlockers: emptySeedCollections.taskBlockers,
    taskRelations: emptySeedCollections.taskRelations,
    taskActivity: emptySeedCollections.taskActivity,
    taskReviews: emptySeedCollections.taskReviews || [],
    taskFocusItems: emptySeedCollections.taskFocusItems,
    notificationEvents: emptySeedCollections.notificationEvents,
    notificationDeliveries: emptySeedCollections.notificationDeliveries,
    notificationPreferences: emptySeedCollections.notificationPreferences,
    profileUiPreferences: emptySeedCollections.profileUiPreferences,
    profileFeatureTourAcknowledgements: emptySeedCollections.profileFeatureTourAcknowledgements,
    fmdTools: seedFmdTools,
    events: emptySeedCollections.events,
    meetings: seedMeetings,
    meetingAttendance: emptySeedCollections.meetingAttendance,
    audit: emptySeedCollections.audit,
  };
}
