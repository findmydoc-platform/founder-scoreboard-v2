import { useEffect, useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { getRouter } from "@storybook/nextjs-vite/navigation.mock";
import { PlanningApp } from "@/features/planning/PlanningApp";
import { PlanningStateProvider } from "@/features/planning/organisms/planning-state-provider";
import { productUpdates } from "@/features/product-updates/model/product-update-registry";
import { taskDetailModelToPlanningShellState } from "@/features/tasks/model/task-detail-planning-shell-projection";
import { parseTaskCommentTarget } from "@/features/tasks/model/task-comment-target";
import { readyHeaderSlot } from "@/lib/planning-header-data";
import { TaskDetailPage } from "./task-detail-page";
import { itemPageHeaderData, itemPageModel, itemPageProfile, itemPageUser, mockItemPageBrowser } from "../../../../tests/helpers/task-detail-page-browser-fixture";

const model = itemPageModel();
const targetPath = `/tasks/${model.item.id}?focus=local:731`;
const detailModel = {
  ...model,
  discussion: { ...model.discussion, comments: [{
    id: 731, taskId: model.item.id, profileId: itemPageProfile.id,
    comment: "Please check this mentioned planning task.", createdAt: "2026-11-05T18:00:00Z",
    githubDeliveryStatus: "not_applicable" as const, githubCommentUrl: "",
  }] },
};
const summary = { ...model.item, detailAvailability: "summary" as const, problemStatement: "" };
const boardData = { ...taskDetailModelToPlanningShellState(model), tasks: [summary] };
const headerData = {
  ...itemPageHeaderData,
  notifications: readyHeaderSlot({ unreadCount: 1, items: [{
    id: 732, type: "task.mention", actorProfileId: itemPageProfile.id, actorLabel: "Mara",
    recipientProfileId: itemPageProfile.id, entityType: "task", entityId: model.item.id,
    title: "Mentioned in planning", body: "Please check this task.", targetPath, createdAt: "2026-11-05T18:00:00Z",
  }] }),
};

function TaskMentionNavigation({ missingTask = false }: { missingTask?: boolean; failFirstRead?: boolean }) {
  const [destination, setDestination] = useState("");
  useEffect(() => {
    getRouter().push.mockImplementation(href => { setDestination(String(href)); });
    return () => { getRouter().push.mockReset(); };
  }, []);
  return <PlanningStateProvider>
    {destination ? <TaskDetailPage
      taskId={model.item.id} initialModel={detailModel} headerData={headerData}
      initialCommentTarget={parseTaskCommentTarget(new URL(destination, "https://example.test").searchParams.get("focus"))}
      source="supabase" authRequired initialAuthUser={itemPageUser} initialCurrentProfile={itemPageProfile}
    /> : <PlanningApp
      initialData={missingTask ? { ...boardData, tasks: [] } : boardData} initialHeaderData={headerData} initialWorkspace="planning"
      source="supabase" authRequired initialAuthUser={itemPageUser} initialCurrentProfile={itemPageProfile}
      initialProtectedDataLoaded
    />}
  </PlanningStateProvider>;
}

let completeDetailRead: (() => void) | undefined;
const meta = {
  title: "Application shell/Item navigation",
  component: TaskMentionNavigation,
  parameters: { layout: "fullscreen", nextjs: { appDirectory: true } },
  beforeEach: async ({ args }) => {
    completeDetailRead = undefined;
    let detailReads = 0;
    const seenKey = `founderops.product-updates.seen.${itemPageProfile.id}`;
    const previousSeen = localStorage.getItem(seenKey);
    localStorage.setItem(seenKey, JSON.stringify(productUpdates.map(update => update.id)));
    const restore = await mockItemPageBrowser({ headerData, respond: (input, init) => {
      const path = new URL(String(input), window.location.origin).pathname;
      if (path === "/api/notifications/732" && init?.method === "PATCH") return Response.json({ ok: true, action: "seen", status: "pending" });
      if (path === "/api/planning-board-data") return Response.json({
        model: { revision: "board", project: boardData.project, items: args.missingTask ? [] : boardData.tasks, people: boardData.profiles, sprints: [], relationships: [], preferences: [] },
        headerData, currentProfile: itemPageProfile,
      });
      if (path === `/api/tasks/${model.item.id}/detail-data`) {
        if (args.failFirstRead && detailReads++ === 0) return Response.json({ error: "Aufgabendetails sind vorübergehend nicht erreichbar." }, { status: 503 });
        return new Promise<Response>(resolve => {
          completeDetailRead = () => resolve(Response.json({ taskDetail: detailModel, unavailable: [] }));
        });
      }
      return undefined;
    } });
    return () => {
      restore();
      if (previousSeen === null) localStorage.removeItem(seenKey);
      else localStorage.setItem(seenKey, previousSeen);
    };
  },
} satisfies Meta<typeof TaskMentionNavigation>;
export default meta;
type Story = StoryObj<typeof meta>;

async function openMention(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await userEvent.click(await canvas.findByRole("button", { name: "Benachrichtigungen" }));
  await userEvent.click(canvas.getByRole("link", { name: /Mentioned in planning/ }));
}

async function completeAndExpectMention(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await waitFor(() => expect(completeDetailRead).toBeDefined());
  completeDetailRead?.();
  await expect(await canvas.findByRole("heading", { name: "Reliable planning", level: 1 })).toBeVisible();
  await expect(await canvas.findByText("Please check this mentioned planning task.")).toBeVisible();
  await expect(canvas.getByRole("tab", { name: /Aktivität/ })).toHaveAttribute("aria-selected", "true");
  await expect(canvas.queryByText("Aufgabendetails werden geladen …")).not.toBeInTheDocument();
}

export const PlanningMentionLoadsDetailsInSharedState: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await openMention(canvasElement);
    await expect(await canvas.findByRole("link", { name: "Zur Planung" })).toBeVisible();
    await expect(canvas.getByText("Aufgabendetails werden geladen …")).toBeVisible();
    await completeAndExpectMention(canvasElement);
  },
};

export const MissingPlanningTaskLoadsFromMention: Story = {
  args: { missingTask: true },
  play: async ({ canvasElement }) => {
    await openMention(canvasElement);
    await expect(await within(canvasElement).findByText("Aufgabendetails werden geladen …")).toBeVisible();
    await completeAndExpectMention(canvasElement);
  },
};

export const FailedMentionDetailsCanBeRetried: Story = {
  args: { failFirstRead: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await openMention(canvasElement);
    await expect(await canvas.findByText("Aufgabendetails sind vorübergehend nicht erreichbar.")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Erneut laden" }));
    await expect(canvas.getByText("Aufgabendetails werden geladen …")).toBeVisible();
    await completeAndExpectMention(canvasElement);
    await expect(canvas.queryByText("Aufgabendetails sind vorübergehend nicht erreichbar.")).not.toBeInTheDocument();
  },
};
