import type { DriveStep } from "driver.js";

export const workspaceCleanupTourId = "workspace-cleanup-v2";
export const profileSettingsTourId = "profile-settings-v1";

export const featureTours = [
  {
    id: workspaceCleanupTourId,
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
    id: profileSettingsTourId,
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
] as const;
