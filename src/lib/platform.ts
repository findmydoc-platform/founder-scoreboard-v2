import type { Profile, Task } from "./types";

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

export function founderScore(tasks: Task[], profile: Profile) {
  const owned = tasks.filter((task) => task.owner === profile.name);
  return {
    profile,
    committed: owned.length,
    reviewReady: owned.filter((task) => task.reviewStatus === "requested").length,
    finalPoints: owned.reduce((sum, task) => sum + calculateTaskScore(task), 0),
    openScore: owned.filter((task) => !task.scoreFinal).length,
  };
}
