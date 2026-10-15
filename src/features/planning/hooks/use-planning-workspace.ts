import { usePathname, useRouter } from "next/navigation";
import { useCallback } from "react";
import { type AppWorkspace, workspacePath } from "@/features/planning/model/workspace-routes";

export function usePlanningWorkspace(initialWorkspace: AppWorkspace = "planning") {
  const pathname = usePathname();
  const router = useRouter();

  const navigateWorkspace = useCallback((nextWorkspace: AppWorkspace, options?: { editWorkweek?: boolean; week?: string }) => {
    const params = new URLSearchParams();
    if (nextWorkspace === "team" && options?.editWorkweek) params.set("workweek", "edit");
    if (nextWorkspace === "team" && options?.week) params.set("week", options.week);
    const href = workspacePath(nextWorkspace) + (params.size ? `?${params}` : "");
    if (pathname !== href) router.push(href);
  }, [pathname, router]);

  return { workspace: initialWorkspace, setWorkspace: navigateWorkspace };
}
