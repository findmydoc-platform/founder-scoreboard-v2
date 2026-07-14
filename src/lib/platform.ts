import type { Profile, Task, TaskRelation, TaskRelationType } from "./types";

export function isOperationalLeadRole(role?: Profile["platformRole"] | null) {
  return role === "ceo" || role === "deputy";
}

export function reviewLabel(status: Task["reviewStatus"]) {
  const labels: Record<Task["reviewStatus"], string> = {
    not_requested: "Nicht angefragt",
    requested: "Review angefragt",
    accepted: "Akzeptiert",
    partial: "Teilweise akzeptiert",
    changes_requested: "Änderungen angefordert",
  };
  return labels[status];
}

export function syncLabel(status: Task["githubIssueSyncStatus"]) {
  const labels: Record<Task["githubIssueSyncStatus"], string> = {
    not_synced: "Nicht synchronisiert",
    pending: "Sync offen",
    synced: "Synchronisiert",
    failed: "Sync fehlgeschlagen",
  };
  return labels[status];
}

export function hasGitHubIssue(task: Pick<Task, "githubIssueNumber" | "githubIssueUrl" | "issueNumber" | "issueUrl">) {
  return Boolean(
    task.githubIssueNumber ||
    task.githubIssueUrl ||
    task.issueNumber ||
    task.issueUrl.includes("github.com"),
  );
}

export function relationLabel(type: TaskRelationType) {
  if (type === "blocked_by") return "Wartet auf";
  if (type === "blocks") return "Blockiert";
  return "Verknüpft mit";
}

export type EffectiveTaskRelation = {
  direction: "waitsOn" | "blocks" | "related";
  linkedTaskId: string;
};

export function effectiveTaskRelation(taskId: string, relation: TaskRelation): EffectiveTaskRelation | null {
  const outgoing = relation.taskId === taskId;
  const incoming = relation.relatedTaskId === taskId;
  if (!outgoing && !incoming) return null;

  const linkedTaskId = outgoing ? relation.relatedTaskId : relation.taskId;
  if (!linkedTaskId || linkedTaskId === taskId) return null;

  if (relation.relationType === "relates_to") return { direction: "related", linkedTaskId };
  if (relation.relationType === "blocked_by") {
    return { direction: outgoing ? "waitsOn" : "blocks", linkedTaskId };
  }
  return { direction: outgoing ? "blocks" : "waitsOn", linkedTaskId };
}

export function taskRelationsFor(taskId: string, relations: TaskRelation[]) {
  const waitsOn: TaskRelation[] = [];
  const blocks: TaskRelation[] = [];
  const related: TaskRelation[] = [];

  relations.forEach((relation) => {
    const effective = effectiveTaskRelation(taskId, relation);
    if (!effective) return;
    if (effective.direction === "waitsOn") waitsOn.push(relation);
    else if (effective.direction === "blocks") blocks.push(relation);
    else related.push(relation);
  });

  return { waitsOn, blocks, related };
}

export function hasOpenWaitingRelation(taskId: string, tasks: Task[], relations: TaskRelation[]) {
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  return taskRelationsFor(taskId, relations).waitsOn.some((relation) => {
    const blockingTaskId = effectiveTaskRelation(taskId, relation)?.linkedTaskId;
    const blockingTask = blockingTaskId ? taskById.get(blockingTaskId) : undefined;
    return blockingTask && blockingTask.status !== "Erledigt";
  });
}

export function roleLabel(profile: Profile) {
  if (profile.platformRole === "ceo") return "CEO";
  if (profile.platformRole === "deputy") return "Deputy";
  if (profile.platformRole === "viewer") return "Viewer";
  return "Founder";
}

export function calculateTaskScore(task: Task) {
  if (task.reviewStatus === "accepted") return Math.max(task.scorePoints, 3);
  if (task.reviewStatus === "partial") return Math.max(task.scorePoints, 1);
  return task.scoreFinal ? task.scorePoints : 0;
}

export function taskBelongsToProfile(task: Pick<Task, "assignee" | "assigneeId" | "owner" | "ownerId">, profile?: Pick<Profile, "id" | "name"> | null) {
  if (!profile) return false;
  if (task.assigneeId) return task.assigneeId === profile.id;
  if (task.assignee) return task.assignee === profile.name || task.assignee === profile.id;
  if (task.ownerId) return task.ownerId === profile.id;
  return task.owner === profile.name || task.owner === profile.id;
}

export function founderScore(tasks: Task[], profile: Profile) {
  const assigned = tasks.filter((task) => taskBelongsToProfile(task, profile));
  return {
    profile,
    committed: assigned.length,
    reviewReady: assigned.filter((task) => task.reviewStatus === "requested").length,
    finalPoints: assigned.reduce((sum, task) => sum + calculateTaskScore(task), 0),
    openScore: assigned.filter((task) => !task.scoreFinal).length,
  };
}
