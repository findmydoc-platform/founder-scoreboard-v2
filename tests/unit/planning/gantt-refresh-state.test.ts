import { expect, test, vi } from "vitest";
import { createPlanningState, type PlanningWorkspaceRead } from "@/features/planning/model/internal/planning-state-owner";
import { DEFAULT_PLANNING_FILTERS } from "@/features/planning/model/planning-board-query";
import { planningGanttQueryKey, type PlanningGanttQuery } from "@/features/planning/model/planning-gantt-query";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { taskDetailStoryTask } from "@/features/tasks/molecules/task-detail-story-fixtures";

// The same public check is called by the 60-second, visibility and online scheduler.
test("visible Gantt refreshes its selected rows and independently mounted filter controls after a source change", async () => {
  vi.useFakeTimers();
  const started = Date.now(), deadline = started + 120_000;
  const actor = { id: "gantt-reader", name: "Gantt reader", platformRole: "founder" as const, githubLogin: "" };
  const session = { userId: "gantt-user", user: { id: "gantt-user" }, revision: "gantt-session", expiresAt: (started + 3_600_000) / 1000 };
  const query: PlanningGanttQuery = { view: "gantt", filters: { ...DEFAULT_PLANNING_FILTERS } };
  let source = "1", selectedReads = 0, controlsReads = 0, versionReads = 0, workspaceReads = 0;
  const readAuthority = { userId: session.userId, deadline }, readActor = { profileId: actor.id, platformRole: actor.platformRole };
  const state = createPlanningState({ userId: session.userId, initialCurrentProfile: actor, initialSession: session, initialData: emptyPlanningShellState,
    adapter: {
      now: () => Date.now(), saveTask: async task => ({ task }),
      readWorkspace: async () => { workspaceReads++; throw new Error("No complete workspace fallback"); },
      readPlanningSourceVersion: async () => { versionReads++; return source; },
      readGantt: async (): Promise<PlanningWorkspaceRead> => {
        selectedReads++;
        const task = taskDetailStoryTask({ id: "gantt-row", title: `Selected source ${source}`, updatedAt: `2026-11-01T12:00:0${source}Z` });
        return { readAuthority, readActor, scopeRevision: source, coverage: { tasks: "partial" }, taskCoverage: "partial",
          data: { ...emptyPlanningShellState, tasks: [task] }, gantt: {
            query, queryKey: planningGanttQueryKey(query), itemIds: [task.id], contextIds: [], total: 1,
            toolbarCounts: { filtered: 1, unfiltered: 1 }, coverage: { items: "complete", hierarchy: "complete", schedule: "complete", relationships: "complete" },
            sourceRevision: source, observedAt: new Date(started).toISOString(), temporalKey: "stable", validUntil: null,
          } };
      },
      readStructureControls: async () => {
        controlsReads++;
        return { readAuthority, readActor, model: { revision: source, controls: {
          people: [{ id: actor.id, name: actor.name }], sprints: [], initiatives: [], workstreams: [`Source ${source}`],
          coverage: "complete", sourceRevision: source, scopeRevision: `controls-${source}`,
          observedAt: new Date(started).toISOString(), validUntil: new Date(deadline).toISOString(),
        } } };
      },
    } });
  const releasePlanning = state.planning.activatePlanningView(), releaseGantt = state.planning.activateGantt(), releaseControls = state.planning.activateStructureControls();
  try {
    expect(await state.planning.loadGantt(query)).toBe(true);
    expect(await state.planning.loadStructureControls()).toBe(true);
    expect(state.planning.gantt().selection?.sourceRevision).toBe("1");
    expect(state.planning.structureControls()).toMatchObject({ readStatus: "current", controls: { sourceRevision: "1", workstreams: ["Source 1"] } });
    expect(await state.planning.checkPlanningSource()).toBe("unchanged");
    expect([selectedReads, controlsReads, versionReads, workspaceReads]).toEqual([1, 1, 1, 0]);
    expect(state.planning.structureControls().controls?.validUntil).toBe(new Date(deadline).toISOString());

    source = "2";
    expect(await state.planning.checkPlanningSource()).toBe("changed");
    await vi.advanceTimersByTimeAsync(499);
    expect([selectedReads, controlsReads, workspaceReads]).toEqual([1, 1, 0]);
    await vi.advanceTimersByTimeAsync(1);
    expect(selectedReads).toBe(2);
    expect(controlsReads).toBe(2);
    expect(state.planning.gantt()).toMatchObject({ readStatus: "current", selection: { sourceRevision: "2" }, tasks: [expect.objectContaining({ title: "Selected source 2" })] });
    expect(state.planning.structureControls()).toMatchObject({ readStatus: "current", controls: { sourceRevision: "2", workstreams: ["Source 2"], validUntil: new Date(deadline).toISOString() } });
    expect(workspaceReads).toBe(0);
  } finally {
    releaseControls(); releaseGantt(); releasePlanning(); state.internal.dispose(); vi.useRealTimers();
  }
});
