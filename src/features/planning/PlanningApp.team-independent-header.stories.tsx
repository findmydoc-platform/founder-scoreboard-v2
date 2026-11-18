import { Suspense, use, useEffect, useState, useSyncExternalStore } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { PlanningApp } from "./PlanningApp";
import { teamWorkspaceHydration, type PlanningWorkspaceHydration } from "./model/planning-workspace-hydration";
import { createBrowserSessionAdapter } from "@/lib/credentials/browser";
import { PlanningStateProvider } from "./organisms/planning-state-provider";
import { emptyPlanningShellState } from "./model/planning-shell-state";
import { itemPageHeaderData, itemPageProfile, itemPageUser, mockItemPageBrowser } from "../../../tests/helpers/task-detail-page-browser-fixture";
import { emptyPlanningHeaderData } from "@/lib/planning-header-data";
import { PlanningServerHeaderReceipt } from "./organisms/planning-server-header-receipt";
import { usePlanningBusinessState } from "./hooks/use-planning-business-state";
import type { PlanningServerHeaderRead, PlanningServerHeaderResult, PlanningServerHeaderSlot } from "./model/planning-server-header-read";
import { productUpdates } from "@/features/product-updates/model/product-update-registry";

const teammate = { ...itemPageProfile, id: "team-ready-member", name: "Bea Team", platformRole: "founder" as const, weeklyCapacity: 37, persistenceBasis: { platform_role: "founder", org_role: "", weekly_capacity: 37 } };

function heldSlot() {
  let resolve!: (result: PlanningServerHeaderResult) => void;
  const promise = new Promise<PlanningServerHeaderResult>(done => { resolve = done; });
  return { promise, resolve };
}
function Delivered({ read, slot, result }: { read: PlanningServerHeaderRead; slot: PlanningServerHeaderSlot; result: Promise<PlanningServerHeaderResult> }) {
  return <PlanningServerHeaderReceipt read={read} slot={slot} result={use(result)} />;
}
function HeaderStatus() {
  const owner = usePlanningBusinessState();
  const snapshot = () => owner ? `${owner.header().slots.quickLinks.readStatus}/${owner.header().slots.calendarEvents.readStatus}` : "none";
  const state = useSyncExternalStore(owner?.subscribe || (() => () => {}), snapshot, snapshot);
  return <output aria-label="Reserved Header state">{state}</output>;
}

function TeamIndependentHeader() {
  const [slots] = useState(() => ({ quickLinks: heldSlot(), calendarEvents: heldSlot() }));
  const [headerRead, setHeaderRead] = useState<PlanningServerHeaderRead>();
  const [read, setRead] = useState<PlanningWorkspaceHydration>();
  const [release, setRelease] = useState<(() => void) | undefined>();
  const [reads, setReads] = useState({ people: 0, metrics: 0, broad: 0, header: 0 });
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
      if (url.pathname === "/api/planning-header-data") {
        const requested = (url.searchParams.get("slots") || "").split(",").filter(Boolean);
        if (!requested.length || requested.some(slot => slot === "quickLinks" || slot === "calendarEvents")) setReads(current => ({ ...current, header: current.header + 1 }));
        return undefined;
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
        return Response.json({ ...envelope, model: { revision: "team-source-1", scopeRevision: "team-source-1", observedAt: new Date().toISOString(), validUntil: null, coverage: "complete", metricsByProfileId: { [itemPageProfile.id]: { openTasks: 0, highPriorityTasks: 0, loadHours: 0 }, [teammate.id]: { openTasks: 7, highPriorityTasks: 2, loadHours: 15 } } } });
      }
      setReads(current => ({ ...current, broad: current.broad + 1 }));
      return Response.json({ error: "Unexpected Team enumeration" }, { status: 503 });
    } }).then(async cleanup => {
      const session = await createBrowserSessionAdapter().current();
      if (!active) { cleanup(); return; }
      restore = cleanup;
      const model = { revision: "team-source-1", scopeRevision: "team-source-1", observedAt: new Date().toISOString(), people: [itemPageProfile, teammate], items: [], readCoverage: { people: "complete" as const, items: "partial" as const } };
      const hydration = teamWorkspaceHydration(model, session || undefined, { userId: itemPageUser.id, deadline: Date.now() + 60_000 });
      if (!hydration) throw new Error("Team SSR receipt is unavailable");
      if (!hydration.readAuthority) throw new Error("Original Header authority missing");
      setHeaderRead({ ...hydration.readAuthority, id: "team-original-header", sessionRevision: hydration.session.revision, timeoutAt: Date.now() + 15_000 });
      const finish = () => {
        slots.quickLinks.resolve({ headerData: itemPageHeaderData });
        slots.calendarEvents.resolve({ headerData: itemPageHeaderData });
      };
      releasePending = finish;
      setRelease(() => finish);
      setRead(hydration);
    });
    return () => { active = false; releasePending?.(); restore?.(); if (previous === null) localStorage.removeItem(seenKey); else localStorage.setItem(seenKey, previous); };
  }, [slots]);
  return <>
    <output aria-label="Team people reads">{reads.people}</output>
    <output aria-label="Team metrics reads">{reads.metrics}</output>
    <output aria-label="Header browser reads">{reads.header}</output>
    <output aria-label="Broad Planning reads">{reads.broad}</output>
    {release && <button type="button" onClick={release}>Header freigeben</button>}
    {read && headerRead && <PlanningStateProvider><PlanningApp initialWorkspaceRead={read} initialWorkspace="team" initialData={{ ...emptyPlanningShellState, profiles: [itemPageProfile, teammate] }} initialServerHeaderRead={headerRead} initialHeaderData={emptyPlanningHeaderData} initialAuthUser={itemPageUser} initialCurrentProfile={itemPageProfile} initialProtectedDataLoaded authRequired source="supabase"><HeaderStatus /><Suspense fallback={null}><Delivered read={headerRead} slot="quickLinks" result={slots.quickLinks.promise} /></Suspense><Suspense fallback={null}><Delivered read={headerRead} slot="calendarEvents" result={slots.calendarEvents.promise} /></Suspense></PlanningApp></PlanningStateProvider>}
  </>;
}

const meta = { title: "Planning/Team independent reserved Header", component: TeamIndependentHeader, parameters: { layout: "fullscreen", nextjs: { appDirectory: true, navigation: { pathname: "/team" } } } } satisfies Meta<typeof TeamMetricsReady>;
export default meta;
type Story = StoryObj<typeof meta>;

export const PeopleAndMetricsStayUsableWhileHeaderIsHeld: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const heading = await canvas.findByRole("heading", { name: "Bea Team" });
    const card = heading.closest("article");
    if (!card) throw new Error("Team member card is missing");
    await waitFor(() => expect(within(card).getByText("15h", { exact: true })).toBeVisible());
    await expect(canvas.getByLabelText("Reserved Header state")).toHaveTextContent(/^loading\/loading$/);
    await userEvent.click(within(card).getByRole("button", { name: "Bea Team bearbeiten" }));
    const dialog = within(await canvas.findByRole("dialog", { name: "Bea Team bearbeiten" }));
    await expect(dialog.getByRole("spinbutton", { name: "Kapazität" })).toHaveValue(37);
    await userEvent.click(dialog.getByRole("button", { name: "Schließen" }));
    await expect(canvas.getByLabelText("Reserved Header state")).toHaveTextContent(/^loading\/loading$/);
    await userEvent.click(canvas.getByRole("button", { name: "Header freigeben" }));
    await waitFor(() => expect(canvas.getByLabelText("Reserved Header state")).toHaveTextContent(/^current\/current$/));
    await userEvent.click(canvas.getByRole("button", { name: "Kuratierte Links" }));
    await expect(await within(document.body).findByRole("link", { name: /Team guide/ })).toBeVisible();
    await expect(canvas.getByLabelText("Team people reads")).toHaveTextContent(/^0$/);
    await expect(canvas.getByLabelText("Team metrics reads")).toHaveTextContent(/^1$/);
    await expect(canvas.getByLabelText("Header browser reads")).toHaveTextContent(/^0$/);
    await expect(canvas.getByLabelText("Broad Planning reads")).toHaveTextContent(/^0$/);
  },
};
