import {
  Archive,
  Bell,
  CalendarClock,
  GanttChart,
  LayoutDashboard,
  Link2,
  ListOrdered,
  UserCircle,
  Users,
  WandSparkles,
  type LucideIcon,
} from "lucide-react";
import {
  appWorkspaceIds,
  appWorkspaceFromValue,
  rootWorkspaceFromPreference,
  type AppWorkspace,
  type VisibleAppWorkspace,
} from "@/features/planning/model/workspace-preferences";

export { appWorkspaceIds, appWorkspaceFromValue, rootWorkspaceFromPreference };
export type { AppWorkspace, VisibleAppWorkspace };

type WorkspaceRoute = {
  id: AppWorkspace;
  label: string;
  icon: LucideIcon;
  href: string;
  ceoOnly?: boolean;
  hidden?: boolean;
};

function isVisibleWorkspaceRoute(route: WorkspaceRoute): route is WorkspaceRoute & { id: VisibleAppWorkspace; hidden?: false } {
  return !route.hidden;
}

export const workspaceRoutes: readonly WorkspaceRoute[] = [
  { id: "planning", label: "Planung", icon: LayoutDashboard, href: "/planning" },
  { id: "backlog", label: "Backlog", icon: ListOrdered, href: "/backlog" },
  { id: "events", label: "Events", icon: CalendarClock, href: "/events" },
  { id: "ceo-intake", label: "CEO Intake", icon: WandSparkles, href: "/ceo-intake", ceoOnly: true },
  { id: "sprint", label: "Sprint & Score", icon: GanttChart, href: "/sprint" },
  { id: "projects", label: "Meilensteine", icon: Archive, href: "/projects" },
  { id: "tools", label: "Quicklinks", icon: Link2, href: "/tools" },
  { id: "team", label: "Team", icon: Users, href: "/team" },
  { id: "notifications", label: "Notifications", icon: Bell, href: "/notifications" },
  { id: "profile", label: "Mein Profil", icon: UserCircle, href: "/profile", hidden: true },
];

export const appNavItems = workspaceRoutes.filter(isVisibleWorkspaceRoute);
export const hiddenWorkspaceIds = ["profile"] as const satisfies readonly AppWorkspace[];
export const visibleWorkspaceIds = appNavItems.map((route) => route.id) as VisibleAppWorkspace[];

export function workspacePath(workspace: AppWorkspace) {
  return workspaceRoutes.find((route) => route.id === workspace)?.href || "/planning";
}
