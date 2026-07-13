import type { DriveStep } from "driver.js";
import type { AppWorkspace } from "@/features/planning/model/workspace-routes";

export type FeatureTourDefinition = {
  doneWorkspace?: AppWorkspace;
  id: string;
  openAccountMenu?: boolean;
  requiredSelectors: readonly string[];
  startWorkspace?: AppWorkspace;
  steps: readonly DriveStep[];
  workspaceScope?: AppWorkspace;
};

export const workspaceCleanupTourId = "workspace-cleanup-v2";
export const profileSettingsTourId = "profile-settings-v1";
export const planningMyTasksScopeTourId = "planning-my-tasks-scope-v1";
export const backlogTourId = "backlog-prioritization-v1";

export const featureTours = [
  {
    id: backlogTourId,
    workspaceScope: "backlog",
    requiredSelectors: ["[data-tour-id='backlog-overview']"],
    steps: [
      {
        element: "[data-tour-id='backlog-overview']",
        popover: {
          title: "Backlog priorisieren",
          description: "Hier entscheidet ihr die Reihenfolge. Die Priorität bleibt fachliche Dringlichkeit, der Rang zeigt, was als Nächstes in einen Sprint gezogen werden soll.",
          side: "bottom",
          align: "start",
        },
      },
      {
        element: "[data-tour-id='backlog-scope-tabs']",
        popover: {
          title: "Vorschläge sind hier gebündelt",
          description: "Vorschläge sind aus dem Planning-Board raus. Im Backlog kannst du sie getrennt prüfen, vorbereiten und erst dann für einen Sprint einplanen.",
          side: "bottom",
          align: "start",
        },
      },
      {
        element: "[data-tour-id='backlog-rank-table']",
        popover: {
          title: "Rangfolge statt Statusspalte",
          description: "Ziehe Aufgaben am Griff nach oben oder unten. Das Aktionsmenü bietet dieselben Rangaktionen für Tastatur und Touch.",
          side: "top",
          align: "start",
        },
      },
      {
        element: "[data-tour-id='backlog-sprint-pane']",
        popover: {
          title: "In Sprints ziehen",
          description: "Ziehe freigegebene, vollständige Deliverables auf einen offenen Sprint oder wähle ihn im Aktionsmenü. Der Sprint bleibt ein Zeitcontainer.",
          side: "left",
          align: "start",
          doneBtnText: "Verstanden",
        },
      },
    ] satisfies DriveStep[],
  },
  {
    id: workspaceCleanupTourId,
    openAccountMenu: true,
    doneWorkspace: "profile",
    requiredSelectors: ["[data-tour-id='workspace-nav-planning']", "[data-tour-id='profile-menu-link']"],
    steps: [
      {
        element: "[data-tour-id='workspace-nav-planning']",
        popover: {
          title: "Navigation bereinigt",
          description: "Die Navigation zeigt nur aktive Arbeitsbereiche. Meeting Finder und Decision Log sind nicht geparkt; eine Rückkehr wäre eine neu gedachte Aggregation, kein Rebuild der alten Menüpunkte.",
          side: "right",
          align: "center",
        },
      },
      {
        element: "[data-tour-id='workspace-nav-sprint']",
        popover: {
          title: "Weekly Updates bleiben hier",
          description: "Anwesenheit, Rückmeldung, akzeptierter Grund und Punkte werden weiter in Sprint & Score gepflegt.",
          side: "right",
          align: "center",
        },
      },
      {
        element: "[data-tour-id='profile-menu-link']",
        popover: {
          title: "Profil-Einstellungen sind schlanker",
          description: "Kalender und Verfügbarkeit sind aus dem Profil raus. Übrig bleiben Profil, Benachrichtigungen und Board-Defaults.",
          side: "left",
          align: "start",
          doneBtnText: "Profil öffnen",
        },
      },
    ] satisfies DriveStep[],
  },
  {
    id: planningMyTasksScopeTourId,
    workspaceScope: "planning",
    requiredSelectors: ["[data-tour-id='planning-task-scope']"],
    steps: [
      {
        element: "[data-tour-id='planning-task-scope']",
        popover: {
          title: "Meine Aufgaben",
          description: "Meine filtert die Planung auf Aufgaben, für die du zuständig bist. Board, Struktur, Tabelle und Gantt bleiben die Ansicht.",
          side: "bottom",
          align: "start",
        },
      },
    ] satisfies DriveStep[],
  },
  {
    id: profileSettingsTourId,
    openAccountMenu: true,
    doneWorkspace: "profile",
    requiredSelectors: ["[data-tour-id='account-menu-trigger']", "[data-tour-id='profile-menu-link']"],
    steps: [
      {
        element: "[data-tour-id='account-menu-trigger']",
        popover: {
          title: "Profil-Einstellungen",
          description: "Deine persönlichen Einstellungen liegen jetzt im Account-Menü.",
          side: "bottom",
          align: "end",
        },
      },
      {
        element: "[data-tour-id='profile-menu-link']",
        popover: {
          title: "Mein Profil",
          description: "Hier öffnest du Profil, Benachrichtigungen und Board-Defaults.",
          side: "left",
          align: "start",
          doneBtnText: "Profil öffnen",
        },
      },
    ] satisfies DriveStep[],
  },
] as const satisfies readonly FeatureTourDefinition[];
