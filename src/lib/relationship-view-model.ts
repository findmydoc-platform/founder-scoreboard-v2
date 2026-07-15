import { normalizeStatus } from "@/lib/status";
import { effectiveTaskRelation } from "@/lib/platform";
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
  const effective = effectiveTaskRelation(currentTask.id, relation);

  if (effective?.direction === "waitsOn") {
    return relatedDone
      ? { label: "Blocker erledigt", tone: "emerald" }
      : { label: "Blockiert aktuell", tone: "red" };
  }

  if (effective?.direction === "blocks") {
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
  const existing = effectiveTaskRelation(taskId, relation);
  const candidate = effectiveTaskRelation(taskId, {
    ...relation,
    taskId,
    relatedTaskId: draft.relatedTaskId,
    relationType: draft.relationType,
  });

  return Boolean(
    existing
    && candidate
    && existing.direction === candidate.direction
    && existing.linkedTaskId === candidate.linkedTaskId,
  );
}
