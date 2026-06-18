import { useEffect, useRef, useState } from "react";
import { appNavItems, type AppWorkspace } from "@/features/planning/organisms/app-sidebar";

const workspaceStateKey = "fmd-planning-workspace-v1";

function workspaceFromValue(value: string | null) {
  return appNavItems.find((item) => item.id === value)?.id || null;
}

export function usePlanningWorkspace(initialWorkspace: AppWorkspace = "planning") {
  const restoredRef = useRef(false);
  const [workspace, setWorkspace] = useState<AppWorkspace>(initialWorkspace);

  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;

    const urlWorkspace = workspaceFromValue(new URLSearchParams(window.location.search).get("workspace"));
    const storedWorkspace = workspaceFromValue(window.localStorage.getItem(workspaceStateKey));
    const nextWorkspace = urlWorkspace || storedWorkspace;
    if (nextWorkspace) window.queueMicrotask(() => setWorkspace(nextWorkspace));
  }, []);

  useEffect(() => {
    if (!restoredRef.current) return;

    window.localStorage.setItem(workspaceStateKey, workspace);
    const url = new URL(window.location.href);
    if (workspace === "planning") {
      url.searchParams.delete("workspace");
    } else {
      url.searchParams.set("workspace", workspace);
    }
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, [workspace]);

  return { workspace, setWorkspace };
}
