import { useEffect, useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { PlanningApp } from "./PlanningApp";
import { PlanningStateProvider } from "./organisms/planning-state-provider";
import { emptyPlanningShellState } from "./model/planning-shell-state";
import { itemPageHeaderData, itemPageProfile, itemPageUser, mockItemPageBrowser } from "../../../tests/helpers/task-detail-page-browser-fixture";
import { productUpdates } from "@/features/product-updates/model/product-update-registry";

const teammate = { ...itemPageProfile, id: "independent-team-member", name: "Bea Team", platformRole: "founder" as const, weeklyCapacity: 37, persistenceBasis: { platform_role: "founder", org_role: "", weekly_capacity: 37 } };

function IndependentTeamPeople() {
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
        return Response.json({ error: "Unrelated Planning enumeration" }, { status: 503 });
      }
      if (url.pathname !== "/api/team-data") return undefined;
      if (url.searchParams.get("area") === "people") {
        setReads(current => ({ ...current, people: current.people + 1 }));
        return Response.json({ model: { revision: "team-source-1", scopeRevision: "team-source-1", observedAt: new Date().toISOString(), people: [itemPageProfile, teammate], items: [], readCoverage: { people: "complete", items: "partial" } }, currentProfile: itemPageProfile, readAuthority: { userId: itemPageUser.id, deadline: Date.now() + 60_000 } });
      }
      if (url.searchParams.get("area") === "metrics") {
        setReads(current => ({ ...current, metrics: current.metrics + 1 }));
        return Response.json({ error: "Metrics temporarily unavailable" }, { status: 503 });
      }
      setReads(current => ({ ...current, broad: current.broad + 1 }));
      return Response.json({ error: "Planning enumeration unavailable" }, { status: 503 });
    } }).then(cleanup => { if (!active) cleanup(); else { restore = cleanup; setReady(true); } });
    return () => { active = false; restore?.(); if (previous === null) localStorage.removeItem(seenKey); else localStorage.setItem(seenKey, previous); };
  }, []);
  return <>
    <output aria-label="People reads">{reads.people}</output>
    <output aria-label="Metrics reads">{reads.metrics}</output>
    <output aria-label="Broad Team reads">{reads.broad}</output>
    {ready && <PlanningStateProvider><PlanningApp initialWorkspace="team" initialData={{ ...emptyPlanningShellState, profiles: [itemPageProfile] }} initialHeaderData={itemPageHeaderData} initialAuthUser={itemPageUser} initialCurrentProfile={itemPageProfile} initialProtectedDataLoaded authRequired source="supabase" /></PlanningStateProvider>}
  </>;
}

const meta = { title: "Planning/Independent Team people", component: IndependentTeamPeople, parameters: { layout: "fullscreen", nextjs: { appDirectory: true, navigation: { pathname: "/team" } } } } satisfies Meta<typeof IndependentTeamPeople>;
export default meta;
type Story = StoryObj<typeof meta>;

export const PeopleAndCeoEditingRemainAvailableWhenMetricsFail: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole("heading", { name: "Bea Team" })).toBeVisible();
    await waitFor(() => expect(canvas.getByLabelText("Metrics reads")).not.toHaveTextContent(/^0$/));
    await expect(canvas.getByLabelText("People reads")).not.toHaveTextContent(/^0$/);
    await expect(canvas.getByLabelText("Broad Team reads")).toHaveTextContent(/^0$/);
    const card = canvas.getByRole("heading", { name: "Bea Team" }).closest("article");
    if (!card) throw new Error("Team member card is missing");
    await expect(within(card).queryByText("0", { exact: true })).not.toBeInTheDocument();
    await expect(within(card).queryByText("0h", { exact: true })).not.toBeInTheDocument();
    await userEvent.click(within(card).getByRole("button", { name: "Bea Team bearbeiten" }));
    const dialog = within(await canvas.findByRole("dialog", { name: "Bea Team bearbeiten" }));
    await expect(dialog.getByRole("spinbutton", { name: "Kapazität" })).toHaveValue(37);
    await expect(canvas.getByLabelText("Broad Team reads")).toHaveTextContent(/^0$/);
  },
};
