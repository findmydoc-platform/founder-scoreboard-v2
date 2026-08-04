export const appWorkspaceIds = [
  "planning",
  "backlog",
  "projects",
  "sprint",
  "decision-log",
  "events",
  "team",
  "notifications",
  "tools",
  "profile",
] as const;

export type AppWorkspace = (typeof appWorkspaceIds)[number];
export type VisibleAppWorkspace = Exclude<AppWorkspace, "profile" | "projects">;

export const persistedWorkspaceIds = [
  "planning",
  "backlog",
  "events",
  "sprint",
  "projects",
  "tools",
  "team",
  "notifications",
  "profile",
] as const satisfies readonly AppWorkspace[];

export function isPersistedWorkspace(
  workspace: AppWorkspace,
): workspace is (typeof persistedWorkspaceIds)[number] {
  return (persistedWorkspaceIds as readonly AppWorkspace[]).includes(workspace);
}

export function appWorkspaceFromValue(value: string | null | undefined): AppWorkspace | null {
  if (value === "mine" || value === "execution" || value === "reviews") return "planning";
  if (value === "settings") return "notifications";
  if (value === "projects") return "backlog";
  return appWorkspaceIds.find((id) => id === value) || null;
}

export function rootWorkspaceFromPreference(
  value: string | null | undefined,
): AppWorkspace {
  const workspace = appWorkspaceFromValue(value) || "planning";
  if (!isPersistedWorkspace(workspace)) return "planning";
  return workspace;
}
