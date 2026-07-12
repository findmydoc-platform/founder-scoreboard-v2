export type TaskPanelOpenMode = "start" | "push";

export function currentTaskPanelId(history: string[]) {
  return history.at(-1) || null;
}

export function startTaskPanelHistory(taskId: string, availableTaskIds: Set<string>) {
  return availableTaskIds.has(taskId) ? [taskId] : [];
}

export function pushTaskPanelHistory(history: string[], taskId: string, availableTaskIds: Set<string>) {
  if (!availableTaskIds.has(taskId) || currentTaskPanelId(history) === taskId) return history;
  return [...history.filter((historyTaskId) => historyTaskId !== taskId), taskId];
}

export function backTaskPanelHistory(history: string[]) {
  return history.length > 1 ? history.slice(0, -1) : history;
}

export function closeTaskPanelHistory() {
  return [] as string[];
}

export function normalizeTaskPanelHistory(history: string[], availableTaskIds: Set<string>) {
  return history.filter((taskId) => availableTaskIds.has(taskId));
}

export type TaskReferencePointerIntent = {
  button: number;
  altKey: boolean;
  ctrlKey: boolean;
  metaKey: boolean;
  shiftKey: boolean;
};

export function shouldOpenTaskReferenceInPanel(intent: TaskReferencePointerIntent) {
  return intent.button === 0
    && !intent.altKey
    && !intent.ctrlKey
    && !intent.metaKey
    && !intent.shiftKey;
}
