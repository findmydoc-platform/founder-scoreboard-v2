import { useEffect, useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, waitFor, within } from "storybook/test";
import { PlanningApp } from "./PlanningApp";
import { PlanningStateProvider } from "./organisms/planning-state-provider";
import { emptyPlanningShellState } from "./model/planning-shell-state";
import { backlogSelectionRead } from "./model/planning-backlog-hydration";
import { normalizeBacklogSelection } from "@/features/backlog/model/backlog-selection";
import { DEFAULT_BACKLOG_FILTERS } from "@/features/backlog/model/backlog-view-model";
import { taskDetailStoryTask } from "@/features/tasks/molecules/task-detail-story-fixtures";
import { productUpdates } from "@/features/product-updates/model/product-update-registry";
import { itemPageProfile, itemPageUser, itemPageHeaderData, mockItemPageBrowser } from "../../../tests/helpers/task-detail-page-browser-fixture";

const parent = taskDetailStoryTask({ id: "cold-parent", title: "Cold parent", taskType: "initiative", updatedAt: "2026-11-01T12:00:00Z" });
const item = taskDetailStoryTask({ id: "cold-selected", title: "Cold selected row", parentTaskId: parent.id, updatedAt: "2026-11-01T12:00:00Z", detailAvailability: "summary" });
const query = normalizeBacklogSelection({ view: "backlog", filters: { ...DEFAULT_BACKLOG_FILTERS, query: "cold" }, limit: 20 })!;
const coverage = { items: "partial", people: "partial", sprints: "partial", commitments: "partial", strategies: "partial", raci: "partial", links: "partial" } as const;

function ColdBacklogFlow() {
  const [ready, setReady] = useState(false);
  const [counts, setCounts] = useState({ selected: 0, controls: 0, sprints: 0, unscoped: 0 });
  const [basis] = useState(() => {
    const deadline = Date.now() + 60_000;
    const session = { userId: itemPageUser.id, user: itemPageUser, revision: "item-page-session", expiresAt: Math.floor(Date.now() / 1000) + 3600 };
    const selection = { query, itemIds: [item.id], contextIds: [parent.id], total: 1, rankById: { [item.id]: 1 }, coverage: "complete" as const, continuation: null,
      sourceRevision: "cold-source", scopeRevision: "cold-members", observedAt: new Date().toISOString(), validUntil: new Date(deadline).toISOString(),
      parentProgressById: { [parent.id]: { total: 1, completed: 0, unfinished: 1, percentage: 0 } } };
    const model = { revision: "cold-source", items: [item, parent], people: [itemPageProfile], sprints: [], commitments: [], coverage, selection };
    const readActor = { profileId: itemPageProfile.id, platformRole: itemPageProfile.platformRole };
    const read = { ...backlogSelectionRead(model, { userId: itemPageUser.id, deadline }, readActor), backlogSelection: selection, readActor };
    return { session, model, seed: { query, session, read }, receipt: { sourceRevision: "cold-source", observedAt: selection.observedAt, validUntil: selection.validUntil, coverage: "complete" as const } };
  });
  useEffect(() => {
    let active = true, restore: (() => void) | undefined;
    const key = `founderops.product-updates.seen.${itemPageProfile.id}`, previous = localStorage.getItem(key);
    localStorage.setItem(key, JSON.stringify(productUpdates.map(update => update.id)));
    void mockItemPageBrowser({ respond: input => {
      const url = new URL(String(input), "http://localhost:3000");
      if (url.pathname === "/api/auth/session") return Response.json({ session: basis.session });
      if (url.pathname !== "/api/backlog-data") return undefined;
      const scope = JSON.parse(url.searchParams.get("scope") || "{}");
      if (scope.view === "backlog") { setCounts(value => ({ ...value, selected: value.selected + 1 })); return Response.json({ model: basis.model, readActor: basis.seed.read.readActor, readAuthority: basis.seed.read.readAuthority }); }
      if (scope.view !== "backlog-support") { setCounts(value => ({ ...value, unscoped: value.unscoped + 1 })); return Response.json({ error: "No unscoped Backlog" }, { status: 503 }); }
      setCounts(value => ({ ...value, [scope.area]: value[scope.area as "controls" | "sprints"] + 1 }));
      const receipt = { ...basis.receipt, scopeRevision: scope.area };
      const model = scope.area === "controls" ? { controls: { ...receipt, levelTotals: { epic: 0, initiative: 1, deliverable: 1 }, scopeCounts: { all: 1, proposals: 0, ready: 0, unscheduled: 1 },
        statuses: { epic: ["Offen"], initiative: ["Offen"], deliverable: ["Offen"] }, assignees: [], epics: [], initiatives: [{ value: parent.id, label: parent.title }] } }
        : { sprintBasis: { ...receipt, day: scope.day, buckets: [] } };
      return Response.json({ model: { revision: "cold-source", items: [], people: [], sprints: [], commitments: [], coverage, ...model }, readActor: basis.seed.read.readActor, readAuthority: basis.seed.read.readAuthority });
    } }).then(cleanup => { if (!active) cleanup(); else { restore = cleanup; setReady(true); } });
    return () => { active = false; restore?.(); if (previous === null) localStorage.removeItem(key); else localStorage.setItem(key, previous); };
  }, [basis]);
  return <>{Object.entries(counts).map(([name, value]) => <output key={name} aria-label={`Cold Backlog requests ${name}`}>{value}</output>)}{ready ? <PlanningStateProvider><PlanningApp initialWorkspace="backlog" initialBacklogModel={{ revision: "", items: [], people: [itemPageProfile], sprints: [], commitments: [], coverage }} initialData={{ ...emptyPlanningShellState, profiles: [itemPageProfile] }} initialHeaderData={itemPageHeaderData} initialAuthUser={itemPageUser} initialCurrentProfile={itemPageProfile} initialBacklogRead={basis.seed} initialProtectedDataLoaded authRequired source="supabase" /></PlanningStateProvider> : null}</>;
}
const meta = { title: "Planning/Cold Backlog", component: ColdBacklogFlow, parameters: { layout: "fullscreen", nextjs: { appDirectory: true, navigation: { pathname: "/backlog", query: { "backlog.query": "cold" } } } } } satisfies Meta<typeof ColdBacklogFlow>;
export default meta;
type Story = StoryObj<typeof meta>;
export const ColdSelectedHydrationKeepsIndependentSupportStarts: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const group = within(await canvas.findByRole("region", { name: parent.title }));
    await expect(await group.findByRole("link", { name: item.title })).toBeVisible();
    await expect(group.getByRole("link", { name: item.title })).toHaveAttribute("href", `/tasks/${item.id}`);
    await waitFor(() => expect(canvas.getByLabelText("Cold Backlog requests controls")).toHaveTextContent("1"));
    await waitFor(() => expect(canvas.getByLabelText("Cold Backlog requests sprints")).toHaveTextContent("1"));
    await expect(canvas.getByLabelText("Cold Backlog requests selected")).toHaveTextContent("0");
    await expect(canvas.getByLabelText("Cold Backlog requests unscoped")).toHaveTextContent("0");
  },
};
