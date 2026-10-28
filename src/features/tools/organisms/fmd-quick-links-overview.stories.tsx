import { useState, useSyncExternalStore } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { FmdQuickLinksOverview } from "./fmd-quick-links-overview";
import { FmdToolQuickLinks } from "../molecules/fmd-tool-quick-links";
import { useFmdToolCommands } from "../hooks/use-fmd-tool-commands";
import { createPlanningState } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { emptyPlanningHeaderData, projectHeaderQuickLinks, readyHeaderSlot } from "@/lib/planning-header-data";
import type { FmdTool, Profile } from "@/lib/types";
import type { BrowserApiClient } from "@/lib/browser-api-client";
import type { FmdToolDraft, FmdToolMetadataDraft, FmdToolPreviewImageUpload } from "../model/fmd-tools";
const profile: Profile = { id: "member", name: "Teammitglied", platformRole: "founder", orgRole: "Founder", githubLogin: "member", weeklyCapacity: 40, color: "#2563eb" };
const initial: FmdTool = { id: "tool-1", name: "Founder-Werkzeug", category: "tool", kind: "Werkzeuge", description: "Ein bestätigtes Werkzeug", url: "https://tools.example.test/", owner: "Team", status: "active", isCurated: true, previewImageUrl: "", previewImageSource: "none", sortOrder: 10, updatedAt: "r1" };
const image: FmdToolPreviewImageUpload = { imageUrl: "/api/tools/preview-image?path=quicklinks%2F2099-01-01%2F123-preview.png", source: "manual" };
type Scenario = "saved" | "rejected" | "unknown" | "metadata" | "metadata-failure" | "conflict" | "lost-upload" | "held-upload" | "held-metadata";
function transport(scenario: Scenario) {
  let finishUpload!: (value: FmdToolPreviewImageUpload) => void, finishMetadata!: (value: FmdToolMetadataDraft) => void;
  const state = { tools: [initial], writes: 0, uploads: 0, reads: 0, metadataReads: 0,
    metadata: async () => { state.metadataReads++; if (scenario === "metadata-failure") return null; if (scenario === "held-metadata") return new Promise<FmdToolMetadataDraft>(resolve => { finishMetadata = resolve; }); return scenario === "metadata" ? { title: "Metadaten-Titel", description: "Beschreibung aus Metadaten", imageUrl: "", siteName: "Tool" } : { title: "", description: "", imageUrl: "", siteName: "" }; },
    upload: async () => { state.uploads++; if (scenario === "lost-upload") throw new Error("Upload-Antwort verloren"); if (scenario === "held-upload") return new Promise<FmdToolPreviewImageUpload>(resolve => { finishUpload = resolve; }); return image; },
    write: async (draft: FmdToolDraft, basis?: FmdTool) => {
      state.writes++;
      if (scenario === "rejected") throw Object.assign(new Error("Link abgelehnt"), { status: 422 });
      if (scenario === "unknown") throw new Error("Speicherantwort verloren");
      if (scenario === "conflict" && basis?.updatedAt === "r1") { state.tools = [{ ...initial, name: "Fremder Serverstand", updatedAt: "foreign" }]; throw Object.assign(new Error("Version changed"), { status: 409, code: "tool_version_conflict" }); }
      const tool = { ...initial, ...draft, id: basis?.id || "created", updatedAt: "r2" }; state.tools = [...state.tools.filter(item => item.id !== tool.id), tool]; return { tool };
    },
    completeUpload: () => finishUpload(image), completeMetadata: () => finishMetadata({ title: "Verspäteter Titel", description: "Verspätete Beschreibung", imageUrl: "", siteName: "" }),
  }; return state;
}
const transports = new Map<Scenario, ReturnType<typeof transport>>();
function CoordinatedTools({ scenario = "saved" }: { scenario?: Scenario }) {
  const [server] = useState(() => { const value = transport(scenario); transports.set(scenario, value); return value; });
  const [owner] = useState(() => createPlanningState({ userId: "tools-story", initialWorkspace: "tools", initialData: { ...emptyPlanningShellState, fmdTools: [initial] }, initialHeaderData: { ...emptyPlanningHeaderData, quickLinks: readyHeaderSlot(projectHeaderQuickLinks([initial])) }, adapter: {
    saveTask: async () => ({ task: {} }), readWorkspace: async () => null, createTool: draft => server.write(draft), updateTool: (basis, draft) => server.write(draft, basis), uploadToolPreview: server.upload,
    readTools: async () => { server.reads++; return { tools: server.tools, completeness: "complete" }; }, readHeader: async () => ({ ...emptyPlanningHeaderData, quickLinks: readyHeaderSlot(projectHeaderQuickLinks(server.tools)) }),
  } }));
  const data = useSyncExternalStore(owner.planning.subscribe, owner.internal.getSnapshot, owner.internal.getSnapshot);
  const [error, setSaveError] = useState(""), [open, setOpen] = useState(false), [show, setShow] = useState(true);
  const apiClient: BrowserApiClient = { requestJson: async <T,>() => { const metadata = await server.metadata(); return { response: new Response(null, { status: metadata ? 200 : 503 }), body: { metadata } as T }; }, requestForm: async () => { throw new Error("Unused fixture form transport"); }, requestBlob: async () => { throw new Error("Unused fixture blob transport"); } };
  const commands = useFmdToolCommands({ apiClient, planningState: owner.planning, currentProfile: profile, setSaveError });
  return <main className="min-h-screen p-4"><h1>Links im gemeinsamen Planning-Zustand</h1><p>Writes: {server.writes}</p><p>Uploads: {server.uploads}</p><p>Tools: {data.fmdTools.length}</p>
    <div className="flex justify-end"><FmdToolQuickLinks quickLinks={owner.planning.header().data.quickLinks} open={open} onToggle={() => setOpen(value => !value)} /></div>
    <button onClick={() => setShow(value => !value)}>Bereich wechseln</button><button onClick={() => owner.internal.sessionChanged("replacement")}>Konto wechseln</button>
    {error ? <p role="alert">{error}</p> : null}
    {show ? <FmdQuickLinksOverview planningState={owner.planning} tools={data.fmdTools} source="supabase" currentProfile={profile} pending={commands.fmdToolPending} message={commands.fmdToolMessage} onCreateTool={commands.createFmdTool} onUpdateTool={commands.updateFmdTool} onLoadMetadata={commands.loadFmdToolMetadata} onUploadPreviewImage={commands.uploadFmdToolPreviewImage} /> : <p>Anderer Planning-Bereich</p>}
  </main>;
}
const meta = { component: CoordinatedTools, title: "Planning/Tools/CoordinatedState" } satisfies Meta<typeof CoordinatedTools>;
export default meta;
type Story = StoryObj<typeof meta>;
async function create(canvas: ReturnType<typeof within>) {
  await userEvent.click(canvas.getByRole("button", { name: "Link eintragen" })); const dialog = within(canvas.getByRole("dialog", { name: "Link eintragen" }));
  await waitFor(() => expect(dialog.getByRole("button", { name: "Dialog schließen" })).toHaveFocus());
  await userEvent.type(dialog.getByRole("textbox", { name: "Name" }), "Mein Werkzeug"); await userEvent.type(dialog.getByRole("textbox", { name: "Beschreibung" }), "Meine Werkzeugbeschreibung"); await userEvent.type(dialog.getByRole("textbox", { name: "Link" }), "https://new.example.test/"); return dialog;
}
export const ConfirmedCreateUpdatesRealHeaderQuicklinks: Story = { args: { scenario: "saved" }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement), dialog = await create(canvas); await userEvent.click(dialog.getByRole("switch", { name: /In kuratierte Links aufnehmen/ })); await userEvent.click(dialog.getByRole("button", { name: "Eintragen" }));
  await expect(await canvas.findByRole("heading", { name: "Mein Werkzeug" })).toBeVisible(); await userEvent.click(canvas.getByRole("button", { name: "Kuratierte Links" })); const header = within(canvas.getByRole("dialog", { name: "Kuratierte Links" })); await expect(header.getByRole("link", { name: /Mein Werkzeug/ })).toBeVisible();
} };
export const ConfirmedUploadSurvivesRejectedToolAndKeepsLocalDraft: Story = { args: { scenario: "rejected" }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement), dialog = await create(canvas); const input = canvasElement.querySelector('input[type="file"]') as HTMLInputElement;
  await userEvent.upload(input, new File([new Uint8Array([1])], "preview.png", { type: "image/png" })); await expect(await dialog.findByText("Vorschaubild übernommen.")).toBeVisible();
  await userEvent.click(dialog.getByRole("button", { name: "Eintragen" })); await expect(dialog.getByRole("textbox", { name: "Name" })).toHaveValue("Mein Werkzeug"); await userEvent.click(dialog.getByRole("button", { name: "Abbrechen" }));
  await expect(canvas.getByText(/Vorschaubild hochgeladen: preview.png/)).toBeVisible(); await expect(canvas.getByText("Tools: 1")).toBeVisible(); await expect(canvas.getByText("Uploads: 1")).toBeVisible();
} };
export const MetadataEnrichesOnlyTheUnsubmittedDraft: Story = { args: { scenario: "metadata" }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement); await userEvent.click(canvas.getByRole("button", { name: "Link eintragen" })); const dialog = within(canvas.getByRole("dialog", { name: "Link eintragen" })); await waitFor(() => expect(dialog.getByRole("button", { name: "Dialog schließen" })).toHaveFocus()); await userEvent.type(dialog.getByRole("textbox", { name: "Link" }), "https://metadata.example.test/"); await userEvent.tab();
  await waitFor(() => expect(dialog.getByRole("textbox", { name: "Name" })).toHaveValue("Metadaten-Titel")); await expect(dialog.getByRole("textbox", { name: "Beschreibung" })).toHaveValue("Beschreibung aus Metadaten"); await userEvent.click(dialog.getByRole("button", { name: "Abbrechen" })); await expect(canvas.getByText("Writes: 0")).toBeVisible(); await expect(canvas.getByText("Tools: 1")).toBeVisible();
} };
export const MetadataFailureDoesNotInventASavedTool: Story = { args: { scenario: "metadata-failure" }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement), dialog = await create(canvas); await userEvent.tab(); await expect(await dialog.findByText("Metadaten konnten nicht übernommen werden.")).toBeVisible(); await expect(dialog.getByRole("textbox", { name: "Name" })).toHaveValue("Mein Werkzeug"); await userEvent.click(dialog.getByRole("button", { name: "Abbrechen" })); await expect(canvas.getByText("Writes: 0")).toBeVisible();
} };
export const UnknownToolChecksWithoutReplay: Story = { args: { scenario: "unknown" }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement), dialog = await create(canvas); await userEvent.click(dialog.getByRole("button", { name: "Eintragen" })); await expect(await dialog.findByText(/Bestätigung steht aus/)).toBeVisible(); await expect(dialog.getByRole("button", { name: "Eintragen" })).toBeDisabled(); await userEvent.click(dialog.getByRole("button", { name: "Serverstand prüfen" })); await userEvent.click(dialog.getByRole("button", { name: "Abbrechen" })); await expect(canvas.getByText("Writes: 1")).toBeVisible(); await expect(canvas.getByText(/Bestätigung steht aus: Mein Werkzeug/)).toBeVisible();
} };
export const OriginalBasisNeedsExplicitConflictAdoption: Story = { args: { scenario: "conflict" }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement); await userEvent.click(canvas.getByRole("button", { name: "Founder-Werkzeug bearbeiten" })); const dialog = within(canvas.getByRole("dialog", { name: "Link bearbeiten" })); await waitFor(() => expect(dialog.getByRole("button", { name: "Dialog schließen" })).toHaveFocus()); const name = dialog.getByRole("textbox", { name: "Name" }); await userEvent.clear(name); await userEvent.type(name, "Mein Entwurf"); await userEvent.click(dialog.getByRole("button", { name: "Speichern" })); await expect(await dialog.findByText(/Der Link wurde zwischenzeitlich geändert/)).toBeVisible(); await userEvent.click(dialog.getByRole("button", { name: "Aktuellen Serverstand laden" })); await userEvent.click(await dialog.findByRole("button", { name: "Als Grundlage übernehmen" })); await expect(name).toHaveValue("Mein Entwurf"); await userEvent.click(dialog.getByRole("button", { name: "Speichern" })); await expect(await canvas.findByRole("heading", { name: "Mein Entwurf" })).toBeVisible();
} };
export const UnknownUploadHasNoReferenceAndNeverRepeats: Story = { args: { scenario: "lost-upload" }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement), dialog = await create(canvas), input = canvasElement.querySelector('input[type="file"]') as HTMLInputElement;
  await userEvent.upload(input, new File(["x"], "lost.png", { type: "image/png" })); await expect(await dialog.findByText(/Bild-Upload unbestätigt/)).toBeVisible(); await expect(dialog.getByRole("button", { name: "Bild hochladen" })).toBeDisabled(); await userEvent.upload(input, new File(["x"], "lost.png", { type: "image/png" })); await userEvent.click(dialog.getByRole("button", { name: "Abbrechen" })); await userEvent.click(canvas.getByRole("button", { name: "Upload-Ergebnis prüfen" })); await expect(canvas.getByText(/Kein bestätigter Dateipfad verfügbar/)).toBeVisible(); await expect(canvas.getByText("Uploads: 1")).toBeVisible();
} };
export const ConfirmedUploadPreservesTypingMadeDuringTheUpload: Story = { args: { scenario: "held-upload" }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement), dialog = await create(canvas), input = canvasElement.querySelector('input[type="file"]') as HTMLInputElement;
  await userEvent.upload(input, new File(["x"], "held.png", { type: "image/png" })); const name = dialog.getByRole("textbox", { name: "Name" }); await userEvent.clear(name); await userEvent.type(name, "Während Upload ergänzt"); transports.get("held-upload")!.completeUpload(); await expect(await dialog.findByText("Vorschaubild übernommen.")).toBeVisible(); await expect(name).toHaveValue("Während Upload ergänzt");
} };
export const LateMetadataCannotChangeAReplacementDialog: Story = { args: { scenario: "held-metadata" }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement), dialog = await create(canvas); await userEvent.tab(); await waitFor(() => expect(transports.get("held-metadata")!.metadataReads).toBe(1)); await userEvent.click(dialog.getByRole("button", { name: "Abbrechen" })); await userEvent.click(canvas.getByRole("button", { name: "Link eintragen" })); const replacement = within(canvas.getByRole("dialog", { name: "Link eintragen" })); await waitFor(() => expect(replacement.getByRole("button", { name: "Dialog schließen" })).toHaveFocus()); await userEvent.type(replacement.getByRole("textbox", { name: "Name" }), "Neuer Entwurf"); transports.get("held-metadata")!.completeMetadata(); await expect(replacement.getByRole("textbox", { name: "Name" })).toHaveValue("Neuer Entwurf");
} };
