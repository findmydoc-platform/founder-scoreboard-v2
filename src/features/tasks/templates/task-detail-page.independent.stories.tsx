import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { TaskDetailPage } from "./task-detail-page";
import { itemPageHeaderData, itemPageModel, itemPageProfile, itemPageUser, mockItemPageBrowser } from "../../../../tests/helpers/task-detail-page-browser-fixture";

let reads = 0;
const areas: string[] = [];
const releases: Array<() => void> = [];
const model = () => ({ ...itemPageModel(), readArea: "target" as const, sourceRevision: "target-source", observedAt: new Date().toISOString(), validUntil: null, authorityDeadline: Date.now() + 60_000, coverage: {} });
const meta = {
  title: "Application shell/Independent Item detail",
  component: TaskDetailPage,
  parameters: { layout: "fullscreen", nextjs: { appDirectory: true } },
  args: { taskId: "item-page-task", initialModel: model(), headerData: itemPageHeaderData, source: "supabase", authRequired: true,
    initialAuthUser: itemPageUser, initialCurrentProfile: itemPageProfile, initialCommentTarget: "local:649",
    ...{ initialTaskDetailRead: { readAuthority: { userId: itemPageUser.id, deadline: Date.now() + 60_000 }, session: { userId: itemPageUser.id, user: itemPageUser, revision: "item-page-session", expiresAt: Math.floor(Date.now()/1000) + 3600 } } },
  },
  beforeEach: async () => {
    reads = 0; areas.splice(0);
    const restore = await mockItemPageBrowser({ respond: input => {
      if (!new URL(String(input), window.location.origin).pathname.endsWith("/detail-data")) return undefined;
      reads++; areas.push(new URL(String(input), window.location.origin).searchParams.get("area") || "complete");
      return new Promise<Response>(resolve => { releases.push(() => resolve(Response.json({ error: "Secondary unavailable" }, { status: 503 }))); });
    } });
    return () => { releases.splice(0).forEach(release => release()); restore(); };
  },
} satisfies Meta<typeof TaskDetailPage>;
export default meta;
type Story = StoryObj<typeof meta>;

export const UsableTargetDoesNotWaitForVisibleActivity: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(reads).toBeGreaterThan(0));
    await waitFor(() => expect([...areas].sort()).toEqual(["discussion", "timeline"]));
    await expect(canvas.getByRole("heading", { name: "Reliable planning", level: 1 })).toBeVisible();
    const edit = canvas.getByRole("button", { name: "Bearbeiten" });
    await expect(edit).toBeEnabled();
    await userEvent.click(edit);
    const title = await canvas.findByRole("textbox", { name: "Titel" });
    await userEvent.clear(title);
    await userEvent.type(title, "Independent target draft");
    releases.splice(0).forEach(release => release());
    await expect(title).toHaveValue("Independent target draft");
    await expect(title).toHaveFocus();
  },
};
