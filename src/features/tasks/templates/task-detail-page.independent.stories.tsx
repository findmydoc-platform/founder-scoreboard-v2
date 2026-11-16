import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { TaskDetailPage } from "./task-detail-page";
import { itemPageHeaderData, itemPageModel, itemPageProfile, itemPageUser, mockItemPageBrowser } from "../../../../tests/helpers/task-detail-page-browser-fixture";

let reads = 0;
const areas: string[] = [];
const releases: Array<() => void> = [];
const attempts = new Map<string, number>();
let revealChildren: (() => void) | undefined;
const model = () => ({ ...itemPageModel(), readArea: "target" as const, sourceRevision: "target-source", observedAt: new Date().toISOString(), validUntil: null, authorityDeadline: Date.now() + 60_000, readActor: { profileId: itemPageProfile.id, platformRole: itemPageProfile.platformRole }, coverage: {} });
const meta = {
  title: "Application shell/Independent Item detail",
  component: TaskDetailPage,
  parameters: { layout: "fullscreen", nextjs: { appDirectory: true } },
  args: { taskId: "item-page-task", initialModel: model(), headerData: itemPageHeaderData, source: "supabase", authRequired: true,
    initialAuthUser: itemPageUser, initialCurrentProfile: itemPageProfile, initialCommentTarget: "local:649",
    ...{ initialTaskDetailRead: { itemId: "item-page-task", readAuthority: { userId: itemPageUser.id, deadline: Date.now() + 60_000 }, session: { userId: itemPageUser.id, user: itemPageUser, revision: "item-page-session", expiresAt: Math.floor(Date.now()/1000) + 3600 } } },
  },
  beforeEach: async ({ parameters }) => {
    reads = 0; areas.splice(0); attempts.clear(); revealChildren = undefined;
    const restore = await mockItemPageBrowser({ respond: input => {
      if (!new URL(String(input), window.location.origin).pathname.endsWith("/detail-data")) return undefined;
      reads++; areas.push(new URL(String(input), window.location.origin).searchParams.get("area") || "complete");
      const area = areas.at(-1)!;
      attempts.set(area, (attempts.get(area) || 0) + 1);
      if (parameters.detailScenario === "children" && area === "children") {
        return new Promise<Response>(resolve => { revealChildren = () => {
          const ready = model();
          const child = { ...itemPageModel("sub_issue").item, id: "visible-child", title: "Visible independent child", parentTaskId: ready.item.id };
          resolve(Response.json({ taskDetail: { ...ready, readArea: "children", sourceRevision: "children-source", coverage: { children: "complete" }, children: [child], childProgress: { completed: 0, total: 1, unfinished: 1, percentage: 0 } }, readAuthority: { userId: itemPageUser.id, deadline: ready.authorityDeadline }, unavailable: [] }));
        }; });
      }
      if (parameters.detailScenario === "retry" && area === "discussion" && attempts.get(area)! > 1) {
        const ready = model();
        return Response.json({ taskDetail: { ...ready, readArea: "discussion", sourceRevision: "discussion-source", coverage: { discussion: "complete" },
          discussion: { comments: [{ id: 649, taskId: ready.item.id, profileId: itemPageProfile.id, comment: "Independent discussion receipt", createdAt: ready.observedAt, githubDeliveryStatus: "not_applicable", githubCommentUrl: "" }], externalComments: [] } },
          readAuthority: { userId: itemPageUser.id, deadline: ready.authorityDeadline }, unavailable: [] });
      }
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

export const FailedAreaRetriesWithoutReplacingTheTarget: Story = {
  parameters: { detailScenario: "retry" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect([...areas].sort()).toEqual(["discussion", "timeline"]));
    await expect(canvas.getByLabelText("Aktivitäten werden geladen")).toBeVisible();
    await expect(canvas.queryByText("Noch keine Kommentare, Nachfragen oder relevante Aktivitäten.")).not.toBeInTheDocument();
    const heading = canvas.getByRole("heading", { name: "Reliable planning", level: 1 });
    releases.splice(0).forEach(release => release());
    const retry = await canvas.findByRole("button", { name: "Diskussion erneut laden" });
    await userEvent.click(retry);
    await canvas.findByText("Independent discussion receipt");
    await expect(canvas.getByRole("heading", { name: "Reliable planning", level: 1 })).toBe(heading);
    await expect(canvas.getByRole("button", { name: "Aktivität erneut laden" })).toBeEnabled();
    await waitFor(() => expect([...areas].sort()).toEqual(["discussion", "discussion", "timeline"]));
    await waitFor(() => expect(canvas.getByRole("tab", { name: /Aktivität/ })).toHaveFocus());
    await userEvent.click(canvas.getByRole("tab", { name: "Übersicht" }));
    await expect(canvas.getByText("Unteraufgaben noch nicht geladen.")).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Unteraufgaben laden" })).toBeEnabled();
    await userEvent.click(canvas.getByRole("tab", { name: /Beziehungen/ }));
    await expect(canvas.getByText("Beziehungen und Blocker noch nicht geladen.")).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Beziehungen laden" })).toBeEnabled();
    await expect(canvas.queryByText("Keine Beziehungen vorhanden.")).not.toBeInTheDocument();
  },
};


export const VisibleChildrenLoadWithoutACompleteDetailRead: Story = {
  args: { initialCommentTarget: undefined },
  parameters: { detailScenario: "children" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(areas).toEqual(["children"]));
    await expect(canvas.getByRole("heading", { name: "Reliable planning", level: 1 })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Bearbeiten" }));
    const title = await canvas.findByRole("textbox", { name: "Titel" });
    await userEvent.clear(title); await userEvent.type(title, "Preserved child-loading draft");
    await waitFor(() => expect(revealChildren).toBeDefined());
    revealChildren?.();
    await expect(await canvas.findByRole("link", { name: /Visible independent child/ })).toBeVisible();
    await expect(title).toHaveValue("Preserved child-loading draft");
    await expect(title).toHaveFocus();
    await expect(within(canvas.getByRole("region", { name: "Sub-Issues" })).getByRole("progressbar", { name: "0 von 1 Sub-Issues erledigt" })).toBeVisible();
    await expect(areas).toEqual(["children"]);
  },
};
