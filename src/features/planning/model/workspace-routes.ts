import {
  Archive,
  Bell,
  BookOpenCheck,
  CalendarClock,
  GanttChart,
  LayoutDashboard,
  Link2,
  ListOrdered,
  UserCircle,
  Users,
  type LucideIcon,
} from "lucide-react";
import {
  appWorkspaceIds,
  appWorkspaceFromValue,
  isPersistedWorkspace,
  persistedWorkspaceIds,
  rootWorkspaceFromPreference,
  type AppWorkspace,
  type VisibleAppWorkspace,
} from "@/features/planning/model/workspace-preferences";

export {
  appWorkspaceIds,
  appWorkspaceFromValue,
  isPersistedWorkspace,
  persistedWorkspaceIds,
  rootWorkspaceFromPreference,
};
export type { AppWorkspace, VisibleAppWorkspace };

type WorkspaceRoute = {
  id: AppWorkspace;
  label: string;
  icon: LucideIcon;
  href: string;
  navigationSection: AppNavigationSection;
  ceoOnly?: boolean;
  hidden?: boolean;
};

export const appNavigationSections = [
  { id: "planning", label: "Planung" },
  { id: "steering", label: "Steuerung" },
  { id: "team-resources", label: "Team & Ressourcen" },
] as const;

type AppNavigationSection = (typeof appNavigationSections)[number]["id"];

function isVisibleWorkspaceRoute(route: WorkspaceRoute): route is WorkspaceRoute & { id: VisibleAppWorkspace; hidden?: false } {
  return !route.hidden;
}

export const workspaceRoutes: readonly WorkspaceRoute[] = [
  { id: "planning", label: "Planung", icon: LayoutDashboard, href: "/planning", navigationSection: "planning" },
  { id: "backlog", label: "Backlog", icon: ListOrdered, href: "/backlog", navigationSection: "planning" },
  { id: "projects", label: "Meilensteine & Initiativen", icon: Archive, href: "/projects", navigationSection: "planning" },
  { id: "sprint", label: "Sprint & Score", icon: GanttChart, href: "/sprint", navigationSection: "steering" },
  { id: "decision-log", label: "Decision Log", icon: BookOpenCheck, href: "/decision-log", navigationSection: "steering" },
  { id: "events", label: "Termine & Erinnerungen", icon: CalendarClock, href: "/events", navigationSection: "steering" },
  { id: "team", label: "Team", icon: Users, href: "/team", navigationSection: "team-resources" },
  { id: "notifications", label: "Benachrichtigungen", icon: Bell, href: "/notifications", navigationSection: "team-resources" },
  { id: "tools", label: "Links & Tools", icon: Link2, href: "/tools", navigationSection: "team-resources" },
  { id: "profile", label: "Mein Profil", icon: UserCircle, href: "/profile", navigationSection: "team-resources", hidden: true },
];

export const appNavItems = workspaceRoutes.filter(isVisibleWorkspaceRoute);
export const hiddenWorkspaceIds = ["profile"] as const satisfies readonly AppWorkspace[];
export const visibleWorkspaceIds = appNavItems.map((route) => route.id) as VisibleAppWorkspace[];

export function workspacePath(workspace: AppWorkspace) {
  return workspaceRoutes.find((route) => route.id === workspace)?.href || "/planning";
}
