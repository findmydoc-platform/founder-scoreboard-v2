import type { PlatformRole } from "@/lib/types";

export const appWorkspaceIds = [
  "planning",
  "backlog",
  "events",
  "ceo-intake",
  "sprint",
  "projects",
  "tools",
  "team",
  "notifications",
  "profile",
] as const;

export type AppWorkspace = (typeof appWorkspaceIds)[number];
export type VisibleAppWorkspace = Exclude<AppWorkspace, "profile">;

export function appWorkspaceFromValue(value: string | null | undefined): AppWorkspace | null {
  if (value === "mine" || value === "execution" || value === "reviews") return "planning";
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
