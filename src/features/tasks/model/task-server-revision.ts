import type { Task } from "@/lib/types";

export type TaskServerRevisionStore = {
  current: Map<string, string>;
};

export function rememberTaskServerRevision(
  store: TaskServerRevisionStore,
  taskId: string,
  updatedAt?: string,
) {
  if (updatedAt) store.current.set(taskId, updatedAt);
}

export function taskServerRevision(
  store: TaskServerRevisionStore,
  task: Pick<Task, "id" | "updatedAt">,
) {
  return store.current.get(task.id) || task.updatedAt || "";
}
