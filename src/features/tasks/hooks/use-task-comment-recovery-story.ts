import { useState } from "react";
import { createBrowserPlanningState } from "@/features/planning/model/internal/browser-planning-state";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { createBrowserApiClient } from "@/lib/browser-api-client";
import { emptyPlanningHeaderData } from "@/lib/planning-header-data";
import type { Profile, Task } from "@/lib/types";

export function useTaskCommentRecoveryStory(task: Task, profile: Profile) {
  const [owner] = useState(() => {
    const browser = createBrowserPlanningState({ initialData: { ...emptyPlanningShellState, tasks: [task], profiles: [profile] }, initialHeaderData: emptyPlanningHeaderData, initialCurrentProfile: profile, initialUserId: "reload-user", initialWorkspace: "planning" });
    browser.runtime.session = { userId: "reload-user", revision: "reload-story-session", expiresAt: 4102444800, user: { id: "reload-user" } };
    browser.runtime.apiClient = createBrowserApiClient({
      sessionPort: {
        current: async () => browser.runtime.session,
        recover: async () => ({ kind: "unavailable" }),
        clearIfCurrent: async () => undefined,
      },
    });
    return browser.owner;
  });
  return owner;
}
