import { useEffect, useRef, useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { PlanningApp } from "./PlanningApp";
import { PlanningStateProvider } from "./organisms/planning-state-provider";
import { emptyPlanningShellState } from "./model/planning-shell-state";
import { itemPageHeaderData, itemPageProfile, itemPageUser, mockItemPageBrowser } from "../../../tests/helpers/task-detail-page-browser-fixture";
import { productUpdates } from "@/features/product-updates/model/product-update-registry";

const teammate = { ...itemPageProfile, id: "retry-team-member", name: "Bea Team", platformRole: "founder" as const, weeklyCapacity: 37, persistenceBasis: { platform_role: "founder", org_role: "", weekly_capacity: 37 } };

function TeamMetricsRetry() {
  const sourceRevision = useRef("team-source-1");
  const [ready, setReady] = useState(false);
  const [reads, setReads] = useState({ people: 0, metrics: 0, broad: 0 });
  useEffect(() => {
    let active = true;
    let restore: (() => void) | undefined;
    const seenKey = `founderops.product-updates.seen.${itemPageProfile.id}`;
    const previous = localStorage.getItem(seenKey);
    localStorage.setItem(seenKey, JSON.stringify(productUpdates.map(update => update.id)));
    void mockItemPageBrowser({ respond: input => {
      const url = new URL(String(input), window.location.origin);
      if (url.pathname === "/api/planning-board-data" || url.pathname === "/api/backlog-data") {
        setReads(current => ({ ...current, broad: current.broad + 1 }));
        return Response.json({ error: "Unexpected Planning enumeration" }, { status: 503 });
      }
      if (url.pathname === "/api/planning-source-version") return Response.json({ version: sourceRevision.current });
      if (url.pathname !== "/api/team-data") return undefined;
      const envelope = { currentProfile: itemPageProfile, readAuthority: { userId: itemPageUser.id, deadline: Date.now() + 60_000 } };
      if (url.searchParams.get("area") === "people") {
        setReads(current => ({ ...current, people: current.people + 1 }));
        return Response.json({ ...envelope, model: { revision: sourceRevision.current, scopeRevision: sourceRevision.current, observedAt: new Date().toISOString(), people: [itemPageProfile, teammate], items: [], readCoverage: { people: "complete", items: "partial" } } });
      }
      if (url.searchParams.get("area") === "metrics") {
        setReads(current => ({ ...current, metrics: current.metrics + 1 }));
        return Response.json({ ...envelope, model: { revision: sourceRevision.current, scopeRevision: sourceRevision.current, observedAt: new Date().toISOString(), validUntil: null, coverage: "complete", metricsByProfileId: { [itemPageProfile.id]: { openTasks: 0, highPriorityTasks: 0, loadHours: 0 }, [teammate.id]: { openTasks: 7, highPriorityTasks: 2, loadHours: 15 } } } });
      }
      setReads(current => ({ ...current, broad: current.broad + 1 }));
      return Response.json({ error: "Unexpected Team enumeration" }, { status: 503 });
    } }).then(cleanup => { if (!active) cleanup(); else { restore = cleanup; setReady(true); } });
    return () => { active = false; restore?.(); if (previous === null) localStorage.removeItem(seenKey); else localStorage.setItem(seenKey, previous); };
  }, []);
  return <>
    <button type="button" onClick={() => { sourceRevision.current = "team-source-2"; window.dispatchEvent(new Event("online")); }}>Online event</button>
    <button type="button" onClick={() => { sourceRevision.current = "team-source-3"; document.dispatchEvent(new Event("visibilitychange")); }}>Visibility event</button>
    <output aria-label="People reads">{reads.people}</output>
    <output aria-label="Metrics reads">{reads.metrics}</output>
    <output aria-label="Broad Team reads">{reads.broad}</output>
    {ready && <PlanningStateProvider><PlanningApp initialWorkspace="team" initialData={{ ...emptyPlanningShellState, profiles: [itemPageProfile] }} initialHeaderData={itemPageHeaderData} initialAuthUser={itemPageUser} initialCurrentProfile={itemPageProfile} initialProtectedDataLoaded={false} authRequired source="supabase" /></PlanningStateProvider>}
  </>;
}
const meta = { title: "Planning/Team source events", component: TeamMetricsRetry, parameters: { layout: "fullscreen", nextjs: { appDirectory: true, navigation: { pathname: "/team" } } } } satisfies Meta<typeof TeamMetricsRetry>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ChangedSourceRefreshesOnOnlineAndVisibility: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const heading = await canvas.findByRole("heading", { name: "Bea Team" });
    const card = heading.closest("article");
    if (!card) throw new Error("Team member card is missing");
    await waitFor(() => expect(within(card).getByText("7", { exact: true })).toBeVisible());
    const people = () => Number(canvas.getByLabelText("People reads").textContent);
    const metrics = () => Number(canvas.getByLabelText("Metrics reads").textContent);
    const firstPeople = people(), firstMetrics = metrics();
    await userEvent.click(canvas.getByRole("button", { name: "Online event" }));
    await waitFor(() => expect(people()).toBeGreaterThan(firstPeople));
    await waitFor(() => expect(metrics()).toBeGreaterThan(firstMetrics));
    const secondPeople = people(), secondMetrics = metrics();
    await userEvent.click(canvas.getByRole("button", { name: "Visibility event" }));
    await waitFor(() => expect(people()).toBeGreaterThan(secondPeople));
    await waitFor(() => expect(metrics()).toBeGreaterThan(secondMetrics));
    await expect(canvas.getByRole("heading", { name: "Bea Team" })).toBeVisible();
    await expect(canvas.getByLabelText("Broad Team reads")).toHaveTextContent(/^0$/);
  },
};
