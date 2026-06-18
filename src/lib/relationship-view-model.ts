import { normalizeStatus } from "@/lib/status";
import type { Task, TaskRelation, TaskRelationType } from "@/lib/types";

export type RelationshipBadgeTone = "red" | "emerald" | "blue" | "slate";

export type RelationshipBadge = {
  label: string;
  tone: RelationshipBadgeTone;
};

export function relationshipBadgeFor(
  currentTask: Task,
  relation: TaskRelation,
  relatedTask?: Task,
): RelationshipBadge {
  const currentDone = normalizeStatus(currentTask.status) === "Erledigt";
  const relatedDone = relatedTask ? normalizeStatus(relatedTask.status) === "Erledigt" : false;

  if (relation.relationType === "blocked_by" && relation.taskId === currentTask.id) {
    return relatedDone
      ? { label: "Blocker erledigt", tone: "emerald" }
      : { label: "Blockiert aktuell", tone: "red" };
  }

  if (
    (relation.relationType === "blocked_by" && relation.relatedTaskId === currentTask.id) ||
    (relation.relationType === "blocks" && relation.taskId === currentTask.id)
  ) {
    return currentDone
      ? { label: "Abhängigkeit erfüllt", tone: "emerald" }
      : { label: "Blockiert andere", tone: "blue" };
  }

  return { label: "Verknüpft", tone: "slate" };
}

export function relationshipBadgeToneClass(tone: RelationshipBadgeTone) {
  if (tone === "red") return "border-red-200 bg-red-50 text-red-700";
  if (tone === "emerald") return "border-emerald-200 bg-emerald-50 text-emerald-700";
  if (tone === "blue") return "border-blue-200 bg-blue-50 text-blue-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

export function relationMatchesDraft(
  taskId: string,
  relation: TaskRelation,
  draft: { relationType: TaskRelationType; relatedTaskId: string },
) {
  return (
    relation.taskId === taskId &&
    relation.relatedTaskId === draft.relatedTaskId &&
    relation.relationType === draft.relationType
  );
}
