import {
  Archive,
  CalendarClock,
  ClipboardCheck,
  GanttChart,
  LayoutDashboard,
  ListOrdered,
  Settings,
  UserCircle,
  Users,
  WandSparkles,
  Wrench,
  type LucideIcon,
} from "lucide-react";

export type AppWorkspace = "planning" | "backlog" | "reviews" | "events" | "sprint" | "projects" | "tools" | "team" | "settings" | "ceo-intake" | "profile";
export type VisibleAppWorkspace = Exclude<AppWorkspace, "profile">;

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
  { id: "reviews", label: "Reviews", icon: ClipboardCheck, href: "/reviews" },
  { id: "events", label: "Events", icon: CalendarClock, href: "/events" },
  { id: "ceo-intake", label: "CEO Intake", icon: WandSparkles, href: "/ceo-intake", ceoOnly: true },
  { id: "sprint", label: "Sprint & Score", icon: GanttChart, href: "/sprint" },
  { id: "projects", label: "Meilensteine", icon: Archive, href: "/projects" },
  { id: "tools", label: "FMD-Tools", icon: Wrench, href: "/tools" },
  { id: "team", label: "Team", icon: Users, href: "/team" },
  { id: "settings", label: "Einstellungen", icon: Settings, href: "/settings" },
  { id: "profile", label: "Mein Profil", icon: UserCircle, href: "/profile", hidden: true },
];

export const appNavItems = workspaceRoutes.filter(isVisibleWorkspaceRoute);
export const hiddenWorkspaceIds = ["profile"] as const satisfies readonly AppWorkspace[];
export const appWorkspaceIds = workspaceRoutes.map((route) => route.id) as AppWorkspace[];
export const visibleWorkspaceIds = appNavItems.map((route) => route.id) as VisibleAppWorkspace[];

export function workspacePath(workspace: AppWorkspace) {
  return workspaceRoutes.find((route) => route.id === workspace)?.href || "/planning";
}

export function appWorkspaceFromValue(value: string | null | undefined): AppWorkspace | null {
  if (value === "mine" || value === "execution") return "planning";
  return appWorkspaceIds.find((id) => id === value) || null;
}

export function workspaceFromPathname(pathname: string) {
  const normalized = pathname === "/" ? pathname : pathname.replace(/\/+$/, "");
  return workspaceRoutes.find((route) => route.href === normalized)?.id || null;
}
