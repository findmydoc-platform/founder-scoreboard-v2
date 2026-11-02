import { useState, useSyncExternalStore } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";
import { PlanningContextControls } from "@/features/planning/molecules/planning-context-controls";
import { DEFAULT_PLANNING_FILTERS } from "@/features/planning/hooks/use-planning-view-state";
import { usePlanningHeaderActions } from "@/features/planning/hooks/use-planning-header-actions";
import type { PlanningLevel } from "@/features/planning/model/planning-level";
import type { PlanningHeaderData, ViewMode } from "@/lib/types";
import { createPlanningState } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { emptyPlanningHeaderData, readyHeaderSlot } from "@/lib/planning-header-data";
import { ApplicationHeader } from "./application-header";
import { mockAccountLifecycle } from "../../../../tests/helpers/account-lifecycle-browser-fixture";

function PlanningComposition({ state = "ready" }: { state?: "ready" | "loading" | "empty" | "failed" | "denied" }) {
  const [owner] = useState(() => createPlanningState({
    userId: "header-user",
    initialData: emptyPlanningShellState,
    initialWorkspace: "planning",
    initialHeaderData: {
      ...emptyPlanningHeaderData,
      quickLinks: state === "ready" ? readyHeaderSlot([{ id: "guide", name: "Team guide", category: "knowledge", url: "https://example.com/guide", previewImageUrl: "" }])
        : state === "empty" ? readyHeaderSlot([])
        : state === "loading" ? emptyPlanningHeaderData.quickLinks
        : { state: "error", data: [], error: state === "denied" ? "Kein Zugriff auf kuratierte Links." : "Kuratierte Links konnten nicht geladen werden." },
      calendarEvents: readyHeaderSlot([]),
      notifications: readyHeaderSlot({ unreadCount: 0, items: [] }),
    },
    adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => null, readHeader: () => new Promise<PlanningHeaderData>(() => {}) },
  }));
  useSyncExternalStore(owner.planning.subscribe, owner.internal.getSnapshot, owner.internal.getSnapshot);
  const [focus, setFocus] = useState(false);
  const [destination, setDestination] = useState("");
  const [githubOpen, setGithubOpen] = useState(false);
  const [filters, setFilters] = useState(DEFAULT_PLANNING_FILTERS);
  const [view, setView] = useState<ViewMode>("board");
  const [planningLevel, setPlanningLevel] = useState<PlanningLevel>("deliverable");
  const [showFilters, setShowFilters] = useState(false);
  const headerActions = usePlanningHeaderActions({ currentProfile: null, data: emptyPlanningShellState, planningLevel, view, workspace: "planning", setInitiativeDialogDefaults: () => {}, setEpicDialogDefaults: () => {}, setTaskDialogDefaults: draft => setDestination(`Create ${draft?.taskType}`) });
  return <main className="min-h-screen w-full bg-slate-50">
    <ApplicationHeader
      area={{ title: "Planung", description: "Planung und Prioritäten", supportingContext: "findmydoc · November 2026" }}
      lifecycle={{
        planningState: owner.planning,
        enabled: true,
        profiles: [],
        account: { user: { id: "header-user", displayName: "Mara", email: "mara@example.com" }, busy: false, onSignIn: () => {}, onSignOut: () => setDestination("Signed out") },
        github: { count: 0, failedCount: 0, installationAvailable: true, connectionState: "connected", open: githubOpen, onOpen: () => setGithubOpen(true) },
      }}
      navigation={{ mobileNavOpen: false, openMobileNav: () => setDestination("Navigation"), navigate: setDestination }}
      focus={{ active: focus, toggle: () => setFocus(value => !value) }}
      context={<PlanningContextControls data={emptyPlanningShellState} filters={filters} filtersAvailable headerActions={headerActions} workspace="planning" planningParentFilterId="all" setFilters={setFilters} view={view} setView={setView} planningLevel={planningLevel} setPlanningLevel={setPlanningLevel} setShowFilters={setShowFilters} showFilters={showFilters} />}
    />
    <output className="sr-only" aria-label="Destination">{destination}</output>
    <output className="sr-only" aria-label="Planning view">{view}</output>
    {githubOpen ? <section role="dialog" aria-label="GitHub">GitHub connection</section> : null}
  </main>;
}

const meta = {
  title: "Application shell/Composition",
  component: PlanningComposition,
  parameters: { layout: "fullscreen", viewport: { defaultViewport: "desktop" } },
  beforeEach: () => mockAccountLifecycle("google", { linked: true, workspaceEmail: "mara@example.com" }),
} satisfies Meta<typeof PlanningComposition>;
export default meta;
type Story = StoryObj<typeof meta>;

export const PlanningGlobalActions: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { name: "Planung", level: 1 })).toBeVisible();
    await expect(canvas.getByText("findmydoc · November 2026")).toBeVisible();
    const names = ["Kuratierte Links", "Kalender öffnen", "Benachrichtigungen", "Hilfe öffnen", /GitHub öffnen/, "Account-Menü öffnen"];
    const buttons = names.map(name => canvas.getByRole("button", { name }));
    for (let index = 0; index < buttons.length; index++) {
      await expect(buttons[index]).toBeVisible();
      if (index) await expect(buttons[index - 1].compareDocumentPosition(buttons[index]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    }
    await userEvent.click(canvas.getByRole("button", { name: "Kuratierte Links" }));
    await expect(canvas.getByRole("link", { name: /Team guide/ })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await userEvent.click(canvas.getByRole("button", { name: "Hilfe öffnen" }));
    await expect(canvas.getByRole("button", { name: /Geführte Hilfe/ })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await userEvent.click(canvas.getByRole("button", { name: "Account-Menü öffnen" }));
    await expect(canvas.getByText("Mara")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: /Profil/ }));
    await expect(canvas.getByLabelText("Destination")).toHaveTextContent("/profile");
  },
};

export const FocusAndRestore: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Fokusmodus" }));
    await expect(canvas.getByRole("heading", { name: "Planung" })).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Account-Menü öffnen" })).toBeVisible();
    await expect(canvas.queryByRole("button", { name: "Kuratierte Links" })).not.toBeInTheDocument();
    await expect(canvas.queryByRole("button", { name: "Neues Deliverable" })).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Fokusmodus beenden" }));
    await expect(canvas.getByRole("button", { name: "Kuratierte Links" })).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Neues Deliverable" })).toBeVisible();
  },
};

export const PlanningContextKeepsSelection: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Meine" }));
    await expect(canvas.getByRole("button", { name: "Meine" })).toHaveAttribute("aria-pressed", "true");
    for (const [label, mode] of [["Struktur", "structure"], ["Tabelle", "table"], ["Gantt", "gantt"], ["Board", "board"]]) {
      await userEvent.click(canvas.getByRole("button", { name: label }));
      await expect(canvas.getByLabelText("Planning view")).toHaveTextContent(mode);
      await expect(canvas.getByRole("button", { name: "Meine" })).toHaveAttribute("aria-pressed", "true");
    }
    await userEvent.click(canvas.getByRole("button", { name: "Neues Deliverable" }));
    await expect(canvas.getByLabelText("Destination")).toHaveTextContent("Create deliverable");
    await userEvent.click(canvas.getByRole("button", { name: "Kuratierte Links" }));
    await userEvent.keyboard("{Escape}");
    await expect(canvas.getByRole("button", { name: "Meine" })).toHaveAttribute("aria-pressed", "true");
  },
};

export const CalendarAndGithubRemainReachable: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Kalender öffnen" }));
    const page = within(document.body);
    await expect(await page.findByRole("tab", { name: "Termine" })).toBeVisible();
    await userEvent.click(page.getByRole("tab", { name: "Arbeitswoche" }));
    await expect(page.getByRole("tab", { name: "Arbeitswoche" })).toHaveAttribute("aria-selected", "true");
    await userEvent.click(page.getByRole("button", { name: "Im Team öffnen" }));
    await expect(canvas.getByLabelText("Destination")).toHaveTextContent(/^\/team\?week=\d{4}-\d{2}-\d{2}$/);
    await expect(page.queryByRole("dialog", { name: "Kalender" })).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: /GitHub öffnen/ }));
    await expect(canvas.getByRole("dialog", { name: "GitHub" })).toBeVisible();
  },
};

async function expectLinksState(canvasElement: HTMLElement, text: string) {
  const canvas = within(canvasElement);
  await userEvent.click(canvas.getByRole("button", { name: "Kuratierte Links" }));
  await expect(canvas.getByText(text)).toBeVisible();
  await expect(canvas.getByRole("button", { name: "Kalender öffnen" })).toBeVisible();
  await expect(canvas.getByRole("button", { name: "Benachrichtigungen" })).toBeVisible();
}

export const LoadingLinks: Story = { args: { state: "loading" }, play: ({ canvasElement }) => expectLinksState(canvasElement, "Kuratierte Links werden geladen.") };
export const EmptyLinks: Story = { args: { state: "empty" }, play: ({ canvasElement }) => expectLinksState(canvasElement, "Keine kuratierten Links.") };
export const FailedLinks: Story = { args: { state: "failed" }, play: ({ canvasElement }) => expectLinksState(canvasElement, "Kuratierte Links konnten nicht geladen werden.") };
export const DeniedLinks: Story = { args: { state: "denied" }, play: ({ canvasElement }) => expectLinksState(canvasElement, "Kein Zugriff auf kuratierte Links.") };
