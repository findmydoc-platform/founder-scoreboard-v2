import type { PlanningShellState, Task } from "../types";
import seedSource from "./source.json";

type EmptySeedCollections = Omit<PlanningShellState, "project" | "profiles" | "tasks" | "sprints" | "fmdTools" | "meetings">;
type SeedTaskDefaults = Pick<Task, "status" | "evidenceLink" | "issueNumber" | "issueUrl" | "note" | "watched" | "sprintId" | "reviewStatus" | "scorePoints" | "scoreFinal" | "githubRepo" | "githubIssueNumber" | "githubIssueUrl" | "githubIssueSyncStatus" | "githubIssueLastSyncedAt" | "githubIssueSyncError" | "taskType" | "parentTaskId" | "approvalStatus" | "approvalRevision" | "parentApprovalStatus" | "scoreRelevant">;
export type SeedTaskInput = Omit<Task, keyof SeedTaskDefaults | "owner" | "assignee" | "evidenceLinks" | "linkedPullRequests"> & Partial<SeedTaskDefaults> & {
  assigneeId: string;
  ownerId?: string;
};

type SeedInitiative = {
  id: string;
  parentTaskId: string;
  title: string;
  goal: string;
  priority: string;
  ownerId?: string;
  accountableProfileId?: string;
  responsibleProfileIds?: string[];
  consultedProfileIds?: string[];
  informedProfileIds?: string[];
  status: Task["status"];
  targetDate?: string;
  successCriteria?: string;
  scopeConstraints?: string;
  sortOrder: number;
  approvalStatus?: Task["approvalStatus"];
  approvalRevision?: number;
};

type SeedSource = {
  project: PlanningShellState["project"];
  profiles: PlanningShellState["profiles"];
  epics?: Array<{
    id: string;
    title: string;
    description?: string;
    ownerId?: string;
    status?: Task["status"];
    targetDate?: string;
    sortOrder?: number;
  }>;
  initiatives: SeedInitiative[];
  sprints: PlanningShellState["sprints"];
  fmdTools: PlanningShellState["fmdTools"];
  meetings: PlanningShellState["meetings"];
  emptyCollections: EmptySeedCollections;
  taskDefaults: SeedTaskDefaults;
  tasks: SeedTaskInput[];
};

const source = seedSource as unknown as SeedSource;

export const seedProject = source.project;
export const seedProfiles = source.profiles;
export const seedSprints = source.sprints;
export const seedFmdTools = source.fmdTools;
export const seedMeetings = source.meetings;
export const emptySeedCollections = source.emptyCollections;
export const taskDefaults = source.taskDefaults;
function strategyAssignments(initiative: SeedInitiative): NonNullable<Task["raciAssignments"]> {
  const from = (role: NonNullable<Task["raciAssignments"]>[number]["role"], profileIds: string[] = []) => (
    profileIds.map((profileId, sortOrder) => ({ profileId, role, sortOrder }))
  );

  return [
    ...from("accountable", initiative.accountableProfileId ? [initiative.accountableProfileId] : []),
    ...from("responsible", initiative.responsibleProfileIds),
    ...from("consulted", initiative.consultedProfileIds),
    ...from("informed", initiative.informedProfileIds),
  ];
}

const seedStrategicTaskDefinitions: SeedTaskInput[] = [
  ...(source.epics || []).map((epic) => ({
    id: epic.id,
    order: epic.sortOrder || 0,
    title: epic.title,
    description: epic.description || "",
    priority: "",
    workstream: "",
    deadline: "",
    definitionOfDone: "",
    dependsOn: "",
    hours: 0,
    startDate: "",
    endDate: "",
    ownerId: epic.ownerId || "",
    assigneeId: epic.ownerId || "",
    taskType: "epic" as const,
    status: epic.status || "Offen",
    targetDate: epic.targetDate || "",
    sprintId: "",
    reviewStatus: "not_requested" as const,
    scorePoints: 0,
    scoreFinal: false,
    githubRepo: "",
    githubIssueNumber: null,
    githubIssueUrl: "",
    githubIssueSyncStatus: "not_applicable" as const,
    githubIssueLastSyncedAt: "",
    githubIssueSyncError: "",
    parentTaskId: "",
    approvalStatus: null,
    approvalRevision: 1,
    parentApprovalStatus: null,
    scoreRelevant: false,
  })),
  ...source.initiatives.map((initiative) => ({
    id: initiative.id,
    order: initiative.sortOrder,
    title: initiative.title,
    description: initiative.goal || "",
    priority: initiative.priority || "P2",
    workstream: "",
    deadline: "",
    definitionOfDone: "",
    dependsOn: "",
    hours: 0,
    startDate: "",
    endDate: "",
    ownerId: initiative.ownerId || "",
    assigneeId: initiative.ownerId || "",
    taskType: "initiative" as const,
    status: initiative.status,
    targetDate: initiative.targetDate || "",
    sprintId: "",
    reviewStatus: "not_requested" as const,
    scorePoints: 0,
    scoreFinal: false,
    githubRepo: "",
    githubIssueNumber: null,
    githubIssueUrl: "",
    githubIssueSyncStatus: "not_applicable" as const,
    githubIssueLastSyncedAt: "",
    githubIssueSyncError: "",
    parentTaskId: initiative.parentTaskId,
    strategy: {
      goal: initiative.goal || "",
      successCriteria: initiative.successCriteria || "",
      scopeConstraints: initiative.scopeConstraints || "",
    },
    raciAssignments: strategyAssignments(initiative),
    approvalStatus: initiative.approvalStatus || "approved",
    approvalRevision: initiative.approvalRevision || 1,
    parentApprovalStatus: null,
    scoreRelevant: false,
  })),
];

export const seedTaskDefinitions = [
  ...seedStrategicTaskDefinitions,
  ...source.tasks,
];

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
    evidenceLinks: [],
    linkedPullRequests: [],
  };
}

export function defineTasks(inputs: SeedTaskInput[]): Task[] {
  return inputs.map(defineTask);
}

export const seedTasks = defineTasks(seedTaskDefinitions);
export function createPlanningSeed(tasks: Task[] = seedTasks): PlanningShellState {
  return {
    project: seedProject,
    profiles: seedProfiles,
    tasks,
    sprints: seedSprints,
    sprintCommitments: emptySeedCollections.sprintCommitments,
    founderSprintScores: emptySeedCollections.founderSprintScores,
    founderStrikeStates: emptySeedCollections.founderStrikeStates,
    strikeEvents: emptySeedCollections.strikeEvents,
    scoreObjections: emptySeedCollections.scoreObjections,
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
