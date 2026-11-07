import "server-only";

import { createHash, createHmac } from "node:crypto";
import type { PlanningWorkspaceLoadContext, PlanningWorkspaceLoadResult, PlanningWorkspaceModel } from "@/features/planning-items/model/planning-workspace-model";
import { planningWorkspaceModelToPlanningShellState } from "@/features/planning-items/model/planning-shell-projection";
import { sortTasks } from "../model/planning-app-model";
import { normalizePlanningBoardQuery, planningBoardQueryKey, type PlanningBoardColumn } from "../model/planning-board-query";
import { buildPlanningTaskTableViewModel } from "../model/planning-task-table-view-model";
import { groupDirectChildrenByParent, taskChildProgress } from "@/features/tasks/model/task-card-presentation";
import { isTaskPlanningActive } from "../model/approval-domain";
import { hasOpenWaitingRelation } from "@/lib/platform";
import { normalizeStatus, taskStatuses } from "@/lib/status";
import type { Task, TaskStatus } from "@/lib/types";

const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");
export function compareCompletedPlanningCards(left: Task, right: Task) {
  const difference = Date.parse(right.updatedAt || "") - Date.parse(left.updatedAt || "");
  return (Number.isFinite(difference) && difference !== 0 ? difference : left.order - right.order) || left.id.localeCompare(right.id, "en");
}

export function projectPlanningBoard(model: PlanningWorkspaceModel, context: PlanningWorkspaceLoadContext): PlanningWorkspaceLoadResult {
  if (Object.values(model.coverage || {}).some(coverage => coverage !== "complete")) return { status: "unavailable" };
  const preference = model.preferences.find(value => value.profileId === context.actorProfileId);
  const input = context.query || {};
  const preferredFilters = preference && { ...preference.planningFilters, ...(preference.defaultWorkspace === "mine" ? { assignee: "Alle", quick: [...preference.planningFilters.quick, "mine"] } : {}) };
  const query = normalizePlanningBoardQuery({ ...input, view: input.view || (preference?.defaultTaskView && preference.defaultTaskView !== "board" ? "complete" : "board"), filters: input.filters || preferredFilters });
  const queryKey = planningBoardQueryKey(query);
  const revision = digest([model.items, model.relationships, model.blockers, model.people, model.sprints, model.preferences]);
  const statuses = [...taskStatuses, "Pausiert" as TaskStatus];
  const column = input.column || (input.continuation ? "Erledigt" : undefined);
  if (column && !statuses.includes(column)) return { status: "staleContinuation" };
  const binding = (status: TaskStatus, offset: number) => createHmac("sha256", context.authorityKey || context.actorProfileId || "local-planning").update(JSON.stringify([context.actorProfileId, queryKey, status, revision, offset])).digest("hex");
  const limit = Math.min(20, Math.max(1, Math.trunc(Number(input.limit) || 20)));
  let offset = 0;
  if (input.continuation) {
    try {
      const cursor = JSON.parse(Buffer.from(input.continuation, "base64url").toString("utf8"));
      if (!Number.isSafeInteger(cursor.offset) || cursor.offset < 1 || cursor.binding !== binding(column!, cursor.offset)) return { status: "staleContinuation" };
      offset = cursor.offset;
    } catch { return { status: "staleContinuation" }; }
  }
  if (query.view === "complete" || query.level !== "deliverable") {
    if (column || offset) return { status: "staleContinuation" };
    return { status: "ready", model: { ...model, query } };
  }
  const data = planningWorkspaceModelToPlanningShellState(model);
  const filtered = buildPlanningTaskTableViewModel({ currentProfile: model.people.find(person => person.id === context.actorProfileId) || null, data, filters: query.filters, includeAssignedSubIssueParents: true });
  const matches = filtered.visibleTasks.filter(task => task.taskType === "deliverable" && isTaskPlanningActive(task) && (query.parentId === "all" || task.parentTaskId === query.parentId));
  const completed = matches.filter(task => normalizeStatus(task.status) === "Erledigt").sort(compareCompletedPlanningCards);
  const orderedByStatus = new Map(statuses.map(status => [status, status === "Erledigt" ? completed : sortTasks(matches.filter(task => normalizeStatus(task.status) === status).sort((left, right) => left.id.localeCompare(right.id, "en")))]));
  if (column && offset > orderedByStatus.get(column)!.length) return { status: "staleContinuation" };
  const cards = statuses.flatMap(status => !column || status === column ? orderedByStatus.get(status)!.slice(offset, offset + limit) : []);
  const cardIds = new Set(cards.map(task => task.id));
  // Context is independent from card membership and contains only records needed by this page.
  const contextIds = new Set(cardIds);
  for (const task of model.items) if (task.taskType === "epic" || task.taskType === "initiative") contextIds.add(task.id);
  const relationships = model.relationships.filter(edge => contextIds.has(edge.taskId) || contextIds.has(edge.relatedTaskId));
  for (const edge of relationships) { contextIds.add(edge.taskId); contextIds.add(edge.relatedTaskId); }
  const byId = new Map(model.items.map(task => [task.id, task]));
  for (const id of contextIds) {
    let parent = byId.get(id)?.parentTaskId;
    while (parent && !contextIds.has(parent)) { contextIds.add(parent); parent = byId.get(parent)?.parentTaskId; }
  }
  const children = groupDirectChildrenByParent([...model.items]);
  const childProgressById = Object.fromEntries(cards.map(card => [card.id, taskChildProgress(children.get(card.id) || [])]));
  const columns = Object.fromEntries(statuses.map(status => {
    const total = orderedByStatus.get(status)!.length;
    const loaded = cards.filter(task => normalizeStatus(task.status) === status).length;
    const next = (!column || column === status ? offset : 0) + loaded;
    const continuation = next < total ? Buffer.from(JSON.stringify({ binding: binding(status, next), offset: next })).toString("base64url") : null;
    return [status, { total, loaded, completeness: continuation ? "partial" : "complete", continuation } satisfies PlanningBoardColumn];
  })) as Record<TaskStatus, PlanningBoardColumn>;
  return { status: "ready", model: {
    ...model, query,
    coverage: { ...model.coverage, items: "partial", relationships: "partial", blockers: "partial" },
    items: model.items.filter(task => contextIds.has(task.id)), relationships,
    blockers: model.blockers?.filter(blocker => contextIds.has(blocker.taskId)),
    board: { query, column, queryKey, revision, observedAt: new Date().toISOString(), cardIds: [...cardIds], childProgressById, columns,
      metrics: { total: matches.length, open: matches.length - completed.length, done: completed.length, blocked: matches.filter(task => normalizeStatus(task.status) === "Blockiert" || task.dependsOn || hasOpenWaitingRelation(task.id, data.tasks, data.taskRelations)).length },
      viewerOpenSubIssueIdsByDeliverableId: Object.fromEntries(Object.entries(filtered.viewerOpenSubIssueIdsByDeliverableId).filter(([id]) => cardIds.has(id))),
      workspaceRevision: { activeTaskCount: model.items.length, latestUpdatedAt: model.revision },
    },
  } };
}
