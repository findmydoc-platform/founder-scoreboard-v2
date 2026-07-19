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
import type { PlatformRole } from "@/lib/types";

export type AppWorkspace = "planning" | "backlog" | "events" | "sprint" | "projects" | "tools" | "team" | "notifications" | "ceo-intake" | "profile";
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
export const appWorkspaceIds = workspaceRoutes.map((route) => route.id) as AppWorkspace[];
export const visibleWorkspaceIds = appNavItems.map((route) => route.id) as VisibleAppWorkspace[];

export function workspacePath(workspace: AppWorkspace) {
  return workspaceRoutes.find((route) => route.id === workspace)?.href || "/planning";
}

export function appWorkspaceFromValue(value: string | null | undefined): AppWorkspace | null {
  if (value === "mine" || value === "execution") return "planning";
  if (value === "reviews") return "planning";
  if (value === "settings") return "notifications";
  return appWorkspaceIds.find((id) => id === value) || null;
}

export function rootWorkspaceFromPreference(
  value: string | null | undefined,
  platformRole: PlatformRole | null | undefined,
): AppWorkspace {
  const workspace = appWorkspaceFromValue(value) || "planning";
  return workspace === "ceo-intake" && platformRole !== "ceo" ? "planning" : workspace;
}
