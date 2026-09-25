export type TaskCommentTarget = `local:${string}` | `github:${string}` | `review:${string}` | `activity:${string}` | `field:${string}` | `blocker:${string}` | `relation:${string}`;

export const taskMentionFieldTargetIds = Object.freeze({
  description: "task-field-description",
  problem: "task-field-problem",
  outcome: "task-review-outcome",
  scope: "task-field-scope",
  acceptance: "task-review-acceptance",
  "evidence-required": "task-review-evidence",
  "definition-of-done": "task-field-definition-of-done",
  "strategy-goal": "task-field-strategy-goal",
  "strategy-success": "task-field-strategy-success",
  "strategy-scope": "task-field-strategy-scope",
  "review-evidence-exception": "task-review-evidence-exception",
});

export function localTaskCommentTarget(commentId: string | number): TaskCommentTarget {
  return `local:${commentId}`;
}

export function githubTaskCommentTarget(externalId: string | number): TaskCommentTarget {
  return `github:${externalId}`;
}

export function taskReviewTarget(reviewId: string | number): TaskCommentTarget {
  return `review:${reviewId}`;
}

export function parseTaskCommentTarget(value: unknown): TaskCommentTarget | "" {
  return typeof value === "string" && /^(?:local|github|review|activity|field|blocker|relation):[\w.-]+$/u.test(value)
    ? value as TaskCommentTarget
    : "";
}

export function taskCommentElementId(target: TaskCommentTarget | string) {
  return `task-comment-${target}`;
}
