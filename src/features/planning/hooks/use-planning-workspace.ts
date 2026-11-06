import { usePathname, useRouter } from "next/navigation";
import { useCallback } from "react";
import { type AppWorkspace, workspacePath, workspaceRoutes } from "@/features/planning/model/workspace-routes";
import type { PlanningState } from "../model/planning-state";

export function usePlanningWorkspace(initialWorkspace: AppWorkspace = "planning", planningState?: PlanningState) {
  const pathname = usePathname();
  const router = useRouter();
  const navigateHref = useCallback((href: string) => {
    if (pathname === href) return;
    const nextWorkspace = workspaceRoutes.find(route => route.href === href)?.id;
    if (nextWorkspace) planningState?.prepareWorkspaceHydration(nextWorkspace);
    router.push(href);
  }, [pathname, planningState, router]);

  const navigateWorkspace = useCallback((nextWorkspace: AppWorkspace, options?: { editWorkweek?: boolean; week?: string }) => {
    const params = new URLSearchParams();
    if (nextWorkspace === "team" && options?.editWorkweek) params.set("workweek", "edit");
    if (nextWorkspace === "team" && options?.week) params.set("week", options.week);
    const href = workspacePath(nextWorkspace) + (params.size ? `?${params}` : "");
    navigateHref(href);
  }, [navigateHref]);

  return { workspace: initialWorkspace, setWorkspace: navigateWorkspace, navigateWorkspaceHref: navigateHref };
}
