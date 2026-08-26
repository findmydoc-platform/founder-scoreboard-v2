import type { DriveStep } from "driver.js";
import type { AppWorkspace } from "@/features/planning/model/workspace-routes";
import type { ViewMode } from "@/lib/types";

export type FeatureTourStepTransition = {
  view?: ViewMode;
  workspace?: AppWorkspace;
};

export type FeatureTourDefinition = {
  doneWorkspace?: AppWorkspace;
  id: string;
  openAccountMenu?: boolean;
  openHelpMenu?: boolean;
  openProfileProcessSettings?: boolean;
  openProfileApiSettings?: boolean;
  openTaskDetail?: boolean;
  openTaskShare?: boolean;
  productUpdateId?: string;
  requiredSelectors: readonly string[];
  startWorkspace?: AppWorkspace;
  /** Transition after the step at the matching index, before the next step is shown. */
  stepTransitions?: readonly (FeatureTourStepTransition | undefined)[];
  steps: readonly DriveStep[];
  workspaceScope?: AppWorkspace;
};

export const workspaceCleanupTourId = "workspace-cleanup-v2";
export const profileSettingsTourId = "profile-settings-v1";
export const planningMyTasksScopeTourId = "planning-my-tasks-scope-v1";
export const backlogTourId = "backlog-prioritization-v1";
export const productUpdatesTourId = "product-updates-v1";
export const taskActivityTourId = "task-activity-v1";
export const decisionLogTourId = "decision-log-workspace-v1";
export const issueSharingTourId = "issue-sharing-v1";
export const modalOverlayStackTourId = "modal-overlay-stack-v1";
export const githubProjectSettingsTourId = "github-project-settings-v1";
export const taskEvidenceLinksTourId = "task-evidence-links-v1";
export const unifiedPlanningHierarchyTourId = "unified-planning-hierarchy-v1";
export const planningApiV2TourId = "planning-api-v2";
export const mobileResponsiveWorkspacesTourId = "mobile-responsive-workspaces-v1";
export const platformReleasesTourId = "platform-releases-v1";
export const githubIssueWebhookSyncTourId = "github-issue-webhook-sync-v1";
export const teamWorkweekTourId = "team-workweek-v1";

export const featureTours: readonly FeatureTourDefinition[] = [
  {
    id: teamWorkweekTourId,
    productUpdateId: "2026-08-25-team-workweek",
    startWorkspace: "planning",
    requiredSelectors: ["[data-tour-id='header-calendar-action']"],
    steps: [
      {
        element: "[data-tour-id='header-calendar-action']",
        popover: {
          title: "Gemeinsamen Kalender öffnen",
          description: "Termine zeigt FounderOps-Events und die veröffentlichten Arbeitszeiten des ausgewählten Tages in einer Ansicht.",
          side: "bottom",
          align: "end",
        },
      },
      {
        element: "[data-tour-id='header-calendar-action']",
        popover: {
          title: "Arbeitswoche vergleichen",
          description: "Freigegebene Gründerprofile wechseln zum Tab Arbeitswoche. Die eigene Regelwoche bleibt ausschließlich im Team-Bereich bearbeitbar.",
          side: "bottom",
          align: "end",
          doneBtnText: "Verstanden",
        },
      },
    ] satisfies DriveStep[],
  },
  {
    id: githubIssueWebhookSyncTourId,
    productUpdateId: "2026-08-18-github-issue-webhook-sync",
    startWorkspace: "planning",
    openTaskDetail: true,
    requiredSelectors: ["[data-tour-id='task-detail-tab-activity']"],
    steps: [
      {
        element: "[data-tour-id='task-detail-tab-activity']",
        popover: {
          title: "GitHub-Änderungen nachverfolgen",
          description: "Öffne Aktivität, um Updates und Kommentare aus dem verknüpften GitHub-Issue nachzuvollziehen. FounderOps übernimmt nur Änderungen, die für die jeweilige Person und den Prozess erlaubt sind.",
          side: "bottom",
          align: "start",
          doneBtnText: "Verstanden",
        },
      },
    ] satisfies DriveStep[],
  },
  {
    id: platformReleasesTourId,
    productUpdateId: "2026-08-14-platform-releases",
    startWorkspace: "planning",
    requiredSelectors: ["[data-tour-id='workspace-nav-platform-releases']", "[data-tour-id='current-platform-release']"],
    steps: [
      {
        element: "[data-tour-id='workspace-nav-platform-releases']",
        popover: {
          title: "Releases öffnen",
          description: "Hier findest du alle gemeinsamen Auslieferungen von Website und Clinic Dashboard.",
          side: "right",
          align: "center",
        },
      },
      {
        element: "[data-tour-id='current-platform-release']",
        popover: {
          title: "Aktuellen Release direkt ansehen",
          description: "Die Karte zeigt den neuesten Release. Ein blauer Punkt weist auf eine noch ungelesene Auslieferung hin.",
          side: "right",
          align: "end",
          doneBtnText: "Verstanden",
        },
      },
    ] satisfies DriveStep[],
  },
  {
    id: mobileResponsiveWorkspacesTourId,
    productUpdateId: "2026-08-14-mobile-founderops",
    startWorkspace: "planning",
    requiredSelectors: ["[data-tour-id='planning-kanban-level-switch']"],
    stepTransitions: [{ workspace: "sprint" }],
    steps: [
      {
        element: "[data-tour-id='planning-kanban-level-switch']",
        popover: {
          title: "Planung passt sich dem Gerät an",
          description: "Auf Smartphones stehen Statusspalten untereinander, auf iPads zweispaltig. Ebene, Parent-Filter und Aktionen bleiben direkt erreichbar.",
          side: "bottom",
          align: "start",
        },
      },
      {
        element: "[data-tour-id='sprint-responsive-score']",
        popover: {
          title: "Breite Tabellen werden zu Karten",
          description: "Founder Score, Weeklys und Sprint-Aufgaben nutzen auf Smartphone und iPad bedienbare Karten. Ab Desktopbreite bleibt die vollständige Tabelle erhalten.",
          side: "top",
          align: "start",
          doneBtnText: "Verstanden",
        },
      },
    ] satisfies DriveStep[],
  },
  {
    id: planningApiV2TourId,
    productUpdateId: "2026-08-13-planning-api-v2",
    startWorkspace: "profile",
    openProfileApiSettings: true,
    requiredSelectors: ["[data-tour-id='profile-settings-api']", "[data-tour-id='founderops-planning-api-v2']"],
    steps: [
      {
        element: "[data-tour-id='profile-settings-api']",
        popover: {
          title: "API-Zugänge öffnen",
          description: "Hier verwaltest du die persönlichen Tokens, mit denen Skills und Automationen in deinem Namen auf die Planung zugreifen.",
          side: "right",
          align: "center",
        },
      },
      {
        element: "[data-tour-id='founderops-planning-api-v2']",
        popover: {
          title: "V2 ist der neue Standard",
          description: "Neue Integrationen verwenden die aktuelle Planungshierarchie. V1 bleibt nur für die Umstellung bestehen und wird danach entfernt.",
          side: "bottom",
          align: "start",
          doneBtnText: "Verstanden",
        },
      },
    ] satisfies DriveStep[],
  },
  {
    id: unifiedPlanningHierarchyTourId,
    productUpdateId: "2026-07-30-unified-planning-hierarchy",
    startWorkspace: "backlog",
    workspaceScope: "backlog",
    requiredSelectors: ["[data-tour-id='backlog-level-switch']"],
    stepTransitions: [{ workspace: "planning", view: "board" }],
    steps: [
      {
        element: "[data-tour-id='backlog-level-switch']",
        popover: {
          title: "Planungsebene wählen",
          description: "Epics und Initiativen sind jetzt gemeinsam mit Deliverables direkt im Backlog erreichbar.",
          side: "bottom",
          align: "start",
        },
      },
      {
        element: "[data-tour-id='planning-kanban-level-switch']",
        popover: {
          title: "Epics und Initiativen im Kanban",
          description: "Auch im Kanban wechselst du direkt zwischen den Planungsebenen. Weitere Verbesserungen unterstützen Filterung, Fortschritt und Bedienung.",
          side: "bottom",
          align: "start",
          doneBtnText: "Verstanden",
        },
      },
    ] satisfies DriveStep[],
  },
  {
    id: taskEvidenceLinksTourId,
    productUpdateId: "2026-07-24-evidence-links",
    startWorkspace: "planning",
    openTaskDetail: true,
    requiredSelectors: ["[data-tour-id='task-evidence-links']", "[data-tour-id='github-sync-trigger']"],
    steps: [
      {
        element: "[data-tour-id='task-evidence-links']",
        popover: {
          title: "Alle Nachweise im Blick",
          description: "Links stehen kompakt untereinander. Beim Bearbeiten erscheint nach jedem ausgefüllten Link automatisch das nächste leere Feld.",
          side: "left",
          align: "start",
        },
      },
      {
        element: "[data-tour-id='github-sync-trigger']",
        popover: {
          title: "Pull Requests automatisch aktualisieren",
          description: "Der GitHub-Sync übernimmt native Issue-Verknüpfungen und aktualisiert Titel und Status der Pull Requests.",
          side: "bottom",
          align: "end",
          doneBtnText: "Verstanden",
        },
      },
    ] satisfies DriveStep[],
  },
  {
    id: githubProjectSettingsTourId,
    productUpdateId: "2026-07-22-github-project-settings",
    startWorkspace: "profile",
    openProfileProcessSettings: true,
    requiredSelectors: ["[data-tour-id='profile-settings-process']", "[data-tour-id='founderops-github-project-settings']"],
    steps: [
      {
        element: "[data-tour-id='profile-settings-process']",
        popover: {
          title: "FounderOps-Prozess öffnen",
          description: "Die globalen Einstellungen bündeln jetzt auch das repositoryübergreifende GitHub Project.",
          side: "right",
          align: "center",
        },
      },
      {
        element: "[data-tour-id='founderops-github-project-settings']",
        popover: {
          title: "Project prüfen und speichern",
          description: "FounderOps prüft App-Zugriff, alle drei Repository-Verknüpfungen und die erwarteten Felder, bevor das Ziel gespeichert wird.",
          side: "left",
          align: "start",
          doneBtnText: "Verstanden",
        },
      },
    ] satisfies DriveStep[],
  },
  {
    id: modalOverlayStackTourId,
    productUpdateId: "2026-07-21-modal-overlay-stack",
    requiredSelectors: ["[data-tour-id='github-sync-trigger']"],
    startWorkspace: "planning",
    steps: [
      {
        element: "[data-tour-id='github-sync-trigger']",
        popover: {
          title: "GitHub und Item-Details öffnen",
          description: "Öffne GitHub und danach ein Item. Das zuletzt geöffnete Fenster bleibt vorn; beim Schließen kehrst du zuverlässig zur vorherigen Ansicht zurück.",
          side: "bottom",
          align: "end",
          doneBtnText: "Verstanden",
        },
      },
    ] satisfies DriveStep[],
  },
  {
    id: decisionLogTourId,
    doneWorkspace: "decision-log",
    productUpdateId: "2026-07-21-decision-log",
    requiredSelectors: ["[data-tour-id='workspace-nav-decision-log']"],
    steps: [
      {
        element: "[data-tour-id='workspace-nav-decision-log']",
        popover: {
          title: "Decision Log öffnen",
          description: "Hier findest du Entscheidungen aus Notion, den aktuellen Handlungsbedarf und alle vorhandenen Quellen. Die Ansicht ist ausschließlich lesend.",
          side: "right",
          align: "center",
          doneBtnText: "Decision Log öffnen",
        },
      },
    ] satisfies DriveStep[],
  },
  {
    id: taskActivityTourId,
    productUpdateId: "2026-07-21-clear-task-activity",
    requiredSelectors: ["[data-tour-id='planning-task-scope']"],
    startWorkspace: "planning",
    steps: [
      {
        element: "[data-tour-id='planning-task-scope']",
        popover: {
          title: "Aktivität einer Aufgabe öffnen",
          description: "Öffne eine Aufgabe und wechsle zu Aktivität. Dort stehen Kommentare einmalig neben den wichtigsten Änderungen mit passenden Symbolen.",
          side: "bottom",
          align: "start",
          doneBtnText: "Verstanden",
        },
      },
    ] satisfies DriveStep[],
  },
  {
    id: issueSharingTourId,
    startWorkspace: "planning",
    openTaskDetail: true,
    openTaskShare: true,
    productUpdateId: "2026-07-21-issue-sharing",
    requiredSelectors: ["[data-tour-id='task-share-trigger']", "[data-tour-id='task-share-popover']"],
    steps: [
      {
        element: "[data-tour-id='task-share-trigger']",
        popover: {
          title: "Issue teilen",
          description: "Hier bereitest du für jedes Deliverable und Sub-Issue eine Nachricht vor. Der Text greift Vorschlag, Review oder allgemeinen Abstimmungsbedarf auf.",
          side: "bottom",
          align: "end",
        },
      },
      {
        element: "[data-tour-id='task-share-popover']",
        popover: {
          title: "Nachricht selbst senden",
          description: "Passe den Text an. Der blaue Button kopiert ihn und öffnet Google Chat; den Chat und das Senden übernimmst du dort selbst.",
          side: "left",
          align: "start",
          doneBtnText: "Verstanden",
        },
      },
    ] satisfies DriveStep[],
  },
  {
    id: productUpdatesTourId,
    openHelpMenu: true,
    productUpdateId: "2026-07-21-whats-new-gallery",
    requiredSelectors: ["[data-tour-id='help-menu-trigger']", "[data-tour-id='product-updates-menu-link']"],
    steps: [
      {
        element: "[data-tour-id='help-menu-trigger']",
        popover: {
          title: "Neuigkeiten wiederfinden",
          description: "Öffne die Hilfe, wenn du eine Änderung später noch einmal ansehen möchtest.",
          side: "bottom",
          align: "end",
        },
      },
      {
        element: "[data-tour-id='product-updates-menu-link']",
        popover: {
          title: "Was ist neu",
          description: "Hier findest du alle kurzen Bilderklärungen zu sichtbaren Neuerungen.",
          side: "left",
          align: "start",
          doneBtnText: "Verstanden",
        },
      },
    ] satisfies DriveStep[],
  },
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
          description: "Kalender und Verfügbarkeit sind aus dem Profil raus. Übrig bleiben Profil, Benachrichtigungen und Planungs-Defaults.",
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
          description: "Hier öffnest du Profil, Benachrichtigungen und Planungs-Defaults.",
          side: "left",
          align: "start",
          doneBtnText: "Profil öffnen",
        },
      },
    ] satisfies DriveStep[],
  },
] as const satisfies readonly FeatureTourDefinition[];
