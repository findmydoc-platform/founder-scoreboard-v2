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

export function syncLabel(status: Task["githubSyncStatus"]) {
  const labels: Record<Task["githubSyncStatus"], string> = {
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

export function taskRelationsFor(taskId: string, relations: TaskRelation[]) {
  const waitsOn = relations.filter((relation) => relation.taskId === taskId && relation.relationType === "blocked_by");
  const blocks = relations.filter((relation) =>
    (relation.taskId === taskId && relation.relationType === "blocks") ||
    (relation.relatedTaskId === taskId && relation.relationType === "blocked_by")
  );
  const related = relations.filter((relation) =>
    relation.relationType === "relates_to" &&
    (relation.taskId === taskId || relation.relatedTaskId === taskId)
  );

  return { waitsOn, blocks, related };
}

export function hasOpenWaitingRelation(taskId: string, tasks: Task[], relations: TaskRelation[]) {
  const taskById = new Map(tasks.map((task) => [task.id, task]));
  return taskRelationsFor(taskId, relations).waitsOn.some((relation) => {
    const blockingTask = taskById.get(relation.relatedTaskId);
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

export function taskBelongsToProfile(task: Pick<Task, "owner" | "ownerId">, profile?: Pick<Profile, "id" | "name"> | null) {
  if (!profile) return false;
  if (task.ownerId) return task.ownerId === profile.id;
  return task.owner === profile.name;
}

export function founderScore(tasks: Task[], profile: Profile) {
  const owned = tasks.filter((task) => taskBelongsToProfile(task, profile));
  return {
    profile,
    committed: owned.length,
    reviewReady: owned.filter((task) => task.reviewStatus === "requested").length,
    finalPoints: owned.reduce((sum, task) => sum + calculateTaskScore(task), 0),
    openScore: owned.filter((task) => !task.scoreFinal).length,
  };
}
