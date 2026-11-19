import { useEffect, useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { PlanningApp } from "./PlanningApp";
import { PlanningStateProvider } from "./organisms/planning-state-provider";
import { emptyPlanningShellState } from "./model/planning-shell-state";
import { itemPageHeaderData, itemPageProfile, itemPageUser, mockItemPageBrowser } from "../../../tests/helpers/task-detail-page-browser-fixture";
import { productUpdates } from "@/features/product-updates/model/product-update-registry";

const teammate = { ...itemPageProfile, id: "team-ready-member", name: "Bea Team", platformRole: "founder" as const, weeklyCapacity: 37, persistenceBasis: { platform_role: "founder", org_role: "", weekly_capacity: 37 } };

function TeamMetricsReady() {
  const [ready, setReady] = useState(false);
  const [release, setRelease] = useState<(() => void) | undefined>();
  const [reads, setReads] = useState({ people: 0, metrics: 0, broad: 0 });
  useEffect(() => {
    let active = true;
    let restore: (() => void) | undefined;
    let releasePending: (() => void) | undefined;
    const seenKey = `founderops.product-updates.seen.${itemPageProfile.id}`;
    const previous = localStorage.getItem(seenKey);
    localStorage.setItem(seenKey, JSON.stringify(productUpdates.map(update => update.id)));
    void mockItemPageBrowser({ respond: input => {
      const url = new URL(String(input), window.location.origin);
      if (url.pathname === "/api/planning-board-data" || url.pathname === "/api/backlog-data") {
        setReads(current => ({ ...current, broad: current.broad + 1 }));
        return Response.json({ error: "Unexpected Planning enumeration" }, { status: 503 });
      }
      if (url.pathname !== "/api/team-data") return undefined;
      const deadline = Date.now() + 60_000;
      const envelope = { currentProfile: itemPageProfile, readAuthority: { userId: itemPageUser.id, deadline } };
      if (url.searchParams.get("area") === "people") {
        setReads(current => ({ ...current, people: current.people + 1 }));
        return Response.json({ ...envelope, model: { revision: "team-source-1", scopeRevision: "team-source-1", observedAt: new Date().toISOString(), people: [itemPageProfile, teammate], items: [], readCoverage: { people: "complete", items: "partial" } } });
      }
      if (url.searchParams.get("area") === "metrics") {
        setReads(current => ({ ...current, metrics: current.metrics + 1 }));
        return new Promise<Response>(resolve => {
          const finish = () => resolve(Response.json({ ...envelope, model: { revision: "team-source-1", scopeRevision: "team-source-1", observedAt: new Date().toISOString(), validUntil: null, coverage: "complete", metricsByProfileId: { [itemPageProfile.id]: { openTasks: 0, highPriorityTasks: 0, loadHours: 0 }, [teammate.id]: { openTasks: 7, highPriorityTasks: 2, loadHours: 15 } } } }));
          releasePending = finish;
          setRelease(() => finish);
        });
      }
      setReads(current => ({ ...current, broad: current.broad + 1 }));
      return Response.json({ error: "Unexpected Team enumeration" }, { status: 503 });
    } }).then(cleanup => { if (!active) cleanup(); else { restore = cleanup; setReady(true); } });
    return () => { active = false; releasePending?.(); restore?.(); if (previous === null) localStorage.removeItem(seenKey); else localStorage.setItem(seenKey, previous); };
  }, []);
  return <>
    <output aria-label="Team people reads">{reads.people}</output>
    <output aria-label="Team metrics reads">{reads.metrics}</output>
    <output aria-label="Broad Planning reads">{reads.broad}</output>
    {release && <button type="button" onClick={release}>Kennzahlen freigeben</button>}
    {ready && <PlanningStateProvider><PlanningApp initialWorkspace="team" initialData={{ ...emptyPlanningShellState, profiles: [itemPageProfile, teammate] }} initialHeaderData={itemPageHeaderData} initialAuthUser={itemPageUser} initialCurrentProfile={itemPageProfile} initialProtectedDataLoaded authRequired source="supabase" /></PlanningStateProvider>}
  </>;
}

const meta = { title: "Planning/Team metrics readiness", component: TeamMetricsReady, parameters: { layout: "fullscreen", nextjs: { appDirectory: true, navigation: { pathname: "/team" } } } } satisfies Meta<typeof TeamMetricsReady>;
export default meta;
type Story = StoryObj<typeof meta>;

export const InitialPeopleStayEditableUntilCompleteMetricsArrive: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const heading = await canvas.findByRole("heading", { name: "Bea Team" });
    const card = heading.closest("article");
    if (!card) throw new Error("Team member card is missing");
    await expect(within(card).queryByText("0", { exact: true })).not.toBeInTheDocument();
    await expect(within(card).queryByText("0h", { exact: true })).not.toBeInTheDocument();
    await userEvent.click(within(card).getByRole("button", { name: "Bea Team bearbeiten" }));
    const dialog = within(await canvas.findByRole("dialog", { name: "Bea Team bearbeiten" }));
    await expect(dialog.getByRole("spinbutton", { name: "Kapazität" })).toHaveValue(37);
    await userEvent.click(dialog.getByRole("button", { name: "Schließen" }));
    await userEvent.click(await canvas.findByRole("button", { name: "Kennzahlen freigeben" }));
    await waitFor(() => expect(within(card).getByText("7", { exact: true })).toBeVisible());
    await expect(within(card).getByText("2", { exact: true })).toBeVisible();
    await expect(within(card).getByText("15h", { exact: true })).toBeVisible();
    await expect(canvas.getByLabelText("Broad Planning reads")).toHaveTextContent(/^0$/);
    await expect(canvas.getByLabelText("Team metrics reads")).not.toHaveTextContent(/^0$/);
  },
};
