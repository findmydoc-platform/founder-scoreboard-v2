import { expect, test } from "vitest";
import { createPlanningState } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { emptyPlanningHeaderData, readyHeaderSlot } from "@/lib/planning-header-data";
import type { PlanningServerHeaderRead } from "@/features/planning/model/planning-server-header-read";

for (const boundary of ["current", "actor", "session", "deadline", "timeout"] as const) {
  test(`Team reserved Header retains its original ${boundary} publication boundary`, () => {
    let now = 1_000, browserReads = 0;
    const session = { userId: "team-slot-user", revision: "original-team-session", expiresAt: 100, user: { id: "team-slot-user" } };
    const read: PlanningServerHeaderRead = { id: "original-team-read", userId: session.userId, sessionRevision: session.revision, deadline: 2_000, timeoutAt: 1_500 };
    const links = { ...emptyPlanningHeaderData, quickLinks: readyHeaderSlot([{ id: "handbook", name: "Original Team handbook", category: "tool" as const, url: "https://example.test/handbook", previewImageUrl: "" }]) };
    const owner = createPlanningState({ userId: session.userId, initialWorkspace: "team", initialSession: session,
      initialData: emptyPlanningShellState, initialServerHeaderRead: read, adapter: {
        now: () => now, saveTask: async () => ({ task: {} }), readWorkspace: async () => null,
        readHeader: async () => { browserReads++; return emptyPlanningHeaderData; },
      } });
    try {
      expect(owner.planning.header().slots.quickLinks.readStatus).toBe("loading");
      if (boundary === "actor") owner.internal.sessionChanged("replacement-team-user");
      if (boundary === "session") owner.internal.bindSession({ ...session, revision: "replacement-team-session" });
      if (boundary === "deadline") now = read.deadline;
      if (boundary === "timeout") now = read.timeoutAt;
      expect(owner.planning.acceptServerHeaderSlot(read, "quickLinks", links)).toBe(boundary === "current");
      expect(owner.planning.header().data.quickLinks.data).toEqual(boundary === "current" ? links.quickLinks.data : []);
      expect(browserReads).toBe(0);
      if (boundary === "current") expect(owner.planning.acceptServerHeaderSlot(read, "quickLinks", links)).toBe(false);
      expect(read).toEqual({ id: "original-team-read", userId: "team-slot-user", sessionRevision: "original-team-session", deadline: 2_000, timeoutAt: 1_500 });
    } finally { owner.internal.dispose(); }
  });
}
