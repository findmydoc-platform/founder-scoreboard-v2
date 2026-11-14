import { Suspense, use, useState, useSyncExternalStore } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";
import { PlanningBusinessStateContext } from "../hooks/use-planning-business-state";
import { createPlanningState } from "../model/internal/planning-state-owner";
import { emptyPlanningShellState } from "../model/planning-shell-state";
import { emptyPlanningHeaderData, readyHeaderSlot } from "@/lib/planning-header-data";
import { PlanningServerHeaderReceipt } from "./planning-server-header-receipt";
import { defaultFmdToolDraft } from "@/features/tools/model/fmd-tools";
import type { PlanningServerHeaderRead, PlanningServerHeaderResult, PlanningServerHeaderSlot } from "../model/planning-server-header-read";

function deferred() {
  let resolve!: (value: PlanningServerHeaderResult) => void;
  const promise = new Promise<PlanningServerHeaderResult>(done => { resolve = done; });
  return { promise, resolve };
}
function DeliveredSlot({ read, slot, result }: { read: PlanningServerHeaderRead; slot: PlanningServerHeaderSlot; result: Promise<PlanningServerHeaderResult> }) {
  return <PlanningServerHeaderReceipt read={read} slot={slot} result={use(result)} />;
}
function StreamedHeader() {
  const [fixture] = useState(() => {
    const session = { userId: "streamed-user", revision: "original-session", expiresAt: Math.floor(Date.now() / 1000) + 3600, user: { id: "streamed-user" } };
    const read = { id: "original-page", userId: session.userId, sessionRevision: session.revision, deadline: Date.now() + 60_000, timeoutAt: Date.now() + 15_000 };
    const quickLinks = deferred(), calendarEvents = deferred();
    const owner = createPlanningState({ userId: session.userId, initialSession: session, initialServerHeaderRead: read, initialData: emptyPlanningShellState, adapter: {
      saveTask: async () => ({ task: {} }), readWorkspace: async () => null,
      createTool: async draft => ({ tool: { ...draft, id: "saved", sortOrder: 10, updatedAt: "r2" } }),
      readHeader: async () => ({ ...emptyPlanningHeaderData, quickLinks: readyHeaderSlot([{ id: "saved", name: "Confirmed client links", category: "tool", url: "https://example.com", previewImageUrl: "" }]) }),
    } });
    return { ...owner, read, quickLinks, calendarEvents };
  });
  const [shown, setShown] = useState(true);
  useSyncExternalStore(fixture.planning.subscribe, fixture.internal.getSnapshot, fixture.internal.getSnapshot);
  const view = fixture.planning.header();
  return <PlanningBusinessStateContext.Provider value={fixture.planning}>
    <a href="#card">Available Planning card</a>
    <label>Card draft<input defaultValue="Preserved draft" /></label>
    <p>Calendar: {view.slots.calendarEvents.readStatus}</p>
    <p>Quick Links: {view.slots.quickLinks.readStatus}</p>
    {view.data.quickLinks.data.map(link => <p key={link.id}>{link.name}</p>)}
    <button onClick={() => fixture.calendarEvents.resolve({ headerData: { ...emptyPlanningHeaderData, calendarEvents: readyHeaderSlot([]) } })}>Release Calendar</button>
    <button onClick={() => fixture.quickLinks.resolve({ headerData: { ...emptyPlanningHeaderData, quickLinks: { state: "error", data: [], error: "Links unavailable" } } })}>Fail delayed links</button>
    <button onClick={() => { void fixture.planning.createTool("client-change", { ...defaultFmdToolDraft(), description: "Confirmed curated link", name: "Confirmed client links", url: "https://example.com", isCurated: true }); }}>Confirm affected client change</button>
    <button onClick={() => setShown(false)}>Leave receipt area</button>
    <button onClick={() => setShown(true)}>Replay receipt area</button>
    {shown ? <><Suspense fallback={null}><DeliveredSlot read={fixture.read} slot="quickLinks" result={fixture.quickLinks.promise} /></Suspense><Suspense fallback={null}><DeliveredSlot read={fixture.read} slot="calendarEvents" result={fixture.calendarEvents.promise} /></Suspense></> : null}
  </PlanningBusinessStateContext.Provider>;
}
const meta = { component: StreamedHeader, title: "Planning/Entry/ServerHeaderReceipts" } satisfies Meta<typeof StreamedHeader>;
export default meta;
type Story = StoryObj<typeof meta>;
export const IndependentRevealAndFailure: Story = { play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await expect(canvas.getByRole("link", { name: "Available Planning card" })).toBeVisible();
  const input = canvas.getByRole("textbox", { name: "Card draft" });
  await userEvent.clear(input); await userEvent.type(input, "Unsaved input");
  await userEvent.click(canvas.getByRole("button", { name: "Release Calendar" }));
  await expect(await canvas.findByText("Calendar: current")).toBeVisible();
  await expect(canvas.getByText("Quick Links: loading")).toBeVisible();
  await userEvent.click(canvas.getByRole("button", { name: "Fail delayed links" }));
  await expect(await canvas.findByText("Quick Links: unavailable")).toBeVisible();
  await expect(canvas.getByText("Calendar: current")).toBeVisible();
  await expect(input).toHaveValue("Unsaved input");
} };
export const ConfirmedWriteSurvivesLateDeliveryAndRemount: Story = { play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await userEvent.click(canvas.getByRole("button", { name: "Confirm affected client change" }));
  await expect(await canvas.findByText("Confirmed client links")).toBeVisible();
  await userEvent.click(canvas.getByRole("button", { name: "Fail delayed links" }));
  await userEvent.click(canvas.getByRole("button", { name: "Leave receipt area" }));
  await userEvent.click(canvas.getByRole("button", { name: "Replay receipt area" }));
  await expect(canvas.getByText("Confirmed client links")).toBeVisible();
  await expect(canvas.getByText("Quick Links: current")).toBeVisible();
} };
