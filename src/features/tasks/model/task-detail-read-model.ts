import type {
  Profile,
  Project,
  Sprint,
  Task,
  TaskActivity,
  TaskBlocker,
  TaskComment,
  TaskExternalComment,
  TaskRelation,
  TaskReview,
} from "@/lib/types";

export const taskDetailReadLimits = {
  ancestorDepth: 3,
  children: 200, // Page and ID-batch size; direct children are loaded completely.
  comments: 200,
  externalComments: 300,
  blockers: 200,
  relationships: 250,
  activity: 500,
  reviews: 100,
} as const;

export type TaskDetailReadArea = "target" | "discussion" | "timeline" | "children";

export type TaskDetailUnavailableArea = "discussion" | "relationships" | "timeline";

export type TaskDetailModel = Readonly<{
  revision: string;
  sourceRevision?: string;
  readArea?: TaskDetailReadArea;
  observedAt?: string;
  validUntil?: string | null;
  authorityDeadline?: number;
  readActor?: Readonly<{ profileId: string; platformRole: Profile["platformRole"] }>;
  coverage?: Readonly<Partial<Record<TaskDetailUnavailableArea | "children", "complete" | "partial">>>;
  childProgress?: ReturnType<typeof import("./task-card-presentation").taskChildProgress>;
  taskOmittedFields?: readonly (keyof Task)[];
  project: Project;
  item: Task;
  ancestors: readonly Task[];
  children: readonly Task[];
  relatedItems: readonly Task[];
  people: readonly Profile[];
  sprints: readonly Sprint[];
  discussion: Readonly<{
    comments: readonly TaskComment[];
    externalComments: readonly TaskExternalComment[];
  }>;
  blockers: readonly TaskBlocker[];
  relationships: readonly TaskRelation[];
  activity: readonly TaskActivity[];
  reviews: readonly TaskReview[];
}>;

export type TaskDetailHydration = Readonly<{
  itemId: string;
  model: TaskDetailModel;
  readAuthority: import("@/features/planning/model/planning-server-header-read").PlanningReadAuthority;
  session: import("@/lib/credentials/session-types").ServerSessionView;
}>;

export type TaskDetailReadContext = Readonly<{
  authorized: boolean;
  actorProfileId: string | null;
}>;

export type TaskDetailLoadResult =
  | { status: "ready"; model: TaskDetailModel }
  | { status: "degraded"; model: TaskDetailModel; unavailable: readonly TaskDetailUnavailableArea[] }
  | { status: "notFound"; people: readonly Profile[] }
  | { status: "forbidden" }
  | { status: "unavailable" }
  | { status: "staleContinuation" };

export interface TaskDetailReadModel {
  load(input: { itemId: string; area?: TaskDetailReadArea | "complete" }, context: TaskDetailReadContext): Promise<TaskDetailLoadResult>;
}

