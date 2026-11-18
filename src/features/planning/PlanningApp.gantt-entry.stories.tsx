import { useEffect, useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";
import type { PlanningWorkspaceModel } from "@/features/planning-items/model/planning-workspace-model";
import { planningWorkspaceModelToPlanningShellState } from "@/features/planning-items/model/planning-shell-projection";
import { productUpdates } from "@/features/product-updates/model/product-update-registry";
import { taskDetailStoryTask } from "@/features/tasks/molecules/task-detail-story-fixtures";
import { itemPageHeaderData, itemPageProfile, itemPageUser, mockItemPageBrowser } from "../../../tests/helpers/task-detail-page-browser-fixture";
import { PlanningApp } from "./PlanningApp";
import { DEFAULT_PLANNING_FILTERS } from "./hooks/use-planning-view-state";
import { normalizePlanningGanttQuery, planningGanttQueryKey } from "./model/planning-gantt-query";
import { emptyPlanningShellState } from "./model/planning-shell-state";
import { planningWorkspaceHydration } from "./model/planning-workspace-hydration";
import { PlanningStateProvider } from "./organisms/planning-state-provider";

const sourceRevision = "1";
const savedSearch = "Saved timeline";
const session = { userId: itemPageUser.id, user: itemPageUser, revision: "item-page-session", expiresAt: Math.floor(Date.now() / 1000) + 3600 };
const sprint = { id: "saved-gantt-sprint", name: "Timeline Sprint", startDate: "2026-11-16", endDate: "2026-11-20", reviewDueAt: "", scoreLocked: false, status: "planning" as const };
const initiative = taskDetailStoryTask({ id: "saved-gantt-parent", title: "Saved initiative", taskType: "initiative" });
const selected = [
  taskDetailStoryTask({ id: "saved-gantt-open", title: "Saved timeline open", parentTaskId: initiative.id, sprintId: sprint.id }),
  taskDetailStoryTask({ id: "saved-gantt-done", title: "Saved timeline completed", status: "Erledigt", parentTaskId: initiative.id, sprintId: sprint.id }),
];

function SavedGanttEntry() {
  const [ready, setReady] = useState(false);
  const [release, setRelease] = useState<(() => void) | undefined>();
  const [reads, setReads] = useState({ gantt: 0, board: 0, complete: 0 });
  const [basis] = useState(() => {
    const observedAt = new Date().toISOString();
    const model: PlanningWorkspaceModel = {
      project: emptyPlanningShellState.project, revision: sourceRevision, scopeRevision: sourceRevision,
      items: [], people: [itemPageProfile], sprints: [], relationships: [],
      preferences: [{
        profileId: itemPageProfile.id, defaultWorkspace: "planning", defaultTaskView: "gantt",
        planningFilters: { ...DEFAULT_PLANNING_FILTERS, query: savedSearch },
        expandedInitiativeIds: [], createdAt: observedAt, updatedAt: observedAt,
      }],
      coverage: { items: "partial", people: "partial", sprints: "partial", relationships: "partial", preferences: "partial", strategies: "partial", raci: "partial", links: "partial", blockers: "partial" },
    };
    return { model, observedAt, authority: { userId: itemPageUser.id, deadline: Date.now() + 60_000 } };
  });
  useEffect(() => {
    let mounted = true;
    let restore: (() => void) | undefined;
    const seenKey = `founderops.product-updates.seen.${itemPageProfile.id}`;
    const previous = localStorage.getItem(seenKey);
    localStorage.setItem(seenKey, JSON.stringify(productUpdates.map(update => update.id)));
    void mockItemPageBrowser({ respond: input => {
      const url = new URL(String(input), "http://localhost:3000");
      if (url.pathname === "/api/auth/session") return Response.json({ session });
      if (url.pathname === "/api/planning-source-version") return Response.json({ version: sourceRevision });
      if (url.pathname === "/api/planning-revision") return Response.json({ revision: { activeTaskCount: 3, latestUpdatedAt: basis.observedAt } });
      if (url.pathname !== "/api/planning-board-data") return undefined;
      const raw = JSON.parse(url.searchParams.get("scope") || "{}");
      if (raw.view === "structure" && raw.area === "controls") return Response.json({
        readAuthority: basis.authority,
        readActor: { profileId: itemPageProfile.id, platformRole: itemPageProfile.platformRole },
        model: { revision: sourceRevision, controls: {
          people: [{ id: itemPageProfile.id, name: itemPageProfile.name }],
          sprints: [{ id: sprint.id, name: sprint.name }],
          initiatives: [{ id: initiative.id, title: initiative.title }],
          workstreams: [], coverage: "complete", sourceRevision, scopeRevision: "saved-gantt-controls",
          observedAt: basis.observedAt, validUntil: new Date(basis.authority.deadline).toISOString(),
        } },
      });
      if (raw.view !== "gantt") {
        setReads(value => raw.view === "complete" ? { ...value, complete: value.complete + 1 } : { ...value, board: value.board + 1 });
        return Response.json({ error: "Saved Gantt must only request its own item selection" }, { status: 503 });
      }
      setReads(value => ({ ...value, gantt: value.gantt + 1 }));
      const query = normalizePlanningGanttQuery(raw);
      if (!query || query.filters.query !== savedSearch) return Response.json({ error: "Saved Gantt filters were not applied" }, { status: 400 });
      const model: PlanningWorkspaceModel = {
        ...basis.model, preferences: [], items: [...selected, initiative], sprints: [sprint],
        gantt: {
          query, queryKey: planningGanttQueryKey(query), itemIds: selected.map(task => task.id), contextIds: [initiative.id],
          total: selected.length, coverage: { items: "complete", hierarchy: "complete", schedule: "complete", relationships: "complete" },
          sourceRevision, observedAt: basis.observedAt, temporalKey: "stable", validUntil: null,
        },
      };
      return new Promise<Response>(resolve => {
        setRelease(() => () => {
          resolve(Response.json({ model, readAuthority: basis.authority, currentProfile: itemPageProfile }));
          setRelease(undefined);
        });
      });
    } }).then(cleanup => {
      if (!mounted) cleanup();
      else { restore = cleanup; setReady(true); }
    });
    return () => {
      mounted = false;
      restore?.();
      if (previous === null) localStorage.removeItem(seenKey);
      else localStorage.setItem(seenKey, previous);
    };
  }, [basis]);
  return <>
    <output aria-label="Saved Gantt reads">{reads.gantt}</output>
    <output aria-label="Saved Gantt board reads">{reads.board}</output>
    <output aria-label="Saved Gantt complete reads">{reads.complete}</output>
    {release ? <button type="button" onClick={release}>Gantt-Antwort freigeben</button> : null}
    {ready ? <PlanningStateProvider><PlanningApp
      initialWorkspace="planning"
      initialData={planningWorkspaceModelToPlanningShellState(basis.model)}
      initialWorkspaceRead={planningWorkspaceHydration("planning", basis.model, session, basis.authority)}
      initialHeaderData={itemPageHeaderData}
      initialAuthUser={itemPageUser}
      initialCurrentProfile={itemPageProfile}
      initialProtectedDataLoaded authRequired source="supabase"
    /></PlanningStateProvider> : null}
  </>;
}

const meta = {
  title: "Planning/Saved Gantt entry",
  component: SavedGanttEntry,
  loaders: [async () => { await import("@/features/tasks/organisms/gantt-view"); return {}; }],
  parameters: { layout: "fullscreen", nextjs: { appDirectory: true, navigation: { pathname: "/planning" } } },
} satisfies Meta<typeof SavedGanttEntry>;
export default meta;

export const SavedGanttStartsWithItsSelectedBasis: StoryObj<typeof meta> = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const release = await canvas.findByRole("button", { name: "Gantt-Antwort freigeben" });
    await expect(canvas.getByLabelText("Saved Gantt reads")).toHaveTextContent(/^1$/);
    await expect(canvas.getByLabelText("Saved Gantt board reads")).toHaveTextContent(/^0$/);
    await expect(canvas.getByLabelText("Saved Gantt complete reads")).toHaveTextContent(/^0$/);
    await expect(await canvas.findByText("Gantt wird geladen …")).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Board" })).toBeEnabled();
    const search = canvas.getByRole("searchbox", { name: "Aufgaben durchsuchen" });
    await expect(search).toBeEnabled();
    await expect(search).toHaveValue(savedSearch);
    await expect(canvas.queryByRole("region", { name: "Board nach Status" })).not.toBeInTheDocument();
    await userEvent.click(release);
    const results = within(await canvas.findByRole("region", { name: "Planungsergebnisse" }));
    for (const task of selected) {
      await expect(await results.findByRole("link", { name: task.title })).toHaveAttribute("href", `/tasks/${task.id}`);
      await expect(results.getByRole("link", { name: `${task.title} · 5 Tage` })).toHaveAttribute("title", `${task.title} · ${initiative.title}`);
    }
    await expect(results.getAllByRole("link")).toHaveLength(selected.length * 2);
    await expect(canvas.getByLabelText("Saved Gantt reads")).toHaveTextContent(/^1$/);
    await expect(canvas.getByLabelText("Saved Gantt board reads")).toHaveTextContent(/^0$/);
    await expect(canvas.getByLabelText("Saved Gantt complete reads")).toHaveTextContent(/^0$/);
  },
};
