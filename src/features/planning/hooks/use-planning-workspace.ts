import { usePathname, useRouter } from "next/navigation";
import { useCallback } from "react";
import { type AppWorkspace, workspacePath } from "@/features/planning/model/workspace-routes";

export function usePlanningWorkspace(initialWorkspace: AppWorkspace = "planning") {
  const pathname = usePathname();
  const router = useRouter();

  const navigateWorkspace = useCallback((nextWorkspace: AppWorkspace) => {
    const href = workspacePath(nextWorkspace);
    if (pathname !== href) router.push(href);
  }, [pathname, router]);

  return { workspace: initialWorkspace, setWorkspace: navigateWorkspace };
}
