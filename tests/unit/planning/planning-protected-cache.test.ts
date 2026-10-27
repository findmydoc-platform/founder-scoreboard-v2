import { afterEach, expect, test, vi } from "vitest";
import { getProtectedPlanningShellStateCache, setProtectedPlanningShellStateCache } from "@/features/planning/hooks/use-planning-auth";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { emptyPlanningHeaderData } from "@/lib/planning-header-data";
import type { ServerSessionView } from "@/lib/credentials/session-types";

const session: ServerSessionView = { userId: "user-a", revision: "session-a", expiresAt: 2, user: { id: "user-a" } };
afterEach(() => { setProtectedPlanningShellStateCache(null); vi.restoreAllMocks(); });
function cached(workspace: "planning" | "team", name: string) {
  return { authUserId: session.userId, workspace, sessionRevision: session.revision, authorityExpiresAt: session.expiresAt,
    data: { ...emptyPlanningShellState, project: { ...emptyPlanningShellState.project, name } },
    headerData: emptyPlanningHeaderData, currentProfile: null };
}

test("protected workspace restoration requires the exact user/session scope and retains separate workspace entries", () => {
  vi.spyOn(Date, "now").mockReturnValue(1_000);
  setProtectedPlanningShellStateCache(cached("planning", "Planning"));
  setProtectedPlanningShellStateCache(cached("team", "Team"));
  expect(getProtectedPlanningShellStateCache("planning", session)?.data.project.name).toBe("Planning");
  expect(getProtectedPlanningShellStateCache("team", session)?.data.project.name).toBe("Team");
  expect(getProtectedPlanningShellStateCache("planning", { ...session, revision: "another-session" })).toBeNull();
  expect(getProtectedPlanningShellStateCache("planning", { ...session, userId: "user-b" })).toBeNull();
  expect(getProtectedPlanningShellStateCache("events", session)).toBeNull();
});

test("cache access cannot renew authority and unbound legacy snapshots cannot authorize restoration", () => {
  const now = vi.spyOn(Date, "now").mockReturnValue(1_000);
  setProtectedPlanningShellStateCache(cached("planning", "Planning"));
  expect(getProtectedPlanningShellStateCache("planning", session)).not.toBeNull();
  now.mockReturnValue(2_001);
  expect(getProtectedPlanningShellStateCache("planning", session)).toBeNull();
  now.mockReturnValue(1_000);
  setProtectedPlanningShellStateCache({ ...cached("planning", "Unbound"), sessionRevision: undefined, authorityExpiresAt: undefined });
  expect(getProtectedPlanningShellStateCache("planning", session)).toBeNull();
});
