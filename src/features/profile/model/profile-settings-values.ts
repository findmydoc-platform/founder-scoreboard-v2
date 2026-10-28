import { quickFilters, viewTabs } from "@/features/planning/model/planning-app-model";
import { workspaceRoutes } from "@/features/planning/model/workspace-routes";
import { formatDate } from "@/lib/display";
import { notificationEventLabel } from "@/lib/notification-policy";
import type { PlanningShellState } from "@/lib/types";
import type { OwnProfileSettingsPatch } from "./profile-settings-contract";

export function ownProfileSettingsValues(patch: OwnProfileSettingsPatch, data: Pick<PlanningShellState, "profiles" | "tasks" | "sprints">): [string, string][] {
  const values: [string, string][] = [];
  const profile = patch.profilePatch;
  if (profile && "focus" in profile) values.push(["Fokus", profile.focus || "Leer"]);
  if (profile && "color" in profile) values.push(["Farbe", profile.color || "Standard"]);
  if (profile && "notificationsEnabled" in profile) values.push(["Google-Chat-Hinweise", profile.notificationsEnabled === false ? "Aus" : "An"]);
  for (const [event, enabled] of Object.entries(patch.notificationEvents || {})) values.push([notificationEventLabel(event), enabled ? "An" : "Aus"]);
  const ui = patch.uiPreferences;
  if (!ui) return values;
  values.push(["Startbereich", workspaceRoutes.find(route => route.id === ui.defaultWorkspace)?.label || "Nicht verfügbar"]);
  values.push(["Aufgabenansicht", viewTabs.find(view => view.id === ui.defaultTaskView)?.label || "Nicht verfügbar"]);
  const filters = ui.planningFilters;
  const profileName = (value: string) => value === "Alle" ? "Alle" : data.profiles.find(person => person.id === value || person.name === value)?.name || "Person nicht verfügbar";
  const taskName = (value: string) => value === "Alle" ? "Alle" : data.tasks.find(task => task.id === value)?.title || "Aufgabe nicht verfügbar";
  const filterLabels: Record<string, string> = { requested: "Angefragt", accepted: "Akzeptiert", partial: "Kleine Nacharbeit", changes_requested: "Grundlegend überarbeiten", not_requested: "Nicht angefragt", critical: "Kritisch", blocked: "Blockiert", evidence: "Nachweis fehlt", github: "GitHub fehlt" };
  const label = (value: string) => !value || value === "Alle" ? "Alle" : filterLabels[value] || "Nicht verfügbar";
  values.push(
    ["Filter: Zuständig", profileName(filters.assignee)],
    ["Filter: Status", filters.status], ["Filter: Priorität", filters.priority],
    ["Filter: Initiative", taskName(filters.initiativeId)],
    ["Filter: Sprint", filters.sprintId === "Alle" ? "Alle" : data.sprints.find(sprint => sprint.id === filters.sprintId)?.name || "Sprint nicht verfügbar"],
    ["Filter: Review", label(filters.review)], ["Filter: Arbeitsbereich", filters.workstream || "Alle"], ["Filter: Risiko", label(filters.risk)],
    ["Filter: Suche", filters.query || "Leer"],
    ["Filter: Zieltermin von", filters.targetFrom ? formatDate(filters.targetFrom, { includeYear: true }) : "Offen"],
    ["Filter: Zieltermin bis", filters.targetTo ? formatDate(filters.targetTo, { includeYear: true }) : "Offen"],
    ["Schnellfilter", filters.quick.map(value => quickFilters.find(filter => filter.id === value)?.label || "Filter nicht verfügbar").join(", ") || "Keine"],
    ["Sortierung", ({ priority: "Priorität", title: "Titel", status: "Status", assignee: "Zuständig", sprint: "Sprint", start: "Start", fixedDate: "Fixtermin", targetDate: "Zieltermin", hours: "Aufwand", updatedAt: "Zuletzt geändert" } as Record<string, string>)[filters.sort] || "Nicht verfügbar"],
    ["Reihenfolge", filters.direction === "desc" ? "Absteigend" : "Aufsteigend"],
    ["Aufgeklappte Initiativen", ui.expandedInitiativeIds.map(id => data.tasks.find(task => task.id === id)?.title || "Initiative nicht verfügbar").join(", ") || "Keine"],
  );
  return values;
}
