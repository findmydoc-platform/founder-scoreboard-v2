import { useEffect, useRef, useState } from "react";
import { appWorkspaceIds, type AppWorkspace } from "@/features/planning/organisms/app-sidebar";

const workspaceStateKey = "fmd-planning-workspace-v1";

function workspaceFromValue(value: string | null) {
  if (value === "mine") return "planning";
  return appWorkspaceIds.find((id) => id === value) || null;
}

export function usePlanningWorkspace(initialWorkspace: AppWorkspace = "planning") {
  const restoredRef = useRef(false);
  const [restored, setRestored] = useState(false);
  const [legacyMineWorkspace, setLegacyMineWorkspace] = useState(false);
  const [workspace, setWorkspace] = useState<AppWorkspace>(initialWorkspace);

  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;

    const urlWorkspace = workspaceFromValue(new URLSearchParams(window.location.search).get("workspace"));
    const storedWorkspace = workspaceFromValue(window.localStorage.getItem(workspaceStateKey));
    const rawUrlWorkspace = new URLSearchParams(window.location.search).get("workspace");
    const rawStoredWorkspace = window.localStorage.getItem(workspaceStateKey);
    const nextWorkspace = urlWorkspace || storedWorkspace;
    window.queueMicrotask(() => {
      setLegacyMineWorkspace(rawUrlWorkspace === "mine" || (!rawUrlWorkspace && rawStoredWorkspace === "mine"));
      if (nextWorkspace) setWorkspace(nextWorkspace);
      setRestored(true);
    });
  }, []);

  useEffect(() => {
    if (!restored) return;

    window.localStorage.setItem(workspaceStateKey, workspace);
    const url = new URL(window.location.href);
    if (workspace === "planning") {
      url.searchParams.delete("workspace");
    } else {
      url.searchParams.set("workspace", workspace);
    }
    window.history.replaceState(window.history.state, "", `${url.pathname}${url.search}${url.hash}`);
  }, [restored, workspace]);

  return { legacyMineWorkspace, workspace, setWorkspace };
}
