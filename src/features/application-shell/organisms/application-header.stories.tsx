import { useState, useSyncExternalStore } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { PlanningContextControls } from "@/features/planning/molecules/planning-context-controls";
import { DEFAULT_PLANNING_FILTERS } from "@/features/planning/hooks/use-planning-view-state";
import { usePlanningHeaderActions } from "@/features/planning/hooks/use-planning-header-actions";
import type { PlanningLevel } from "@/features/planning/model/planning-level";
import type { PlanningHeaderData, ViewMode } from "@/lib/types";
import { createPlanningState } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { emptyPlanningHeaderData, readyHeaderSlot } from "@/lib/planning-header-data";
import "driver.js/dist/driver.css";
import { FeatureTourProvider } from "@/features/product-tours/organisms/feature-tour-provider";
import { teamWorkweekTourId } from "@/features/product-tours/model/feature-tour-registry";
import { TaskGitHubSyncQueue } from "@/features/tasks/organisms/task-github-sync-queue";
import { ApplicationHeader } from "./application-header";
import { mockAccountLifecycle } from "../../../../tests/helpers/account-lifecycle-browser-fixture";

function PlanningComposition({ state = "ready", tours = false, areaTitle = "Planung" }: { state?: "ready" | "loading" | "empty" | "failed" | "denied"; tours?: boolean; areaTitle?: string }) {
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
      area={{ title: areaTitle, description: "Planung und Prioritäten", supportingContext: "findmydoc · November 2026" }}
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
    <TaskGitHubSyncQueue open={githubOpen} tasks={[]} comments={[]} pending={false} githubInstallationAvailable githubUserConnected githubConnectionState="connected" waitingGitHubCommentCount={0} githubReauthFailed={false} authBusy={false} onClose={() => setGithubOpen(false)} onOpenTask={() => {}} onReconnect={() => {}} onSyncLinkedGitHubTasks={() => {}} onSyncTaskToGitHub={() => {}} />
    {tours ? <FeatureTourProvider planningState={owner.planning} currentProfile={null} data={emptyPlanningShellState} openTaskPanel={() => {}} selectedTaskId={null} setView={setView} setWorkspace={() => {}} source="supabase" workspace="planning" /> : null}
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
    await expect(within(document.body).getByRole("link", { name: /Team guide/ })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await userEvent.click(canvas.getByRole("button", { name: "Hilfe öffnen" }));
    await expect(within(document.body).getByRole("button", { name: /Geführte Hilfe/ })).toBeVisible();
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
    await expect(canvas.getByRole("dialog", { name: "GitHub-Sync" })).toBeVisible();
  },
};

async function expectLinksState(canvasElement: HTMLElement, text: string) {
  const canvas = within(canvasElement);
  await userEvent.click(canvas.getByRole("button", { name: "Kuratierte Links" }));
  await expect(within(document.body).getByText(text)).toBeVisible();
  await expect(canvas.getByRole("button", { name: "Kalender öffnen" })).toBeVisible();
  await expect(canvas.getByRole("button", { name: "Benachrichtigungen" })).toBeVisible();
}

export const LoadingLinks: Story = { args: { state: "loading" }, play: ({ canvasElement }) => expectLinksState(canvasElement, "Kuratierte Links werden geladen.") };
export const EmptyLinks: Story = { args: { state: "empty" }, play: ({ canvasElement }) => expectLinksState(canvasElement, "Keine kuratierten Links.") };
export const FailedLinks: Story = { args: { state: "failed" }, play: ({ canvasElement }) => expectLinksState(canvasElement, "Kuratierte Links konnten nicht geladen werden.") };
export const DeniedLinks: Story = { args: { state: "denied" }, play: ({ canvasElement }) => expectLinksState(canvasElement, "Kein Zugriff auf kuratierte Links.") };


export const PhoneGlobalActions: Story = {
  globals: { viewport: { value: "phone" } },
  parameters: { viewport: { options: { phone: { name: "Phone", styles: { width: "320px", height: "568px" } } } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const more = canvas.getByRole("button", { name: "Mehr" });
    for (const name of ["Navigation öffnen", "Benachrichtigungen", "Account-Menü öffnen", "Mehr"]) {
      const control = canvas.getByRole("button", { name });
      await expect(control).toBeVisible();
      await expect(control.getBoundingClientRect().height).toBeGreaterThanOrEqual(44);
      await expect(control.getBoundingClientRect().width).toBeGreaterThanOrEqual(44);
    }
    await expect(canvas.getByRole("heading", { name: "Planung" })).toBeVisible();
    await expect(canvas.queryByRole("button", { name: "Kalender öffnen" })).not.toBeInTheDocument();
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
    await userEvent.click(more);
    const menu = canvas.getByRole("menu", { name: "Weitere globale Aktionen" });
    await expect(more).toHaveAttribute("aria-expanded", "true");
    await expect(within(menu).getAllByRole("menuitem").map(item => item.textContent?.trim())).toEqual(["Kuratierte Links", "Kalender", "Hilfe", "GitHub"]);
    await waitFor(() => expect(within(menu).getByRole("menuitem", { name: "Kuratierte Links" })).toHaveFocus());
    await userEvent.keyboard("{ArrowDown}{Enter}");
    const page = within(document.body);
    const calendar = await page.findByRole("dialog", { name: "Kalender" });
    await expect(menu).not.toBeVisible();
    await waitFor(() => expect(calendar.contains(document.activeElement)).toBe(true));
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(more).toHaveFocus());
    await expect(more).toHaveAttribute("aria-expanded", "false");
  },
};


export const HelpContinuesInPlanning: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Hilfe öffnen" }));
    await userEvent.click(within(document.body).getByRole("button", { name: /Geführte Hilfe/ }));
    await expect(canvas.getByLabelText("Destination")).toHaveTextContent("/planning?help=tour");
  },
};


export const PhoneTourRevealsCalendar: Story = {
  args: { tours: true },
  globals: { viewport: { value: "phone" } },
  parameters: { viewport: { options: { phone: { name: "Phone", styles: { width: "390px", height: "844px" } } } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    window.dispatchEvent(new CustomEvent("fmd:start-feature-tour", { cancelable: true, detail: { tourId: teamWorkweekTourId } }));
    const page = within(document.body);
    await waitFor(() => expect(page.getByText("Gemeinsamen Kalender öffnen")).toBeVisible(), { timeout: 10000 });
    await expect(canvas.getByRole("menuitem", { name: "Kalender öffnen" })).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Weiter" }));
    await waitFor(() => expect(page.getByText("Arbeitswoche vergleichen")).toBeVisible());
    await userEvent.click(page.getByRole("button", { name: "Verstanden" }));
    await waitFor(() => expect(canvas.getByRole("button", { name: "Mehr" })).toHaveAttribute("aria-expanded", "false"));
    await expect(canvas.getByLabelText("Destination")).toHaveTextContent("");
  },
};


export const ResponsiveOverview: Story = {};
export const LongAreaLabel: Story = { args: { areaTitle: "Planung und unternehmensweite Prioritäten" } };

export const PhoneMenusAndFocusRestore: Story = {
  globals: { viewport: { value: "phone" } },
  parameters: { viewport: { options: { phone: { name: "Phone", styles: { width: "390px", height: "844px" } } } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const page = within(document.body);
    const more = canvas.getByRole("button", { name: "Mehr" });
    await userEvent.click(more);
    await userEvent.click(canvas.getByRole("menuitem", { name: "Kuratierte Links" }));
    const links = page.getByRole("dialog", { name: "Kuratierte Links" });
    await expect(links).toBeVisible();
    await waitFor(() => expect(links.contains(document.activeElement)).toBe(true));
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(more).toHaveFocus());
    await userEvent.click(more);
    await userEvent.click(canvas.getByRole("menuitem", { name: "Hilfe öffnen" }));
    const help = page.getByRole("dialog", { name: "Hilfe" });
    await expect(help).toBeVisible();
    await expect(more).toHaveAttribute("aria-expanded", "false");
    await waitFor(() => expect(help.contains(document.activeElement)).toBe(true));
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(more).toHaveFocus());
    await userEvent.click(more);
    await userEvent.click(canvas.getByRole("menuitem", { name: /GitHub öffnen/ }));
    const github = page.getByRole("dialog", { name: "GitHub-Sync" });
    await expect(github).toBeVisible();
    await waitFor(() => expect(github.contains(document.activeElement)).toBe(true));
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(more).toHaveFocus());
    const notifications = canvas.getByRole("button", { name: "Benachrichtigungen" });
    await userEvent.click(notifications);
    const inbox = canvas.getByRole("dialog", { name: "Benachrichtigungen" });
    await waitFor(() => expect(inbox.contains(document.activeElement)).toBe(true));
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(notifications).toHaveFocus());
    await userEvent.click(more);
    await userEvent.click(canvas.getByRole("button", { name: "Account-Menü öffnen" }));
    await expect(more).toHaveAttribute("aria-expanded", "false");
    await expect(canvas.getByRole("dialog", { name: "Account und Testprofil" })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(canvas.getByRole("button", { name: "Account-Menü öffnen" })).toHaveFocus());
    await userEvent.click(more);
    await waitFor(() => expect(canvas.getByRole("menuitem", { name: "Kuratierte Links" })).toHaveFocus());
    await userEvent.keyboard("{End}");
    await expect(canvas.getByRole("menuitem", { name: /GitHub öffnen/ })).toHaveFocus();
    await userEvent.keyboard("{Home}{Escape}");
    await expect(more).toHaveFocus();
    await userEvent.click(more);
    await userEvent.click(canvas.getByRole("heading", { name: "Planung" }));
    await expect(more).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(canvas.getByRole("button", { name: "Fokusmodus" }));
    await expect(canvas.queryByRole("button", { name: "Mehr" })).not.toBeInTheDocument();
    await expect(canvas.queryByRole("button", { name: "Benachrichtigungen" })).not.toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Account-Menü öffnen" })).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Fokusmodus beenden" })).toBeVisible();
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
    await userEvent.click(canvas.getByRole("button", { name: "Fokusmodus beenden" }));
    await expect(canvas.getByRole("button", { name: "Benachrichtigungen" })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Mehr" }));
    await expect(canvas.getAllByRole("menuitem")).toHaveLength(4);
    await userEvent.keyboard("{Escape}");
  },
};


export const PhoneTourRevealsGithubAfterAccount: Story = {
  args: { tours: true },
  globals: { viewport: { value: "phone" } },
  parameters: { viewport: { options: { phone: { name: "Phone", styles: { width: "320px", height: "568px" } } } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const page = within(document.body);
    window.dispatchEvent(new CustomEvent("fmd:start-feature-tour", { cancelable: true, detail: { tourId: "google-workspace-login-v1" } }));
    await waitFor(() => expect(page.getByText("Dein FounderOps-Konto")).toBeVisible());
    await expect(canvas.getByRole("button", { name: "Mehr" })).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(page.getByRole("button", { name: "Weiter" }));
    await waitFor(() => expect(page.getByText("GitHub separat verbinden")).toBeVisible());
    await expect(canvas.getByRole("menuitem", { name: /GitHub öffnen/ })).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Verstanden" }));
    await waitFor(() => expect(canvas.getByRole("button", { name: "Mehr" })).toHaveFocus());
    await expect(canvas.getByRole("button", { name: "Mehr" })).toHaveAttribute("aria-expanded", "false");
    await expect(canvas.getByLabelText("Destination")).toHaveTextContent("");
  },
};

export const PhoneTourBackRevealsHelpAgain: Story = {
  args: { tours: true },
  globals: { viewport: { value: "phone" } },
  parameters: { viewport: { options: { phone: { name: "Phone", styles: { width: "390px", height: "844px" } } } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const page = within(document.body);
    window.dispatchEvent(new CustomEvent("fmd:start-feature-tour", { cancelable: true, detail: { tourId: "product-updates-v1" } }));
    await waitFor(() => expect(page.getByText("Neuigkeiten wiederfinden")).toBeVisible());
    await expect(canvas.getByRole("menuitem", { name: "Hilfe öffnen" })).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Weiter" }));
    await expect(await page.findByRole("button", { name: /Was ist neu/ })).toBeVisible();
    await waitFor(() => expect(page.getByRole("button", { name: "Verstanden" })).toBeVisible());
    await Promise.all(document.getAnimations().map(animation => animation.finished));
    await userEvent.keyboard("{ArrowLeft}");
    await waitFor(() => expect(page.getByText("Neuigkeiten wiederfinden")).toBeVisible());
    await expect(canvas.getByRole("menuitem", { name: "Hilfe öffnen" })).toBeVisible();
    await expect(page.queryByRole("dialog", { name: "Hilfe" })).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("menuitem", { name: "Hilfe öffnen" }));
    await expect(page.getByRole("dialog", { name: "Hilfe" })).toBeVisible();
    await userEvent.click(page.getByRole("button", { name: "Weiter" }));
    await expect(await page.findByRole("button", { name: /Was ist neu/ })).toBeVisible();
    await waitFor(() => expect(page.getByRole("button", { name: "Verstanden" })).toBeVisible());
    await userEvent.click(page.getByRole("button", { name: "Verstanden" }));
    await waitFor(() => expect(canvas.getByRole("button", { name: "Mehr" })).toHaveFocus());
    await expect(canvas.getByRole("button", { name: "Mehr" })).toHaveAttribute("aria-expanded", "false");
    await userEvent.click(canvas.getByRole("button", { name: "Mehr" }));
    await userEvent.click(canvas.getByRole("menuitem", { name: "Hilfe öffnen" }));
    await expect(page.getByRole("dialog", { name: "Hilfe" })).toBeVisible();
  },
};
