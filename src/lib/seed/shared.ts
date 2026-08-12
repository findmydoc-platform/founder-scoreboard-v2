import { mapLegacyMilestoneFromEpic, mapLegacyPackageFromInitiative } from "../planning-profile-mappers";
import type { Package, PlanningShellState, Task } from "../types";
import seedSource from "./source.json";

type EmptySeedCollections = Omit<PlanningShellState, "project" | "profiles" | "packages" | "tasks" | "sprints" | "fmdTools" | "meetings">;
type SeedTaskDefaults = Pick<Task, "status" | "evidenceLink" | "issueNumber" | "issueUrl" | "note" | "watched" | "sprintId" | "reviewStatus" | "scorePoints" | "scoreFinal" | "githubRepo" | "githubIssueNumber" | "githubIssueUrl" | "githubIssueSyncStatus" | "githubIssueLastSyncedAt" | "githubIssueSyncError" | "taskType" | "parentTaskId" | "approvalStatus" | "approvalRevision" | "parentApprovalStatus" | "scoreRelevant">;
export type SeedTaskInput = Omit<Task, keyof SeedTaskDefaults | "owner" | "assignee" | "evidenceLinks" | "linkedPullRequests"> & Partial<SeedTaskDefaults> & {
  assigneeId: string;
  ownerId?: string;
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
  packages: Package[];
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
function strategyAssignments(pack: Package): NonNullable<Task["raciAssignments"]> {
  const from = (role: NonNullable<Task["raciAssignments"]>[number]["role"], profileIds: string[] = []) => (
    profileIds.map((profileId, sortOrder) => ({ profileId, role, sortOrder }))
  );

  return [
    ...from("accountable", pack.accountableProfileId ? [pack.accountableProfileId] : []),
    ...from("responsible", pack.responsibleProfileIds),
    ...from("consulted", pack.consultedProfileIds),
    ...from("informed", pack.informedProfileIds),
  ];
}

function packageStatus(status: Package["status"]): Task["status"] {
  if (status === "active") return "In Arbeit";
  if (status === "paused") return "Pausiert";
  if (status === "done") return "Erledigt";
  return "Offen";
}

const seedStrategicTaskDefinitions: SeedTaskInput[] = [
  ...(source.epics || []).map((epic) => ({
    id: epic.id,
    order: epic.sortOrder || 0,
    title: epic.title,
    description: epic.description || "",
    priority: "",
    workstream: "",
    packageId: "",
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
  ...source.packages.map((pack) => ({
    id: pack.id,
    order: pack.sortOrder,
    title: pack.title,
    description: pack.goal || "",
    priority: pack.priority || "P2",
    workstream: "",
    packageId: "",
    deadline: "",
    definitionOfDone: "",
    dependsOn: "",
    hours: 0,
    startDate: "",
    endDate: "",
    ownerId: pack.ownerId || "",
    assigneeId: pack.ownerId || "",
    taskType: "initiative" as const,
    status: packageStatus(pack.status),
    targetDate: pack.targetDate || "",
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
    parentTaskId: pack.milestoneId || "",
    strategy: {
      goal: pack.goal || "",
      successCriteria: pack.successCriteria || "",
      scopeConstraints: pack.scopeConstraints || "",
    },
    raciAssignments: strategyAssignments(pack),
    approvalStatus: pack.approvalStatus || "approved",
    approvalRevision: pack.approvalRevision || 1,
    parentApprovalStatus: null,
    scoreRelevant: false,
  })),
];

export const seedTaskDefinitions = [
  ...seedStrategicTaskDefinitions,
  ...source.tasks.map((task) => ({
    ...task,
    parentTaskId: task.parentTaskId || (task.taskType === "sub_issue" ? "" : task.packageId || ""),
  })),
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
export const seedPackages = seedTasks
  .filter((task) => task.taskType === "initiative")
  .map(mapLegacyPackageFromInitiative);
export const seedMilestones = seedTasks
  .filter((task) => task.taskType === "epic")
  .map(mapLegacyMilestoneFromEpic);

export function createPlanningSeed(tasks: Task[] = seedTasks): PlanningShellState {
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
    milestones: seedMilestones,
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
