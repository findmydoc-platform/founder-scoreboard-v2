export type TaskCommentTarget = `local:${string}` | `github:${string}`;

export function localTaskCommentTarget(commentId: string | number): TaskCommentTarget {
  return `local:${commentId}`;
}

export function githubTaskCommentTarget(externalId: string | number): TaskCommentTarget {
  return `github:${externalId}`;
}

export function parseTaskCommentTarget(value: unknown): TaskCommentTarget | "" {
  return typeof value === "string" && /^(?:local|github):[\w.-]+$/u.test(value)
    ? value as TaskCommentTarget
    : "";
}

export function taskCommentElementId(target: TaskCommentTarget | string) {
  return `task-comment-${target}`;
}
