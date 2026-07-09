import { usePathname, useRouter } from "next/navigation";
import { useCallback, useEffect, useState } from "react";
import { type AppWorkspace, workspacePath } from "@/features/planning/model/workspace-routes";

const workspaceStateKey = "fmd-planning-workspace-v1";

export function usePlanningWorkspace(initialWorkspace: AppWorkspace = "planning") {
  const pathname = usePathname();
  const router = useRouter();
  const [legacyMineWorkspace, setLegacyMineWorkspace] = useState(false);

  useEffect(() => {
    const url = new URL(window.location.href);
    const rawUrlWorkspace = url.searchParams.get("workspace");
    const rawStoredWorkspace = window.localStorage.getItem(workspaceStateKey);
    const legacyMine = initialWorkspace === "planning" && (rawUrlWorkspace === "mine" || (!rawUrlWorkspace && rawStoredWorkspace === "mine"));

    window.queueMicrotask(() => setLegacyMineWorkspace(legacyMine));
    window.localStorage.setItem(workspaceStateKey, legacyMine ? "mine" : initialWorkspace);

    if (!rawUrlWorkspace) return;

    url.searchParams.delete("workspace");
    router.replace(`${workspacePath(initialWorkspace)}${url.search}${url.hash}`, { scroll: false });
  }, [initialWorkspace, router]);

  const navigateWorkspace = useCallback((nextWorkspace: AppWorkspace) => {
    const href = workspacePath(nextWorkspace);
    window.localStorage.setItem(workspaceStateKey, nextWorkspace);
    if (pathname !== href) router.push(href);
  }, [pathname, router]);

  return { legacyMineWorkspace, workspace: initialWorkspace, setWorkspace: navigateWorkspace };
}
