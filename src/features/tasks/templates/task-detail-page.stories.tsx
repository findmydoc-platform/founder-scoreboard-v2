import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { getRouter } from "@storybook/nextjs-vite/navigation.mock";
import { TaskDetailPage } from "./task-detail-page";
import { itemPageHeaderData, itemPageModel, itemPageProfile, itemPageUser, mockItemPageBrowser } from "../../../../tests/helpers/task-detail-page-browser-fixture";

const meta = {
  title: "Application shell/Item page",
  component: TaskDetailPage,
  parameters: { layout: "fullscreen", nextjs: { appDirectory: true } },
  args: {
    taskId: "item-page-task", initialModel: itemPageModel(), headerData: itemPageHeaderData,
    source: "supabase", authRequired: true, initialAuthUser: itemPageUser,
    initialCurrentProfile: itemPageProfile,
  },
  beforeEach: () => mockItemPageBrowser(),
} satisfies Meta<typeof TaskDetailPage>;
export default meta;
type Story = StoryObj<typeof meta>;

export const GlobalActionsAndItemHeading: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(within(canvas.getByLabelText("Anwendung")).getByText("Planung")).toBeVisible();
    await expect(canvas.getByRole("heading", { name: "Reliable planning", level: 1 })).toBeVisible();
    await expect(canvas.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    for (const name of ["Kuratierte Links", "Kalender öffnen", "Benachrichtigungen", "Hilfe öffnen", /GitHub öffnen/, "Account-Menü öffnen"]) {
      await expect(canvas.getByRole("button", { name })).toBeVisible();
    }
    await userEvent.click(canvas.getByRole("button", { name: "Kuratierte Links" }));
    await expect(canvas.getByRole("link", { name: /Team guide/ })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await userEvent.click(canvas.getByRole("button", { name: "Hilfe öffnen" }));
    await expect(canvas.getByRole("button", { name: /Geführte Hilfe/ })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await userEvent.click(canvas.getByRole("button", { name: /GitHub öffnen/ }));
    await expect(canvas.getByRole("dialog", { name: "GitHub-Sync" })).toBeVisible();
    await userEvent.keyboard("{Escape}");
  },
};

export const EpicKeepsStrategicContent: Story = {
  args: { initialModel: itemPageModel("epic") },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(within(canvas.getByLabelText("Anwendung")).getByText("Planung")).toBeVisible();
    await expect(canvas.getByRole("heading", { name: "Reliable planning", level: 1 })).toBeVisible();
    await expect(canvas.getByText("Strategic context")).toBeVisible();
    await expect(canvas.getByRole("button", { name: /GitHub öffnen/ })).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Weitere Item-Aktionen" })).toBeDisabled();
    await expect(canvas.queryByRole("button", { name: "GitHub Issue anlegen" })).not.toBeInTheDocument();
  },
};

export const InitiativeKeepsStrategicContent: Story = {
  args: { initialModel: itemPageModel("initiative") },
  play: EpicKeepsStrategicContent.play,
};

export const SubIssueKeepsItemProjection: Story = {
  args: { initialModel: itemPageModel("sub_issue") },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(within(canvas.getByLabelText("Anwendung")).getByText("Planung")).toBeVisible();
    await expect(canvas.getByRole("heading", { name: "Reliable planning", level: 1 })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Weitere Item-Aktionen" }));
    await expect(within(document.body).getByRole("menuitem", { name: /GitHub Issue anlegen/ })).toBeInTheDocument();
    await userEvent.keyboard("{Escape}");
  },
};

export const CalendarUsesWorkweekNavigationGuard: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Bearbeiten" }));
    const title = canvas.getByRole("textbox", { name: "Titel" });
    await userEvent.type(title, " draft");
    await userEvent.click(canvas.getByRole("button", { name: "Kalender öffnen" }));
    const page = within(document.body);
    await userEvent.click(await page.findByRole("tab", { name: "Arbeitswoche" }));
    await expect(page.getByRole("tab", { name: "Arbeitswoche" })).toHaveAttribute("aria-selected", "true");
    await userEvent.click(page.getByRole("button", { name: "Im Team öffnen" }));
    await userEvent.click(within(await canvas.findByRole("alertdialog")).getByRole("button", { name: "Weiter bearbeiten" }));
    await expect(title).toHaveValue("Reliable planning draft");
    await expect(getRouter().push).not.toHaveBeenCalled();
  },
};

export const ReleaseReturnKeepsQueryAndAnchor: Story = {
  args: { returnHref: "/team/platform-releases/v1.2.3?section=planning#change-7", returnLabel: "Zurück zum Release" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const back = canvas.getByRole("link", { name: "Zurück zum Release" });
    await expect(back).toHaveAttribute("href", "/team/platform-releases/v1.2.3?section=planning#change-7");
    await userEvent.click(back);
    await expect(getRouter().push).toHaveBeenCalledTimes(1);
    await expect(getRouter().push).toHaveBeenCalledWith("/team/platform-releases/v1.2.3?section=planning#change-7");
  },
};

export const UnsupportedReturnUsesPlanning: Story = {
  args: { returnHref: "https://example.com/outside", returnLabel: "Outside" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const back = canvas.getByRole("link", { name: "Zur Planung" });
    await expect(back).toHaveAttribute("href", "/planning");
    await userEvent.click(back);
    await expect(getRouter().push).toHaveBeenCalledTimes(1);
    await expect(getRouter().push).toHaveBeenCalledWith("/planning");
  },
};

export const LogoutClearsEditorAndHeader: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Bearbeiten" }));
    await userEvent.type(canvas.getByRole("textbox", { name: "Titel" }), " private draft");
    await userEvent.click(canvas.getByRole("button", { name: "Account-Menü öffnen" }));
    await userEvent.click(canvas.getByRole("button", { name: "Abmelden" }));
    await waitFor(() => expect(canvas.queryByRole("heading", { name: "Reliable planning" })).not.toBeInTheDocument());
    await expect(canvas.queryByRole("button", { name: "Account-Menü öffnen" })).not.toBeInTheDocument();
    await expect(canvas.queryByRole("textbox", { name: "Titel" })).not.toBeInTheDocument();
  },
};

export const DirtyEditorKeepsOrDiscardsProfileNavigation: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Bearbeiten" }));
    const title = canvas.getByRole("textbox", { name: "Titel" });
    await userEvent.clear(title);
    await userEvent.type(title, "Unsaved local title");
    await userEvent.click(canvas.getByRole("button", { name: "Account-Menü öffnen" }));
    await userEvent.click(canvas.getByRole("button", { name: /Profil/ }));
    const dialog = await canvas.findByRole("alertdialog");
    await userEvent.click(within(dialog).getByRole("button", { name: "Weiter bearbeiten" }));
    await expect(title).toHaveValue("Unsaved local title");
    await expect(getRouter().push).not.toHaveBeenCalled();
    await userEvent.click(canvas.getByRole("button", { name: "Account-Menü öffnen" }));
    await userEvent.click(canvas.getByRole("button", { name: /Profil/ }));
    await userEvent.click(within(await canvas.findByRole("alertdialog")).getByRole("button", { name: "Änderungen verwerfen" }));
    await expect(getRouter().push).toHaveBeenCalledTimes(1);
    await expect(getRouter().push).toHaveBeenCalledWith("/profile");
  },
};

export const MainNavigationProtectsEditor: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Bearbeiten" }));
    const title = canvas.getByRole("textbox", { name: "Titel" });
    await userEvent.type(title, " with a local draft");
    await expect(title).toHaveValue("Reliable planning with a local draft");
    if (window.innerWidth < 1024) await userEvent.click(canvas.getByRole("button", { name: "Navigation öffnen" }));
    const navigation = canvas.getByRole("navigation", { name: window.innerWidth < 1024 ? "Mobile Hauptnavigation" : "Hauptnavigation" });
    await userEvent.click(within(navigation).getByRole("link", { name: "Backlog" }));
    await userEvent.click(within(await canvas.findByRole("alertdialog")).getByRole("button", { name: "Weiter bearbeiten" }));
    await expect(title).toHaveValue("Reliable planning with a local draft");
    await expect(getRouter().push).not.toHaveBeenCalled();
    await userEvent.click(within(navigation).getByRole("link", { name: "Backlog" }));
    await userEvent.click(within(await canvas.findByRole("alertdialog")).getByRole("button", { name: "Änderungen verwerfen" }));
    await expect(getRouter().push).toHaveBeenCalledTimes(1);
    await expect(getRouter().push).toHaveBeenCalledWith("/backlog");
    await expect(canvas.queryByRole("dialog", { name: "Mobile Navigation" })).not.toBeInTheDocument();
  },
};

export const ReleaseSidebarProtectsEditor: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Bearbeiten" }));
    await userEvent.type(canvas.getByRole("textbox", { name: "Titel" }), " with private edits");
    if (window.innerWidth < 1024) await userEvent.click(canvas.getByRole("button", { name: "Navigation öffnen" }));
    await userEvent.click(await canvas.findByRole("link", { name: /Neu auf der Plattform/ }));
    await userEvent.click(within(await canvas.findByRole("alertdialog")).getByRole("button", { name: "Weiter bearbeiten" }));
    await expect(canvas.getByRole("textbox", { name: "Titel" })).toHaveValue("Reliable planning with private edits");
    await expect(getRouter().push).not.toHaveBeenCalled();
  },
};

const founderProfile = { ...itemPageProfile, platformRole: "founder" as const };

export const OrdinaryAccountHasNoAdministratorActions: Story = {
  args: { initialCurrentProfile: founderProfile, initialModel: { ...itemPageModel(), people: [founderProfile] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Account-Menü öffnen" }));
    await expect(canvas.queryByRole("button", { name: /Adminzugang aktivieren/ })).not.toBeInTheDocument();
    await expect(canvas.queryByRole("button", { name: "Administration" })).not.toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: /Profil/ })).toBeVisible();
  },
};

export const ActiveAdministratorKeepsAuthorizedAccess: Story = {
  args: {
    initialCurrentProfile: founderProfile, initialModel: { ...itemPageModel(), people: [founderProfile] },
    initialAdministratorAccess: { eligible: true, active: true, expiresAt: new Date(Date.now() + 600_000).toISOString() },
  },
  beforeEach: () => mockItemPageBrowser({ administrator: true }),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Account-Menü öffnen" }));
    await expect(canvas.getByRole("button", { name: /Adminzugang beenden/ })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Öffnen" }));
    await expect(getRouter().push).toHaveBeenCalledTimes(1);
    await expect(getRouter().push).toHaveBeenCalledWith("/administration");
  },
};
