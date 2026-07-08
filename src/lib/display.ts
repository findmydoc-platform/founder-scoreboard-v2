import type { Package, Profile, Task, TaskFocusItem, TaskRelationType } from "./types";

export const unassignedAssigneeLabel = "Nicht zugeordnet";

export function formatDate(value: string, options: { includeYear?: boolean } = {}) {
  if (!value) return "ohne Datum";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "short",
    ...(options.includeYear ? { year: "numeric" } : {}),
  }).format(date);
}

export function dateRange(task: Pick<Task, "startDate" | "endDate" | "deadline">, options: { includeYear?: boolean } = {}) {
  if (!task.startDate && !task.endDate) return task.deadline || "ohne Datum";
  if (task.startDate === task.endDate) return formatDate(task.startDate, options);
  return `${formatDate(task.startDate, options)} - ${formatDate(task.endDate, options)}`;
}

export function taskAssigneeLabel(task: Pick<Task, "assignee"> | { assignee: string }) {
  return task.assignee || unassignedAssigneeLabel;
}

export function taskAssigneeOptions(taskType: Task["taskType"], profiles: Profile[]) {
  const options = profiles.map((profile) => ({ value: profile.id, label: profile.name }));
  return taskType === "proposal" ? [{ value: "", label: unassignedAssigneeLabel }, ...options] : options;
}

export function initiativeOptionLabel(initiative: Package) {
  return initiative.title;
}

export function initiativeStatusLabel(status?: Package["status"]) {
  if (status === "active") return "aktiv";
  if (status === "done") return "erledigt";
  if (status === "paused") return "pausiert";
  return "geplant";
}

export function initiativeMetaLabel(initiative: Package) {
  return `Initiative · ${initiative.priority} · ${initiativeStatusLabel(initiative.status)}`;
}

export function profileNameById(profiles: Profile[], profileId?: string) {
  return profiles.find((profile) => profile.id === profileId)?.name || "Nicht gesetzt";
}

export function profileNamesByIds(profiles: Profile[], profileIds?: string[]) {
  const names = (profileIds || [])
    .map((profileId) => profiles.find((profile) => profile.id === profileId)?.name || "")
    .filter(Boolean);
  return names.length ? names.join(", ") : "Nicht gesetzt";
}

export function initiativeRaciRows(initiative: Package, profiles: Profile[]) {
  return [
    { label: "A", title: "Accountable", value: profileNameById(profiles, initiative.accountableProfileId || initiative.ownerId) },
    { label: "R", title: "Responsible", value: profileNamesByIds(profiles, initiative.responsibleProfileIds?.length ? initiative.responsibleProfileIds : initiative.ownerId ? [initiative.ownerId] : []) },
    { label: "C", title: "Consulted", value: profileNamesByIds(profiles, initiative.consultedProfileIds) },
    { label: "I", title: "Informed", value: profileNamesByIds(profiles, initiative.informedProfileIds) },
  ];
}

export function relationTypeLabel(type: TaskRelationType) {
  if (type === "blocked_by") return "Wartet auf";
  if (type === "blocks") return "Blockiert";
  return "Verknüpft mit";
}

export function relationshipHelpText(title: string) {
  if (title === "Wartet auf") return "Diese Aufgabe kann erst sauber weitergehen, wenn die verknüpfte Aufgabe erledigt oder ausreichend geklärt ist.";
  if (title === "Blockiert") return "Diese Aufgabe hält andere Aufgaben auf. Wenn sie verspätet ist, können die gelisteten Aufgaben ebenfalls nicht sauber abgeschlossen werden.";
  if (title === "Verknüpft mit") return "Diese Aufgaben hängen fachlich zusammen, blockieren sich aber nicht zwingend gegenseitig.";
  return "Zeigt, wie diese Aufgabe mit anderen Aufgaben verbunden ist.";
}

export function focusStatusLabel(status: TaskFocusItem["status"]) {
  if (status === "done") return "Erledigt";
  if (status === "blocked") return "Blockiert";
  if (status === "deferred") return "Verschoben";
  if (status === "needs_decision") return "Entscheidung nötig";
  return "Geplant";
}
