import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { getRouter } from "@storybook/nextjs-vite/navigation.mock";
import { expect, userEvent, within } from "storybook/test";
import { TaskDetailPage } from "@/features/tasks/templates/task-detail-page";
import { itemPageHeaderData, itemPageModel, itemPageProfile, itemPageUser, mockItemPageBrowser } from "../../../../tests/helpers/task-detail-page-browser-fixture";

const meta = {
  title: "Application shell/Help navigation",
  component: TaskDetailPage,
  parameters: { layout: "fullscreen", nextjs: { appDirectory: true, navigation: { pathname: "/tasks/item-page-task" } } },
  globals: { viewport: { value: "phone" } },
  args: {
    taskId: "item-page-task", initialModel: itemPageModel(), headerData: itemPageHeaderData,
    source: "supabase", authRequired: true, initialAuthUser: itemPageUser,
    initialCurrentProfile: itemPageProfile,
  },
  beforeEach: () => mockItemPageBrowser(),
} satisfies Meta<typeof TaskDetailPage>;
export default meta;
type Story = StoryObj<typeof meta>;

export const PhoneHelpProtectsTheItemDraft: Story = {
  parameters: { viewport: { options: { phone: { name: "Phone", styles: { width: "390px", height: "844px" } } } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const page = within(document.body);
    await userEvent.click(await canvas.findByRole("button", { name: "Bearbeiten" }));
    const title = canvas.getByRole("textbox", { name: "Titel" });
    await userEvent.clear(title);
    await userEvent.type(title, "Private Item draft");
    await userEvent.click(canvas.getByRole("button", { name: "Mehr" }));
    await userEvent.click(canvas.getByRole("menuitem", { name: "Hilfe öffnen" }));
    await userEvent.click(page.getByRole("button", { name: /Geführte Hilfe/ }));
    await userEvent.click(within(await canvas.findByRole("alertdialog")).getByRole("button", { name: "Weiter bearbeiten" }));
    await expect(title).toHaveValue("Private Item draft");
    await expect(getRouter().push).not.toHaveBeenCalled();
    await userEvent.click(canvas.getByRole("button", { name: "Mehr" }));
    await userEvent.click(canvas.getByRole("menuitem", { name: "Hilfe öffnen" }));
    await userEvent.click(page.getByRole("button", { name: /Geführte Hilfe/ }));
    await userEvent.click(within(await canvas.findByRole("alertdialog")).getByRole("button", { name: "Änderungen verwerfen" }));
    await expect(getRouter().push).toHaveBeenCalledTimes(1);
    await expect(getRouter().push).toHaveBeenCalledWith("/planning?help=tour");
  },
};

export const PhoneUpdatesProtectTheItemDraft: Story = {
  parameters: { viewport: { options: { phone: { name: "Phone", styles: { width: "390px", height: "844px" } } } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const page = within(document.body);
    await userEvent.click(await canvas.findByRole("button", { name: "Bearbeiten" }));
    const title = canvas.getByRole("textbox", { name: "Titel" });
    await userEvent.type(title, " with private edits");
    await userEvent.click(canvas.getByRole("button", { name: "Mehr" }));
    await userEvent.click(canvas.getByRole("menuitem", { name: "Hilfe öffnen" }));
    await userEvent.click(page.getByRole("button", { name: /Was ist neu/ }));
    await userEvent.click(within(await canvas.findByRole("alertdialog")).getByRole("button", { name: "Weiter bearbeiten" }));
    await expect(title).toHaveValue("Reliable planning with private edits");
    await expect(getRouter().push).not.toHaveBeenCalled();
    await userEvent.click(canvas.getByRole("button", { name: "Mehr" }));
    await userEvent.click(canvas.getByRole("menuitem", { name: "Hilfe öffnen" }));
    await userEvent.click(page.getByRole("button", { name: /Was ist neu/ }));
    await userEvent.click(within(await canvas.findByRole("alertdialog")).getByRole("button", { name: "Änderungen verwerfen" }));
    await expect(getRouter().push).toHaveBeenCalledTimes(1);
    await expect(getRouter().push).toHaveBeenCalledWith("/planning?help=updates");
  },
};
