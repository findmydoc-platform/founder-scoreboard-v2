import type { PlanningTaskSaveCheck } from "../planning-state";
import type { PlanningShellState, Task, TaskRelation } from "@/lib/types";
import type { PlanningTaskCreationInput, PlanningTaskCreationConfirmation, PlanningTaskCreationResult, PlanningTaskLifecycleView, PlanningTaskRemovalConfirmation, PlanningTaskRemovalResult } from "../planning-task-lifecycle";

type LifecycleAdapter = {
  removalBlocked?: (task:Task) => boolean;
  createTask?: (input: PlanningTaskCreationInput) => Promise<PlanningTaskCreationConfirmation>;
  removeTask?: (task: Task, action: "withdraw" | "reject", reason: string) => Promise<PlanningTaskRemovalConfirmation>;
  checkCreation(): Promise<PlanningTaskSaveCheck["readStatus"]>;
  checkRemoval(taskId: string): Promise<PlanningTaskSaveCheck["readStatus"]>;
  current(): PlanningShellState;
  acceptRemoval(ids: ReadonlySet<string>, action: "withdraw" | "reject", rootId: string): void;
  capture(): number;
  acceptCreation(result: PlanningTaskCreationConfirmation, started: number, relatedBasis?: { id: string; updatedAt?: string }): void;
  generation(): number;
  isActive(): boolean;
  changed(): void;
};
function temporaryTask(input: PlanningTaskCreationInput, data: PlanningShellState): Task {
  const owner = data.profiles.find(profile => profile.id === input.ownerId);
  return {
    id: `pending:${input.creationRequestId}`, order: 0, title: input.title, description: input.description,
    status: input.status || "Offen", priority: input.priority || "P2", assignee: owner?.name || input.ownerId, assigneeId: input.ownerId,
    owner: owner?.name || input.ownerId, ownerId: input.ownerId, workstream: input.workstream || "", fixedDate: input.fixedDate || "",
    definitionOfDone: input.definitionOfDone || "", dependsOn: "", evidenceLink: "", evidenceLinks: [], linkedPullRequests: [], issueNumber: "", issueUrl: "", note: "", watched: false,
    hours: input.hours || 0, sprintId: "", reviewStatus: "not_requested", scorePoints: 0, scoreFinal: false,
    githubRepo: input.githubRepo || "", githubIssueNumber: null, githubIssueUrl: "", githubIssueSyncStatus: "not_synced", githubIssueLastSyncedAt: "", githubIssueSyncError: "",
    taskType: input.taskType, parentTaskId: input.parentTaskId,
    approvalStatus: input.taskType === "deliverable" || input.taskType === "initiative" ? "proposed" : null,
    approvalRevision: 1, parentApprovalStatus: data.tasks.find(task => task.id === input.parentTaskId)?.approvalStatus || null,
    scoreRelevant: false, problemStatement: input.problemStatement, intendedOutcome: input.intendedOutcome,
    scopeConstraints: input.scopeConstraints, acceptanceCriteria: input.acceptanceCriteria, evidenceRequired: input.evidenceRequired,
  };
}
function subtreeIds(data: PlanningShellState, roots: ReadonlySet<string>) {
  const ids = new Set(roots);
  let changed = true;
  while (changed) {
    changed = false;
    for (const task of data.tasks) if (ids.has(task.parentTaskId) && !ids.has(task.id)) { ids.add(task.id); changed = true; }
  }
  return ids;
}
function withoutTasks(data: PlanningShellState, ids: ReadonlySet<string>): PlanningShellState {
  if (!ids.size) return data;
  return { ...data, tasks: data.tasks.filter(task => !ids.has(task.id)),
    taskComments: data.taskComments.filter(item => !ids.has(item.taskId)), taskExternalComments: data.taskExternalComments.filter(item => !ids.has(item.taskId)),
    taskActivity: data.taskActivity.filter(item => !ids.has(item.taskId)), taskBlockers: data.taskBlockers.filter(item => !ids.has(item.taskId)),
    taskReviews: data.taskReviews.filter(item => !ids.has(item.taskId)), taskFocusItems: data.taskFocusItems.filter(item => !ids.has(item.taskId)),
    taskRelations: data.taskRelations.filter(item => !ids.has(item.taskId) && !ids.has(item.relatedTaskId)),
  };
}
export function createTaskLifecycle(adapter: LifecycleAdapter) {
  const operations = new Map<string, PlanningTaskLifecycleView>();
  const temporary = new Map<string, Task>();
  const removed = new Set<string>();
  const createdRelations = new Map<number, { relation: TaskRelation; acceptedAt: number }>();
  const removedRelations = new Set<number>();
  const removing = new Map<string, string>();
  let removalSequence = 0;
  const checks = new Map<string, Promise<PlanningTaskSaveCheck>>();
  const denied = new Set<string>();
  function inTree(task: Task, roots: ReadonlySet<string>) {
    const known = new Map(adapter.current().tasks.map(item => [item.id, item]));
    let current: Task | undefined = task;
    const visited = new Set<string>();
    while (current && !visited.has(current.id)) {
      if (roots.has(current.id) || roots.has(current.parentTaskId)) return true;
      visited.add(current.id);
      current = known.get(current.parentTaskId);
    }
    return false;
  }
  const isRemoved = (task: Task) => inTree(task, removed);
  const isRemoving = (task: Task) => inTree(task, new Set(removing.values()));
  function projectConfirmed(data: PlanningShellState) {
    for (const id of subtreeIds(data, removed)) removed.add(id);
    const known = new Set(data.taskRelations.map(relation => relation.id));
    const taskRelations = [...data.taskRelations.filter(relation => !removedRelations.has(relation.id)).map(relation => createdRelations.get(relation.id)?.relation || relation), ...[...createdRelations.values()].filter(receipt => !known.has(receipt.relation.id)).map(receipt => receipt.relation)];
    return withoutTasks({ ...data, taskRelations }, removed);
  }
  return {
    isRemoved,
    isRemoving,
    projectConfirmed,
    acceptRelationshipRead(data: PlanningShellState, started: number, complete: boolean, taskId?: string) {
      const incoming = new Map(data.taskRelations.map(relation => [relation.id, relation]));
      for (const [id, receipt] of createdRelations) {
        if (receipt.acceptedAt > started) continue;
        const covered = !taskId || receipt.relation.taskId === taskId || receipt.relation.relatedTaskId === taskId;
        if (!covered) continue;
        const relation = incoming.get(id);
        if (relation) receipt.relation = relation;
        else if (complete) { createdRelations.delete(id); removedRelations.add(id); }
      }
    },
    views: () => adapter.isActive() ? [...operations.values()].map(operation => denied.has(operation.id) ? { ...operation, submitted: null } : structuredClone(operation)) : [],
    check(id: string): Promise<PlanningTaskSaveCheck> {
      if (!adapter.isActive()) return Promise.resolve({ outcome: "session-ended", readStatus: "not-needed" });
      const operation = operations.get(id);
      if (!operation || operation.phase !== "unconfirmed" && operation.phase !== "blocked") return Promise.resolve({ outcome: "not-pending", readStatus: "not-needed" });
      const existing = checks.get(id);
      if (existing) return existing;
      const generation = adapter.generation();
      operation.checkStatus = "checking";
      adapter.changed();
      const checked = (async (): Promise<PlanningTaskSaveCheck> => {
        const readStatus = await (operation.kind === "create" ? adapter.checkCreation() : adapter.checkRemoval(operation.taskId));
        if (!adapter.isActive() || adapter.generation() !== generation) return { outcome: "session-ended", readStatus: "not-needed" };
        if (readStatus === "forbidden") denied.add(id);
        else if (readStatus === "current" || readStatus === "stale") denied.delete(id);
        operation.checkStatus = readStatus === "current" || readStatus === "stale" ? "checked" : readStatus === "forbidden" ? "forbidden" : "unavailable";
        adapter.changed();
        return { outcome: "unconfirmed", readStatus };
      })();
      checks.set(id, checked);
      void checked.finally(() => { if (checks.get(id) === checked) checks.delete(id); });
      return checked;
    },
    clear() { operations.clear(); temporary.clear(); removed.clear(); removing.clear(); checks.clear(); denied.clear(); createdRelations.clear(); removedRelations.clear(); },
    isTemporary: (id: string) => [...temporary.values()].some(task => task.id === id),
    projectVisible(data: PlanningShellState): PlanningShellState {
      const remaining = withoutTasks(data, subtreeIds(data, new Set(removing.values())));
      return temporary.size ? { ...remaining, tasks: [...remaining.tasks, ...[...temporary.values()].filter(task => !isRemoved(task))] } : remaining;
    },
    async removeTask(task: Task, action: "withdraw" | "reject", reason: string): Promise<PlanningTaskRemovalResult> {
      if (!adapter.isActive()) return { ok: false, kind: "sessionSuperseded", error: "Die Sitzung wurde ersetzt.", status: 409 };
      if (!adapter.removeTask) return { ok: false, kind: "rejected", error: "Entfernen ist nicht verfügbar." };
      if (isRemoved(task)) return { ok: false, kind: "rejected", code: "task_removed", error: "Diese Aufgabe wurde bereits entfernt." };
      if ([...removing.values()].includes(task.id)) return { ok: false, kind: "unconfirmed", error: "Diese Änderung ist noch nicht bestätigt." };
      const generation = adapter.generation();
      const id = `${action}:${task.id}:${++removalSequence}`;
      const operation: PlanningTaskLifecycleView = { id, kind: action, phase: "saving", submitted: structuredClone({ task, reason }), taskId: task.id, error: "", checkStatus: "not-checked" };
      operations.set(id, operation);
      const affected=subtreeIds(adapter.current(),new Set([task.id]));
      if (isRemoving(task)||adapter.current().tasks.some(row=>affected.has(row.id)&&adapter.removalBlocked?.(row))) {
        operation.phase = "blocked";
        operation.error = "Eine abhängige Änderung oder ein Sprint-Abschluss ist noch nicht bestätigt. Diese Änderung wurde noch nicht gesendet.";
        adapter.changed();
        return { ok: false, kind: "unconfirmed", error: operation.error };
      }
      removing.set(id, task.id);
      adapter.changed();
      try {
        const result = await adapter.removeTask(task, action, reason);
        if (!adapter.isActive() || adapter.generation() !== generation) return { ok: false, kind: "sessionSuperseded", error: "Die Sitzung wurde ersetzt.", status: 409 };
        if (action === "withdraw" && !result.affectedTaskIds?.includes(task.id)) throw new Error("Der Umfang des Zurückziehens ist noch nicht bestätigt.");
        const ids = result.affectedTaskIds ? new Set(result.affectedTaskIds) : subtreeIds(adapter.current(), new Set([task.id]));
        for (const taskId of ids) removed.add(taskId);
        removing.delete(id);
        adapter.acceptRemoval(ids, action, task.id);
        operation.phase = "saved";
        adapter.changed();
        return { ok: true, excludedTaskIds: [...ids] };
      } catch (error) {
        if (!adapter.isActive() || adapter.generation() !== generation) return { ok: false, kind: "sessionSuperseded", error: "Die Sitzung wurde ersetzt.", status: 409 };
        const failure = error && typeof error === "object" ? error as { status?: number; code?: string } : {};
        const rejected = typeof failure.status === "number" && failure.status < 500 && failure.code !== "session_superseded";
        operation.phase = rejected ? "rejected" : "unconfirmed";
        operation.error = error instanceof Error ? error.message : "Aufgabe konnte nicht entfernt werden.";
        if (rejected) removing.delete(id);
        adapter.changed();
        return { ok: false, kind: rejected ? "rejected" : "unconfirmed", error: operation.error, status: failure.status };
      }
    },
    async createTask(input: PlanningTaskCreationInput): Promise<PlanningTaskCreationResult> {
      if (!adapter.isActive()) return { ok: false, kind: "sessionSuperseded", error: "Die Sitzung wurde ersetzt.", status: 409 };
      if (!adapter.createTask) return { ok: false, kind: "rejected", error: "Erstellen ist nicht verfügbar." };
      if (operations.has(input.creationRequestId) && operations.get(input.creationRequestId)!.phase !== "rejected") return { ok: false, kind: "unconfirmed", error: "Diese Erstellungsanfrage wurde bereits abgesendet." };
      const submitted = structuredClone(input);
      const generation = adapter.generation();
      const started = adapter.capture();
      const related = adapter.current().tasks.find(task => task.id === input.relatedTaskId);
      const relatedBasis = related ? { id: related.id, updatedAt: related.updatedAt } : undefined;
      const local = temporaryTask(submitted, adapter.current());
      const operation: PlanningTaskLifecycleView = { id: input.creationRequestId, kind: "create", phase: "saving", submitted, taskId: local.id, error: "", checkStatus: "not-checked" };
      operations.set(operation.id, operation);
      if (isRemoving(local)) {
        operation.phase = "blocked";
        operation.error = "Das Entfernen des übergeordneten Elements ist noch nicht bestätigt. Diese Erstellung wurde noch nicht gesendet.";
        adapter.changed();
        return { ok: false, kind: "unconfirmed", error: operation.error };
      }
      if (isRemoved(local)) {
        operation.phase = "rejected";
        operation.error = "Das übergeordnete Element wurde entfernt.";
        adapter.changed();
        return { ok: false, kind: "rejected", error: operation.error };
      }
      temporary.set(operation.id, local);
      adapter.changed();
      try {
        const result = await adapter.createTask(submitted);
        if (!adapter.isActive() || adapter.generation() !== generation) return { ok: false, kind: "sessionSuperseded", error: "Die Sitzung wurde ersetzt.", status: 409 };
        if (!result.task.id || !result.task.updatedAt) throw new Error("Die Erstellung ist noch nicht bestätigt.");
        if (isRemoved(result.task)) {
          temporary.delete(operation.id);
          operation.phase = "rejected";
          operation.error = "Das übergeordnete Element wurde entfernt.";
          adapter.changed();
          return { ok: false, kind: "rejected", error: operation.error };
        }
        if (result.relation) createdRelations.set(result.relation.id, { relation: result.relation, acceptedAt: adapter.capture() });
        adapter.acceptCreation(result, started, relatedBasis);
        temporary.delete(operation.id);
        operation.phase = result.approvalError ? "partiallyConfirmed" : "saved";
        operation.taskId = result.task.id;
        operation.error = result.approvalError || "";
        adapter.changed();
        return result.approvalError ? { ok: false, kind: "partiallyConfirmed", task: result.task, error: result.approvalError } : { ok: true, task: result.task };
      } catch (error) {
        if (!adapter.isActive() || adapter.generation() !== generation) return { ok: false, kind: "sessionSuperseded", error: "Die Sitzung wurde ersetzt.", status: 409 };
        const failure = error && typeof error === "object" ? error as { status?: number; code?: string } : {};
        const rejected = typeof failure.status === "number" && failure.status < 500 && failure.code !== "session_superseded";
        operation.phase = rejected ? "rejected" : "unconfirmed";
        operation.error = error instanceof Error ? error.message : "Aufgabe konnte nicht erstellt werden.";
        if (rejected) temporary.delete(operation.id);
        adapter.changed();
        return { ok: false, kind: rejected ? "rejected" : "unconfirmed", error: operation.error, status: failure.status };
      }
    },
  };
}
