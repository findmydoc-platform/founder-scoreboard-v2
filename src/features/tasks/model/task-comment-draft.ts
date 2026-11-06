export type TaskCommentDraft = Readonly<{
  text: string;
  update(value: string | ((current: string) => string)): void;
  clear(): void;
}>;

export interface PlanningTaskCommentDrafts {
  taskCommentDraft(taskId: string): TaskCommentDraft;
}
