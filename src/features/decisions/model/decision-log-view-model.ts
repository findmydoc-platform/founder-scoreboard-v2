import type { DecisionTaskLink, PlanningData, Task } from "@/lib/types";

export type DecisionItem = PlanningData["decisions"][number];
export type DecisionComment = PlanningData["decisionComments"][number];
export type DecisionAuditEntry = PlanningData["audit"][number];

export type DecisionPayload = {
  title: string;
  context: string;
  decision: string;
  requiredProfileIds: string[];
};

export type DecisionEditDraft = DecisionPayload;

export type DecisionLinkedTask = {
  link: DecisionTaskLink;
  task: Task;
};

export function decisionStatusLabel(status: DecisionItem["status"]) {
  if (status === "locked") return "Gelockt";
  if (status === "open_for_confirmation") return "Zur Bestätigung offen";
  return "Entwurf";
}

export function decisionAuditEntries(data: PlanningData, decisionId: number) {
  return data.audit
    .filter((entry) => entry.entityType === "decision" && entry.entityId === String(decisionId))
    .slice(0, 8);
}

export function decisionLinkedTasks(data: PlanningData, decisionId: number): DecisionLinkedTask[] {
  return data.decisionTaskLinks
    .filter((link) => link.decisionId === decisionId)
    .map((link) => ({ link, task: data.tasks.find((task) => task.id === link.taskId) }))
    .filter((item): item is DecisionLinkedTask => Boolean(item.task));
}
