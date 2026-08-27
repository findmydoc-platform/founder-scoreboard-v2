import type { Profile, Task, TaskFocusItem, TaskRelationType } from "./types";

export const unassignedAssigneeLabel = "Nicht zugeordnet";

export function formatDate(value: string, options: { includeYear?: boolean } = {}) {
  if (!value) return "ohne Datum";
  if (!/^\d{4}-\d{2}-\d{2}(?:T|$)/.test(value)) return value;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "short",
    ...(options.includeYear ? { year: "numeric" } : {}),
  }).format(date);
}

type DateRangeValue = Readonly<{ startDate: string; endDate: string }>;

export function dateRange(value: DateRangeValue, options: { includeYear?: boolean } = {}) {
  if (!value.startDate && !value.endDate) return "ohne Zeitraum";
  if (value.startDate === value.endDate) return formatDate(value.startDate, options);
  return `${formatDate(value.startDate, options)} - ${formatDate(value.endDate, options)}`;
}

function parseDisplayDate(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function compactDateRange(
  value: DateRangeValue,
) {
  const startValue = value.startDate || value.endDate;
  const endValue = value.endDate || value.startDate;
  if (!startValue || !endValue) return "Zeitraum offen";

  const start = parseDisplayDate(startValue);
  const end = parseDisplayDate(endValue);
  if (!start || !end) return startValue === endValue ? startValue : `${startValue}–${endValue}`;

  const day = new Intl.DateTimeFormat("de-DE", { day: "2-digit" });
  const month = new Intl.DateTimeFormat("de-DE", { month: "long" });
  const full = new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "long", year: "numeric" });
  const sameDay = start.getFullYear() === end.getFullYear()
    && start.getMonth() === end.getMonth()
    && start.getDate() === end.getDate();
  if (sameDay) return `${day.format(start)}. ${month.format(start)}`;

  const sameYear = start.getFullYear() === end.getFullYear();
  const sameMonth = sameYear && start.getMonth() === end.getMonth();
  if (sameMonth) return `${day.format(start)}.–${day.format(end)}. ${month.format(end)}`;
  if (sameYear) return `${day.format(start)}. ${month.format(start)}–${day.format(end)}. ${month.format(end)}`;
  return `${full.format(start)}–${full.format(end)}`;
}

export function taskAssigneeLabel(task: Pick<Task, "assignee"> | { assignee: string }) {
  return task.assignee || unassignedAssigneeLabel;
}

export function taskAssigneeOptions(taskType: Task["taskType"], profiles: Profile[]) {
  const options = profiles.map((profile) => ({ value: profile.id, label: profile.name }));
  return options;
}

export function initiativeOptionLabel(initiative: Task) {
  return initiative.title;
}

export function initiativeStatusLabel(status?: string) {
  if (status === "In Arbeit") return "aktiv";
  if (status === "Erledigt") return "erledigt";
  if (status === "Pausiert") return "pausiert";
  return "offen";
}

export function initiativeMetaLabel(initiative: Task) {
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

export function initiativeRaciRows(initiative: Task, profiles: Profile[]) {
  const assignments = initiative.raciAssignments || [];
  const profileIds = (role: "accountable" | "responsible" | "consulted" | "informed") => assignments
    .filter((assignment) => assignment.role === role)
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map((assignment) => assignment.profileId);
  const accountable = profileIds("accountable")[0] || initiative.ownerId;
  const responsible = profileIds("responsible");
  return [
    { label: "A", title: "Accountable", value: profileNameById(profiles, accountable) },
    { label: "R", title: "Responsible", value: profileNamesByIds(profiles, responsible.length ? responsible : initiative.ownerId ? [initiative.ownerId] : []) },
    { label: "C", title: "Consulted", value: profileNamesByIds(profiles, profileIds("consulted")) },
    { label: "I", title: "Informed", value: profileNamesByIds(profiles, profileIds("informed")) },
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
