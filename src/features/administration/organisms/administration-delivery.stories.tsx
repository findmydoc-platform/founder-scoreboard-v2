import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState, useSyncExternalStore } from "react";
import { expect, userEvent, within } from "storybook/test";
import type { BrowserApiClient, BrowserApiJsonResult } from "@/lib/browser-api-client";
import type { NotificationDelivery, NotificationEvent } from "@/lib/types";
import { createBrowserPlanningState } from "@/features/planning/model/internal/browser-planning-state";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { emptyPlanningHeaderData } from "@/lib/planning-header-data";
import { administrationStoryModel } from "./administration-workspace.stories";
import { AdministrationWorkspaceHost } from "./administration-workspace-host";
const ignored = () => { };
const event = (id: number): NotificationEvent => ({ id, type: "task_changed", actorProfileId: "actor", recipientProfileId: "recipient", entityType: "task", entityId: "task", title: `Delivery event ${id}`, body: "Synthetic event", status: "failed", seenAt: "", dismissedAt: "", resolvedAt: "", resolutionReason: "", createdAt: "2026-10-28T12:00:00Z" });
const delivery = (id: number, eventId: number, status: "sent" | "failed"): NotificationDelivery => ({ id, eventId, channel: "google_chat", status, attempts: 1, target: "recipient", lastError: status === "failed" ? "Previous failure" : "", deliveryMode: "direct_dm", digestSize: 1, deliveredAt: status === "sent" ? "2026-10-28T12:01:00Z" : "", createdAt: id === 71 ? "2026-10-28T12:01:00Z" : "2026-10-28T12:00:00Z" });
function DeliveryStory({ unknown = false }: {
    unknown?: boolean;
}) {
    const [open, setOpen] = useState(true);
    const [fixture] = useState(() => {
        let reads = 0, writes = 0;
        let model = { ...administrationStoryModel, notificationEvents: [event(7), event(8)], notificationDeliveries: [delivery(70, 7, "failed"), delivery(80, 8, "failed")], coverage: { people: "complete" as const, technical: true, notificationEvents: "partial" as const, notificationDeliveries: "partial" as const } };
        const bundle = createBrowserPlanningState({ initialData: emptyPlanningShellState, initialHeaderData: emptyPlanningHeaderData, initialCurrentProfile: { id: "actor", name: "Admin", platformRole: "ceo", githubLogin: "admin" }, initialUserId: "delivery-story", initialWorkspace: "administration", initialAdministratorAccess: { eligible: true, active: true, expiresAt: new Date(Date.now() + 3600000).toISOString() } });
        const client: BrowserApiClient = { requestJson: async <T,>(input: Parameters<BrowserApiClient["requestJson"]>[0]): Promise<BrowserApiJsonResult<T>> => {
                if (String(input) === "/api/administration-data") {
                    reads++;
                    if (!unknown && reads > 1)
                        return { response: new Response(null, { status: 503 }), body: { error: "Nachladen nicht verfügbar" } as T };
                    return { response: new Response(null), body: { administration: model } as T };
                }
                if (String(input) === "/api/notifications/deliver") {
                    writes++;
                    if (unknown) {
                        model = { ...model, notificationDeliveries: [delivery(71, 7, "sent"), ...model.notificationDeliveries] };
                        throw new Error("Zustellantwort verloren");
                    }
                    return { response: new Response(null), body: { ok: true, sent: 1, failed: 1, skipped: 0, results: [{ eventId: 7, status: "sent" }, { eventId: 8, status: "failed", error: "Provider rejected" }] } as T };
                }
                throw new Error("Unexpected delivery story request");
            }, requestForm: async () => { throw new Error("Unexpected upload"); }, requestBlob: async () => { throw new Error("Unexpected blob"); } };
        Object.assign(bundle.runtime, { apiClient: client, session:{userId:bundle.runtime.userId,revision:"story-session",expiresAt:Math.floor(Date.now()/1000)+3600,user:{id:bundle.runtime.userId}} });
        return { bundle, client, writes: () => writes };
    });
    useSyncExternalStore(fixture.bundle.owner.planning.subscribe, fixture.bundle.owner.internal.getSnapshot, fixture.bundle.owner.internal.getSnapshot);
    return <main className="min-h-screen bg-slate-50 p-4"><button onClick={() => setOpen(value => !value)}>Ansicht wechseln</button><output aria-label="Delivery writes">{fixture.writes()}</output>{open && <AdministrationWorkspaceHost planningState={fixture.bundle.owner.planning} apiClient={fixture.client} capabilities={administrationStoryModel.capabilities} onAdministratorAccessInvalid={ignored}/>}</main>;
}
const meta = { title: "Administration/Integrations/CoordinatedDelivery", component: DeliveryStory, parameters: { layout: "fullscreen" } } satisfies Meta<typeof DeliveryStory>;
export default meta;
type Story = StoryObj<typeof meta>;
export const MixedReceiptSurvivesFailedReload: Story = { play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        await userEvent.click(await canvas.findByRole("tab", { name: "Integrationen & Zustellung" }));
        await userEvent.click(canvas.getByRole("button", { name: /Technische Details/ }));
        await userEvent.click(canvas.getByRole("button", { name: "Ausstehende senden" }));
        await expect(await canvas.findByText("Zustellergebnis teilweise bestätigt")).toBeVisible();
        await expect(canvas.getByText("1 zugestellt, 1 fehlgeschlagen, 0 übersprungen")).toBeVisible();
        await expect(canvas.getByText("Die aktuellen Zustelldaten konnten nicht nachgeladen werden.")).toBeVisible();
        await expect(canvas.getByText("Ereignis 7: Zugestellt")).toBeVisible();
        await expect(canvas.getByText("Ereignis 8: Fehlgeschlagen")).toBeVisible();
        await expect(canvas.getByLabelText("Delivery writes")).toHaveTextContent("1");
    } };
export const UnknownDeliverySurvivesNavigationAndMatchingSentRead: Story = { args: { unknown: true }, play: async ({ canvasElement }) => {
        const canvas = within(canvasElement);
        await userEvent.click(await canvas.findByRole("tab", { name: "Integrationen & Zustellung" }));
        const article = canvas.getByRole("heading", { name: "Delivery event 7" }).closest("article")!;
        await userEvent.click(within(article).getByRole("button", { name: "Erneut senden" }));
        await expect(await canvas.findByText("Zustellung noch nicht bestätigt")).toBeVisible();
        await expect(within(article).getByRole("button", { name: "Erneut senden" })).toBeDisabled();
        await userEvent.click(canvas.getByRole("button", { name: "Ansicht wechseln" }));
        await userEvent.click(canvas.getByRole("button", { name: "Ansicht wechseln" }));
        await userEvent.click(await canvas.findByRole("tab", { name: "Integrationen & Zustellung" }));
        await userEvent.click(canvas.getByRole("button", { name: "Zustellstand prüfen" }));
        await expect(canvas.getByText("Zustellung noch nicht bestätigt")).toBeVisible();
        await expect(canvas.getByText("Der aktuelle Zustellstand bestätigt diesen Auftrag noch nicht.")).toBeVisible();
        const currentArticle = canvas.getByRole("heading", { name: "Delivery event 7" }).closest("article")!;
        await expect(within(currentArticle).getByText("Zugestellt")).toBeVisible();
        await expect(within(currentArticle).queryByRole("button", { name: "Erneut senden" })).not.toBeInTheDocument();
        await expect(canvas.getByLabelText("Delivery writes")).toHaveTextContent("1");
    } };
