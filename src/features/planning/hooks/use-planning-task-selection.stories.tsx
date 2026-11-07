import { useEffect, useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { usePlanningAppController } from "./use-planning-app-controller";
import { PlanningStateProvider } from "../organisms/planning-state-provider";
import { PlanningOverlayLayer } from "../organisms/planning-overlay-layer";
import { emptyPlanningShellState } from "../model/planning-shell-state";
import { TaskReferenceLink } from "@/features/tasks/atoms/task-reference-link";
import { productUpdates } from "@/features/product-updates/model/product-update-registry";
import { itemPageModel, itemPageProfile, itemPageUser, itemPageHeaderData, mockItemPageBrowser } from "../../../../tests/helpers/task-detail-page-browser-fixture";

const model = itemPageModel();
let finishRead: (() => void) | undefined;
function PanelController() {
  const controller = usePlanningAppController({ initialData: { ...emptyPlanningShellState, profiles: [itemPageProfile] }, initialHeaderData: itemPageHeaderData, initialWorkspace: "planning", source: "supabase", authRequired: true, initialAuthUser: itemPageUser, initialCurrentProfile: itemPageProfile, initialProtectedDataLoaded: true });
  return <><TaskReferenceLink task={{ id: model.item.id, title: "Verknüpftes Item öffnen" }} onOpenTask={controller.openTaskPanel} /><PlanningOverlayLayer controller={controller} /></>;
}
function UnloadedPanelFlow({ fail = false, forbidden = false }: { fail?: boolean; forbidden?: boolean }) {
  const [ready, setReady] = useState(false);
  useEffect(() => {
    finishRead = undefined;
    let reads = 0;
    let active = true;
    let restore: (() => void) | undefined;
    const seenKey = `founderops.product-updates.seen.${itemPageProfile.id}`;
    const previous = localStorage.getItem(seenKey);
    localStorage.setItem(seenKey, JSON.stringify(productUpdates.map(update => update.id)));
    void mockItemPageBrowser({ respond: input => {
      const path = new URL(String(input), window.location.origin).pathname;
      if (path === "/api/planning-board-data") return Response.json({ model: { revision: "panel-r1", project: model.project, items: [], people: [itemPageProfile], sprints: [], relationships: [], preferences: [], coverage: { items: "partial" } }, currentProfile: itemPageProfile });
      if (path === `/api/tasks/${model.item.id}/detail-data`) {
        if (forbidden) return Response.json({ error: "Kein Zugriff auf diese Aufgabe." }, { status: 403 });
        if (fail && reads++ === 0) return Response.json({ error: "Details sind vorübergehend nicht erreichbar." }, { status: 503 });
        return new Promise<Response>(resolve => { finishRead = () => resolve(Response.json({ taskDetail: model, unavailable: [] })); });
      }
      return undefined;
    } }).then(cleanup => { if (!active) cleanup(); else { restore = cleanup; setReady(true); } });
    return () => { active = false; restore?.(); if (previous === null) localStorage.removeItem(seenKey); else localStorage.setItem(seenKey, previous); };
  }, [fail, forbidden]);
  return ready ? <PlanningStateProvider><PanelController /></PlanningStateProvider> : null;
}
const meta = {
  title: "Planning/Unloaded Item navigation",
  component: UnloadedPanelFlow,
  // These stories control the detail read independently of UI module compilation.
  loaders: [async () => { await import("@/features/tasks/organisms/task-detail-panel"); return {}; }],
  parameters: { layout: "fullscreen", nextjs: { appDirectory: true, navigation: { pathname: "/planning" } } },
} satisfies Meta<typeof UnloadedPanelFlow>;
export default meta;
type Story = StoryObj<typeof meta>;
export const UnloadedItemOpensThroughTheSharedDetailBoundary: Story = { play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await userEvent.click(await canvas.findByRole("link", { name: "Verknüpftes Item öffnen" }));
  await expect(await canvas.findByRole("dialog", { name: "Item-Detail" })).toBeVisible();
  await expect(canvas.getByText("Aufgabendetails werden geladen …")).toBeVisible();
  await waitFor(() => expect(finishRead).toBeDefined());
  finishRead?.();
  await expect(await canvas.findByRole("dialog", { name: model.item.title })).toBeVisible();
  await expect(await canvas.findByText("Keep the planning context.")).toBeVisible();
  await userEvent.keyboard("{Escape}");
  await waitFor(() => expect(canvas.queryByRole("dialog")).not.toBeInTheDocument());
  await waitFor(() => expect(canvas.getByRole("link", { name: "Verknüpftes Item öffnen" })).toHaveFocus());
} };
export const FailedUnloadedItemRetainsSelectionForRetry: Story = { args: { fail: true }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await userEvent.click(await canvas.findByRole("link", { name: "Verknüpftes Item öffnen" }));
  const panel = await canvas.findByRole("dialog", { name: "Item-Detail" });
  await expect(await within(panel).findByText("Details sind vorübergehend nicht erreichbar.")).toBeVisible();
  await waitFor(() => expect(within(panel).getAllByRole("button", { name: "Detailpanel schließen" }).find(button => button.tabIndex === 0)).toHaveFocus());
  const retry = within(panel).getByRole("button", { name: "Erneut laden" });
  await userEvent.click(retry);
  await waitFor(() => expect(finishRead).toBeDefined());
  await expect(retry).toHaveFocus();
  finishRead?.();
  await expect(await canvas.findByRole("dialog", { name: model.item.title })).toBeVisible();
} };
export const DeniedUnloadedItemShowsNoProtectedDetails: Story = { args: { forbidden: true }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await userEvent.click(await canvas.findByRole("link", { name: "Verknüpftes Item öffnen" }));
  const panel = await canvas.findByRole("dialog", { name: "Item-Detail" });
  await expect(await within(panel).findByText("Kein Zugriff auf diese Aufgabe.")).toBeVisible();
  await expect(canvas.queryByText(model.item.title)).not.toBeInTheDocument();
  await expect(canvas.queryByText("Keep the planning context.")).not.toBeInTheDocument();
} };
