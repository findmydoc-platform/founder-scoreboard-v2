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
  children: 200,
  comments: 200,
  externalComments: 300,
  blockers: 200,
  relationships: 250,
  activity: 500,
  reviews: 100,
} as const;

export type TaskDetailUnavailableArea = "discussion" | "relationships" | "timeline";

export type TaskDetailModel = Readonly<{
  revision: string;
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

export type TaskDetailReadContext = Readonly<{
  authorized: boolean;
  actorProfileId: string | null;
}>;

export type TaskDetailLoadResult =
  | { status: "ready"; model: TaskDetailModel }
  | { status: "degraded"; model: TaskDetailModel; unavailable: readonly TaskDetailUnavailableArea[] }
  | { status: "notFound"; people: readonly Profile[] }
  | { status: "forbidden" }
  | { status: "unavailable" };

export interface TaskDetailReadModel {
  load(input: { itemId: string }, context: TaskDetailReadContext): Promise<TaskDetailLoadResult>;
}

