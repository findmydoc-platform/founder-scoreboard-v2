import type { Task, TaskRelation, TaskRelationType } from "@/lib/types";
import type { PlanningReadStatus, PlanningTaskSaveCheck } from "@/features/planning/model/planning-state";
export type TaskRelationshipInput = { relationType: TaskRelationType; relatedTaskId: string; note: string };
export type TaskRelationshipChangeView = {
 id: string; kind: "add" | "remove"; taskId: string; relatedTaskId: string; relationId: number | null;
 submitted: Readonly<TaskRelationshipInput>; phase: "saving" | "confirmed" | "rejected" | "unconfirmed";
 error: string; checking: boolean; taskReads: Readonly<Record<string, PlanningReadStatus>>;
};
export type TaskRelationshipChangeResult = { ok: true } | { ok: false; kind: "blocked" | "ended" | "rejected" | "unconfirmed"; error: string; status?: number };
export interface TaskRelationshipAdapter {
 addTaskRelationship?(task: Task, input: TaskRelationshipInput): Promise<{ relation: TaskRelation }>;
 removeTaskRelationship?(task: Task, relation: TaskRelation): Promise<{ relationId: number }>;
}
export interface PlanningTaskRelationships {
 addTaskRelationship(task: Task, input: TaskRelationshipInput): Promise<TaskRelationshipChangeResult>;
 removeTaskRelationship(task: Task, relation: TaskRelation): Promise<TaskRelationshipChangeResult>;
 taskRelationships(taskId: string): { relations: readonly TaskRelation[]; completeness: "complete" | "partial"; readStatus: PlanningReadStatus };
 taskRelationshipChanges(taskId: string): readonly TaskRelationshipChangeView[];
 checkTaskRelationshipChange(id: string): Promise<PlanningTaskSaveCheck>;
}
