import { useEffect, useRef, useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { ReadonlyURLSearchParams, useSearchParams } from "@storybook/nextjs-vite/navigation.mock";
import { expect, userEvent, waitFor, within } from "storybook/test";
import type { PlanningWorkspaceModel } from "@/features/planning-items/model/planning-workspace-model";
import { planningWorkspaceModelToPlanningShellState } from "@/features/planning-items/model/planning-shell-projection";
import { taskDetailStoryTask } from "@/features/tasks/molecules/task-detail-story-fixtures";
import { productUpdates } from "@/features/product-updates/model/product-update-registry";
import { itemPageHeaderData, itemPageProfile, itemPageUser, mockItemPageBrowser } from "../../../tests/helpers/task-detail-page-browser-fixture";
import { PlanningApp } from "./PlanningApp";
import { PlanningStateProvider } from "./organisms/planning-state-provider";
import { DEFAULT_PLANNING_FILTERS } from "./model/planning-board-query";
import { normalizePlanningGanttQuery, planningGanttQueryKey } from "./model/planning-gantt-query";
import { emptyPlanningShellState } from "./model/planning-shell-state";
import { planningWorkspaceHydration } from "./model/planning-workspace-hydration";

const needle = "echo needle", source = "1";
const session = { userId: itemPageUser.id, user: itemPageUser, revision: "item-page-session", expiresAt: Math.floor(Date.now() / 1000) + 3600 };
const parent = taskDetailStoryTask({ id: "echo-parent", title: "Echo initiative", taskType: "initiative" });
const sprint = { id: "echo-sprint", name: "Echo Sprint", startDate: "2026-11-16", endDate: "2026-11-20", reviewDueAt: "", scoreLocked: false, status: "planning" as const };
const task = taskDetailStoryTask({ id: "echo-task", title: "Echo needle work", parentTaskId: parent.id, sprintId: sprint.id });

function GanttUrlEcho() {
  const [ready, setReady] = useState(false), [echo, setEcho] = useState(0);
  const echoedParams = useRef<ReadonlyURLSearchParams | undefined>(undefined);
  const [counts, setCounts] = useState({ searched: 0, aborted: 0, complete: 0, sameQuery: true });
  const [release, setRelease] = useState<(() => void) | undefined>();
  const [basis] = useState(() => {
    const observedAt = new Date().toISOString(), authority = { userId: itemPageUser.id, deadline: Date.now() + 60_000 };
    const model: PlanningWorkspaceModel = { project: emptyPlanningShellState.project, revision: source, scopeRevision: source,
      items: [], people: [itemPageProfile], sprints: [], relationships: [],
      preferences: [{ profileId: itemPageProfile.id, defaultWorkspace: "planning", defaultTaskView: "gantt", planningFilters: { ...DEFAULT_PLANNING_FILTERS }, expandedInitiativeIds: [], createdAt: observedAt, updatedAt: observedAt }],
      coverage: { items: "partial", people: "partial", sprints: "partial", relationships: "partial", preferences: "partial" } };
    return { model, observedAt, authority };
  });
  useEffect(() => {
    let mounted = true, restore: (() => void) | undefined, searchedKey: string | undefined;
    const held: Array<() => void> = [], originalNavigation = useSearchParams.getMockImplementation();
    // Keep the original Next hook calls in every render, including after its URL value changes.
    useSearchParams.mockImplementation(() => {
      const current = originalNavigation?.();
      return echoedParams.current ?? current ?? new ReadonlyURLSearchParams();
    });
    const seenKey = `founderops.product-updates.seen.${itemPageProfile.id}`, previous = localStorage.getItem(seenKey);
    localStorage.setItem(seenKey, JSON.stringify(productUpdates.map(update => update.id)));
    void mockItemPageBrowser({ respond: (input, init) => {
      init?.signal?.throwIfAborted();
      const url = new URL(String(input), "http://localhost:3000");
      if (url.pathname === "/api/auth/session") return Response.json({ session });
      if (url.pathname === "/api/planning-source-version") return Response.json({ version: source });
      if (url.pathname === "/api/planning-revision") return Response.json({ revision: { activeTaskCount: 2, latestUpdatedAt: basis.observedAt } });
      if (url.pathname !== "/api/planning-board-data") return undefined;
      const raw = JSON.parse(url.searchParams.get("scope") || "{}");
      if (raw.view === "structure" && raw.area === "controls") return Response.json({ readAuthority: basis.authority, readActor: { profileId: itemPageProfile.id, platformRole: itemPageProfile.platformRole }, model: { revision: source, controls: {
        people: [{ id: itemPageProfile.id, name: itemPageProfile.name }], sprints: [{ id: sprint.id, name: sprint.name }], initiatives: [{ id: parent.id, title: parent.title }], workstreams: [], coverage: "complete", sourceRevision: source, scopeRevision: "echo-controls", observedAt: basis.observedAt, validUntil: new Date(basis.authority.deadline).toISOString(),
      } } });
      if (raw.view !== "gantt") { setCounts(value => ({ ...value, complete: value.complete + 1 })); return Response.json({ error: "No workspace fallback" }, { status: 503 }); }
      const query = normalizePlanningGanttQuery(raw);
      if (!query) return Response.json({ error: "Invalid fixture query" }, { status: 400 });
      const model: PlanningWorkspaceModel = { ...basis.model, preferences: [], items: [task, parent], sprints: [sprint], gantt: {
        query, queryKey: planningGanttQueryKey(query), itemIds: [task.id], contextIds: [parent.id], total: 1, toolbarCounts: { filtered: 1, unfiltered: 2 },
        coverage: { items: "complete", hierarchy: "complete", schedule: "complete", relationships: "complete" }, sourceRevision: source, observedAt: basis.observedAt, temporalKey: "stable", validUntil: null,
      } };
      const response = () => Response.json({ model, readAuthority: basis.authority, currentProfile: itemPageProfile });
      if (!query.filters.query) return response();
      const key = planningGanttQueryKey(query);
      searchedKey ??= key;
      setCounts(value => ({ ...value, searched: value.searched + 1, sameQuery: value.sameQuery && searchedKey === key }));
      return new Promise<Response>((resolve, reject) => {
        const abort = () => { if (mounted) setCounts(value => ({ ...value, aborted: value.aborted + 1 })); reject(new DOMException("Aborted", "AbortError")); };
        init?.signal?.addEventListener("abort", abort, { once: true });
        held.push(() => { init?.signal?.removeEventListener("abort", abort); resolve(response()); });
        setRelease(() => () => { for (const finish of held.splice(0)) finish(); setRelease(undefined); });
      });
    } }).then(cleanup => { if (!mounted) cleanup(); else { restore = cleanup; setReady(true); } });
    return () => {
      mounted = false; for (const finish of held.splice(0)) finish(); restore?.();
      if (originalNavigation) useSearchParams.mockImplementation(originalNavigation); else useSearchParams.mockReset();
      if (previous === null) localStorage.removeItem(seenKey); else localStorage.setItem(seenKey, previous);
    };
  }, [basis]);
  return <>
    <output aria-label="Searched Gantt transports">{counts.searched}</output><output aria-label="Aborted searched transports">{counts.aborted}</output>
    <output aria-label="Same normalized query">{String(counts.sameQuery)}</output><output aria-label="Workspace fallback transports">{counts.complete}</output>
    <output aria-label="URL echo accepted">{echo}</output>
    <button type="button" onClick={() => {
      const params = new URLSearchParams(window.location.search); params.set("tasks.query", needle);
      window.history.replaceState(null, "", `${window.location.pathname}?${params}`);
      echoedParams.current = new ReadonlyURLSearchParams(params); setEcho(value => value + 1);
    }}>Gleiche Such-URL übernehmen</button>
    {release ? <button type="button" onClick={release}>Suchantwort freigeben</button> : null}
    {ready ? <PlanningStateProvider><PlanningApp initialWorkspace="planning" initialData={planningWorkspaceModelToPlanningShellState(basis.model)}
      initialWorkspaceRead={planningWorkspaceHydration("planning", basis.model, session, basis.authority)} initialHeaderData={itemPageHeaderData}
      initialAuthUser={itemPageUser} initialCurrentProfile={itemPageProfile} initialProtectedDataLoaded authRequired source="supabase" /></PlanningStateProvider> : null}
  </>;
}

const meta = { title: "Planning/Gantt URL echo", component: GanttUrlEcho,
  loaders: [async () => { await import("@/features/tasks/organisms/gantt-view"); return {}; }],
  parameters: { layout: "fullscreen", nextjs: { appDirectory: true, navigation: { pathname: "/planning" } } },
} satisfies Meta<typeof GanttUrlEcho>;
export default meta;
export const EquivalentUrlEchoRetainsThePendingSearchLease: StoryObj<typeof meta> = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole("link", { name: `${task.title} · 5 Tage` })).toBeVisible();
    const search = canvas.getByRole("searchbox", { name: "Aufgaben durchsuchen" });
    await userEvent.type(search, needle); await userEvent.keyboard("{Enter}");
    await canvas.findByRole("button", { name: "Suchantwort freigeben" });
    await expect(canvas.getByLabelText("Searched Gantt transports")).toHaveTextContent(/^1$/);
    await userEvent.click(canvas.getByRole("button", { name: "Gleiche Such-URL übernehmen" }));
    await waitFor(() => expect(canvas.getByLabelText("URL echo accepted")).toHaveTextContent(/^1$/));
    await expect(search).toHaveValue(needle);
    await userEvent.click(canvas.getByRole("button", { name: "Suchantwort freigeben" }));
    await expect(await canvas.findByRole("link", { name: `${task.title} · 5 Tage` })).toBeVisible();
    await expect(canvas.getByLabelText("Same normalized query")).toHaveTextContent("true");
    await expect(canvas.getByLabelText("Searched Gantt transports")).toHaveTextContent(/^1$/);
    await expect(canvas.getByLabelText("Aborted searched transports")).toHaveTextContent(/^0$/);
    await expect(canvas.getByLabelText("Workspace fallback transports")).toHaveTextContent(/^0$/);
  },
};
