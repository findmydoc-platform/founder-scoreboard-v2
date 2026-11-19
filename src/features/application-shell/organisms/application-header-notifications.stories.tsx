import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { getRouter } from "@storybook/nextjs-vite/navigation.mock";
import { PlanningApp } from "@/features/planning/PlanningApp";
import { productUpdates } from "@/features/product-updates/model/product-update-registry";
import { PlatformReleasesShell } from "@/features/platform-releases/templates/platform-releases-shell";
import { PlatformReleaseArchive } from "@/features/platform-releases/organisms/platform-release-archive";
import { releaseStoryFixture } from "@/features/platform-releases/organisms/platform-release-story-fixture";
import { TaskDetailPage } from "@/features/tasks/templates/task-detail-page";
import { taskDetailModelToPlanningShellState } from "@/features/tasks/model/task-detail-planning-shell-projection";
import { readyHeaderSlot } from "@/lib/planning-header-data";
import type { HeaderNotification } from "@/lib/types";
import { createBrowserSessionAdapter } from "@/lib/credentials/browser";
import { itemPageHeaderData, itemPageModel, itemPageProfile, itemPageUser, mockItemPageBrowser } from "../../../../tests/helpers/task-detail-page-browser-fixture";

const notification: HeaderNotification = {
  id: 597, type: "task.assigned", actorProfileId: "", actorLabel: "System", recipientProfileId: itemPageProfile.id,
  entityType: "task", entityId: "item-page-task", title: "Open planning assignment", body: "Inspect the assigned Item.",
  targetPath: "", createdAt: "2026-11-02T09:00:00Z",
};
const headerData = { ...itemPageHeaderData, notifications: readyHeaderSlot({ unreadCount: 1, items: [notification] }) };

function notificationHeader(targetPath = "") {
  return { ...headerData, notifications: readyHeaderSlot({ unreadCount: 1, items: [{ ...notification, targetPath }] }) };
}

let completeNotificationResponse: (() => void) | undefined;

function NotificationPlanningPage({ host = "planning", targetPath = "", outcome, loaded = true }: { host?: "planning" | "item" | "releases"; targetPath?: string; outcome?: "saved" | "rejected" | "unconfirmed" | "delayed"; delayedResult?: "rejected" | "unconfirmed"; loaded?: boolean; unboundHeader?: boolean }) {
  const pageHeader = notificationHeader(targetPath);
  if (host === "item") return <TaskDetailPage taskId="item-page-task" initialModel={itemPageModel()} headerData={pageHeader}
    source="supabase" authRequired initialAuthUser={itemPageUser} initialCurrentProfile={itemPageProfile} />;
  if (host === "releases") return <PlatformReleasesShell authUser={itemPageUser} currentPlatformRole={itemPageProfile.platformRole}
    initialCurrentProfile={itemPageProfile} headerData={pageHeader} calendarProfiles={readyHeaderSlot([itemPageProfile])}>
    <PlatformReleaseArchive releases={[releaseStoryFixture()]} />
  </PlatformReleasesShell>;
  const data = taskDetailModelToPlanningShellState(itemPageModel());
  return <><PlanningApp
    initialData={loaded ? data : { ...data, tasks: [] }} initialHeaderData={pageHeader}
    initialWorkspace="planning" source="supabase" authRequired initialAuthUser={itemPageUser}
    initialCurrentProfile={itemPageProfile} initialProtectedDataLoaded
  />{outcome === "delayed" ? <button type="button" onClick={() => completeNotificationResponse?.()}>Complete notification response</button> : null}</>;
}

let statusActions: string[] = [];
const meta = {
  title: "Application shell/Notifications",
  component: NotificationPlanningPage,
  parameters: { layout: "fullscreen", nextjs: { appDirectory: true } },
  beforeEach: async ({ args }) => {
    statusActions = [];
    completeNotificationResponse = undefined;
    const seenKey = `founderops.product-updates.seen.${itemPageProfile.id}`;
    const previousSeen = localStorage.getItem(seenKey);
    localStorage.setItem(seenKey, JSON.stringify(productUpdates.map(update => update.id)));
    let currentHeader = notificationHeader(args.targetPath);
    const headerAuthority = { userId: itemPageUser.id, deadline: Date.now() + 60_000 };
    const restoreBrowser = await mockItemPageBrowser({ headerData: notificationHeader(args.targetPath), respond: (input, init) => {
      const path = new URL(String(input), window.location.origin).pathname;
      if (path === "/api/planning-header-data") return Response.json({ headerData: currentHeader, readAuthority: args.unboundHeader ? undefined : headerAuthority });
      if (path === "/api/tasks/item-page-task/detail-data") return Response.json({ taskDetail: itemPageModel(), unavailable: [] });
      if (path === "/api/notifications/597" && init?.method === "PATCH") {
        const action = JSON.parse(String(init.body)).action;
        statusActions.push(action);
        if (args.outcome === "unconfirmed") return Response.json({ error: "Response was lost" }, { status: 503 });
        if (args.outcome === "rejected") return Response.json({ error: "Die Benachrichtigung kann nicht geöffnet werden." }, { status: 422 });
        const accepted = () => {
          currentHeader = { ...currentHeader, notifications: readyHeaderSlot({ unreadCount: 7, items: [] }) };
          return Response.json({ ok: true, action, status: action === "dismiss" ? "dismissed" : "pending" });
        };
        if (args.outcome === "delayed") return new Promise<Response>(resolve => {
          completeNotificationResponse = () => resolve(args.delayedResult === "rejected"
            ? Response.json({ error: "Die Benachrichtigung kann nicht geöffnet werden." }, { status: 422 })
            : args.delayedResult === "unconfirmed" ? Response.json({ error: "Response was lost" }, { status: 503 })
            : accepted());
        });
        return accepted();
      }
      return undefined;
    } });
    return () => {
      restoreBrowser();
      if (previousSeen === null) localStorage.removeItem(seenKey);
      else localStorage.setItem(seenKey, previousSeen);
    };
  },
} satisfies Meta<typeof NotificationPlanningPage>;
export default meta;
type Story = StoryObj<typeof meta>;

export const Inbox: Story = {};

export const LoadedPlanningItemOpensFullPage: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Benachrichtigungen" }));
    await userEvent.click(canvas.getByRole("link", { name: /Open planning assignment/ }));
    await waitFor(() => expect(getRouter().push).toHaveBeenCalledTimes(1));
    await expect(getRouter().push).toHaveBeenCalledWith("/tasks/item-page-task");
  },
};

export const PlanningWithoutLocalItemOpensFullPage: Story = {
  args: { loaded: false },
  play: LoadedPlanningItemOpensFullPage.play,
};

export const DirtyItemKeepsOrDiscardsNotificationNavigation: Story = {
  args: { host: "item" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Bearbeiten" }));
    const title = canvas.getByRole("textbox", { name: "Titel" });
    await userEvent.type(title, " with private edits");
    await userEvent.click(canvas.getByRole("button", { name: "Benachrichtigungen" }));
    await userEvent.click(canvas.getByRole("link", { name: /Open planning assignment/ }));
    await userEvent.click(within(await canvas.findByRole("alertdialog")).getByRole("button", { name: "Weiter bearbeiten" }));
    await expect(title).toHaveValue("Reliable planning with private edits");
    await expect(getRouter().push).not.toHaveBeenCalled();
    await expect(statusActions).toEqual([]);
    await userEvent.click(canvas.getByRole("button", { name: "Benachrichtigungen" }));
    await userEvent.click(canvas.getByRole("link", { name: /Open planning assignment/ }));
    await userEvent.click(within(await canvas.findByRole("alertdialog")).getByRole("button", { name: "Änderungen verwerfen" }));
    await waitFor(() => expect(getRouter().push).toHaveBeenCalledTimes(1));
    await expect(getRouter().push).toHaveBeenCalledWith("/tasks/item-page-task");
    await expect(statusActions).toEqual(["seen"]);
  },
};

const anchoredTarget = "/tasks/item-page-task?comment=github%3A42&returnTo=%2Fteam%2Fplatform-releases%2Fv1.2.3%3Fsection%3Dplanning%23change-7#discussion";

export const ExplicitTargetKeepsQueryAndAnchor: Story = {
  args: { targetPath: anchoredTarget },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Benachrichtigungen" }));
    const target = canvas.getByRole("link", { name: /Open planning assignment/ });
    await expect(target).toHaveAttribute("href", anchoredTarget);
    const user = userEvent.setup();
    await user.keyboard("{Control>}");
    await user.click(target);
    await user.keyboard("{/Control}");
    await expect(statusActions).toEqual([]);
    await expect(getRouter().push).not.toHaveBeenCalled();
    await userEvent.click(target);
    await waitFor(() => expect(getRouter().push).toHaveBeenCalledTimes(1));
    await expect(getRouter().push).toHaveBeenCalledWith(anchoredTarget);
    await expect(statusActions).toEqual(["seen"]);
  },
};

export const ReleaseHeaderUsesTheSameFullDestination: Story = {
  args: { host: "releases", targetPath: anchoredTarget },
  play: ExplicitTargetKeepsQueryAndAnchor.play,
};

export const UnconfirmedSeenDoesNotNavigateOrReplay: Story = {
  args: { outcome: "unconfirmed" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Benachrichtigungen" }));
    await userEvent.click(canvas.getByRole("link", { name: /Open planning assignment/ }));
    await expect(await canvas.findByText(/Ob die Benachrichtigung als gesehen markiert wurde, ist noch unklar/)).toBeVisible();
    await expect(getRouter().push).not.toHaveBeenCalled();
    await userEvent.click(canvas.getByRole("button", { name: "Aktuellen Stand prüfen" }));
    await expect(await canvas.findByRole("button", { name: "Aktuellen Stand prüfen" })).toBeEnabled();
    await expect(statusActions).toEqual(["seen"]);
    await expect(getRouter().push).not.toHaveBeenCalled();
  },
};

export const LogoutDiscardsDelayedNotificationNavigation: Story = {
  args: { outcome: "delayed" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Benachrichtigungen" }));
    await userEvent.click(canvas.getByRole("link", { name: /Open planning assignment/ }));
    await expect(await canvas.findByText("Wird als gesehen markiert.")).toBeVisible();
    await expect(getRouter().push).not.toHaveBeenCalled();
    await userEvent.click(canvas.getByRole("button", { name: "Account-Menü öffnen" }));
    await userEvent.click(canvas.getByRole("button", { name: "Abmelden" }));
    await waitFor(() => expect(canvas.queryByRole("button", { name: "Account-Menü öffnen" })).not.toBeInTheDocument());
    await userEvent.click(canvas.getByRole("button", { name: "Complete notification response" }));
    await expect(getRouter().push).not.toHaveBeenCalled();
    await expect(statusActions).toEqual(["seen"]);
    await expect(canvas.queryByRole("link", { name: /Open planning assignment/ })).not.toBeInTheDocument();
  },
};

export const DirtyItemProtectsNotificationCenter: Story = {
  args: { host: "item" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Bearbeiten" }));
    const title = canvas.getByRole("textbox", { name: "Titel" });
    await userEvent.type(title, " with private edits");
    await userEvent.click(canvas.getByRole("button", { name: "Benachrichtigungen" }));
    const user = userEvent.setup();
    await user.keyboard("{Control>}");
    await user.click(canvas.getByRole("link", { name: "Zum Center" }));
    await user.keyboard("{/Control}");
    await expect(getRouter().push).not.toHaveBeenCalled();
    await expect(canvas.queryByRole("alertdialog")).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Benachrichtigungen" }));
    await userEvent.click(canvas.getByRole("link", { name: "Zum Center" }));
    await userEvent.click(within(await canvas.findByRole("alertdialog")).getByRole("button", { name: "Weiter bearbeiten" }));
    await expect(title).toHaveValue("Reliable planning with private edits");
    await expect(getRouter().push).not.toHaveBeenCalled();
    await userEvent.click(canvas.getByRole("button", { name: "Benachrichtigungen" }));
    await userEvent.click(canvas.getByRole("link", { name: "Zum Center" }));
    await userEvent.click(within(await canvas.findByRole("alertdialog")).getByRole("button", { name: "Änderungen verwerfen" }));
    await expect(getRouter().push).toHaveBeenCalledTimes(1);
    await expect(getRouter().push).toHaveBeenCalledWith("/notifications");
    await expect(statusActions).toEqual([]);
  },
};

export const CardsKeepTheirDirtyPanelWorkflow: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("link", { name: "Reliable planning" }));
    const panel = within(await canvas.findByRole("dialog", { name: "Reliable planning" }));
    const edit = await panel.findByRole("button", { name: "Bearbeiten" });
    await waitFor(() => expect(edit).toBeEnabled());
    await userEvent.click(edit);
    const title = await waitFor(() => within(canvas.getByRole("dialog", { name: "Reliable planning" })).getByRole("textbox", { name: "Titel" }));
    await userEvent.type(title, " panel draft");
    await userEvent.keyboard("{Escape}");
    await userEvent.click(within(await canvas.findByRole("alertdialog")).getByRole("button", { name: "Weiter bearbeiten" }));
    await expect(title).toHaveValue("Reliable planning panel draft");
    await expect(getRouter().push).not.toHaveBeenCalled();
    await expect(statusActions).toEqual([]);
    await userEvent.keyboard("{Escape}");
    await userEvent.click(within(await canvas.findByRole("alertdialog")).getByRole("button", { name: "Änderungen verwerfen" }));
    await waitFor(() => expect(canvas.queryByRole("dialog")).not.toBeInTheDocument());
    await userEvent.click(canvas.getByRole("button", { name: "Benachrichtigungen" }));
    await userEvent.click(canvas.getByRole("link", { name: /Open planning assignment/ }));
    await waitFor(() => expect(getRouter().push).toHaveBeenCalledTimes(1));
    await expect(getRouter().push).toHaveBeenCalledWith("/tasks/item-page-task");
    await expect(statusActions).toEqual(["seen"]);
  },
};

export const DismissKeepsTheAuthoritativeUnreadCount: Story = {
  args: { outcome: "delayed" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const inbox = await canvas.findByRole("button", { name: "Benachrichtigungen" });
    await expect(inbox).toHaveTextContent("1");
    await userEvent.click(inbox);
    await userEvent.click(canvas.getByRole("button", { name: "Notification schließen" }));
    await expect(await canvas.findByText("Benachrichtigung wird geschlossen.")).toBeVisible();
    await expect(inbox).toHaveTextContent("…");
    await expect(statusActions).toEqual(["dismiss"]);
    await userEvent.click(canvas.getByRole("button", { name: "Complete notification response" }));
    await waitFor(() => expect(inbox).toHaveTextContent("7"));
    await userEvent.click(inbox);
    await expect(canvas.getByText("Keine neuen Hinweise.")).toBeVisible();
    await expect(getRouter().push).not.toHaveBeenCalled();
    await expect(statusActions).toEqual(["dismiss"]);
  },
};

export const UnboundHeaderCannotCertifyTheUnreadCount: Story = {
  args: { outcome: "delayed", unboundHeader: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const inbox = await canvas.findByRole("button", { name: "Benachrichtigungen" });
    await expect(inbox).toHaveTextContent("1");
    await userEvent.click(inbox);
    await userEvent.click(canvas.getByRole("button", { name: "Notification schließen" }));
    await userEvent.click(canvas.getByRole("button", { name: "Complete notification response" }));
    await userEvent.click(inbox);
    await expect(await canvas.findByText("Die ursprüngliche Leseberechtigung konnte nicht bestätigt werden.")).toBeVisible();
    await expect(inbox).toHaveTextContent("…");
    await expect(inbox).not.toHaveTextContent("7");
    await expect(statusActions).toEqual(["dismiss"]);
    await expect(getRouter().push).not.toHaveBeenCalled();
  },
};

export const DelayedSeenWaitsForItsSavedResult: Story = {
  args: { outcome: "delayed" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Benachrichtigungen" }));
    await userEvent.click(canvas.getByRole("link", { name: /Open planning assignment/ }));
    await expect(await canvas.findByText("Wird als gesehen markiert.")).toBeVisible();
    await expect(getRouter().push).not.toHaveBeenCalled();
    await expect(statusActions).toEqual(["seen"]);
    await userEvent.click(canvas.getByRole("button", { name: "Complete notification response" }));
    await waitFor(() => expect(getRouter().push).toHaveBeenCalledTimes(1));
    await expect(getRouter().push).toHaveBeenCalledWith("/tasks/item-page-task");
    await expect(statusActions).toEqual(["seen"]);
  },
};

export const DirtyItemNotificationDeparturePending: Story = {
  args: { host: "item", outcome: "delayed" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Bearbeiten" }));
    await userEvent.type(canvas.getByRole("textbox", { name: "Titel" }), " with private edits");
    await userEvent.click(canvas.getByRole("button", { name: "Benachrichtigungen" }));
    await userEvent.click(canvas.getByRole("link", { name: /Open planning assignment/ }));
    await userEvent.click(within(await canvas.findByRole("alertdialog")).getByRole("button", { name: "Änderungen verwerfen" }));
    const departure = within(canvas.getByRole("alertdialog"));
    await expect(departure.getByRole("status")).toHaveTextContent("Die gewählte Seite wird geöffnet.");
    await expect(departure.getByRole("button", { name: "Änderungen verwerfen" })).toBeDisabled();
    await expect(departure.getByRole("button", { name: "Weiter bearbeiten" })).toBeDisabled();
    await userEvent.keyboard("{Escape}{Tab}");
    await expect(canvas.getByRole("alertdialog")).toHaveFocus();
    await expect(getRouter().push).not.toHaveBeenCalled();
    await expect(statusActions).toEqual(["seen"]);
  },
};

export const DirtyItemWaitsForApprovedNotificationDeparture: Story = {
  args: { host: "item", outcome: "delayed" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Bearbeiten" }));
    const title = canvas.getByRole("textbox", { name: "Titel" });
    await userEvent.type(title, " with private edits");
    await userEvent.click(canvas.getByRole("button", { name: "Benachrichtigungen" }));
    await userEvent.click(canvas.getByRole("link", { name: /Open planning assignment/ }));
    await userEvent.click(within(await canvas.findByRole("alertdialog")).getByRole("button", { name: "Änderungen verwerfen" }));
    title.focus();
    await userEvent.keyboard(" new draft after approval");
    await expect(getRouter().push).not.toHaveBeenCalled();
    await expect(statusActions).toEqual(["seen"]);
    completeNotificationResponse?.();
    await waitFor(() => expect(getRouter().push).toHaveBeenCalledTimes(1));
    await expect(title).toHaveValue("Reliable planning with private edits");
    await expect(getRouter().push).toHaveBeenCalledWith("/tasks/item-page-task");
    await expect(canvas.queryByRole("alertdialog")).not.toBeInTheDocument();
    await expect(statusActions).toEqual(["seen"]);
  },
};

export const CleanItemWaitsForNotificationDeparture: Story = {
  args: { host: "item", outcome: "delayed" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Bearbeiten" }));
    const title = canvas.getByRole("textbox", { name: "Titel" });
    await userEvent.click(canvas.getByRole("button", { name: "Benachrichtigungen" }));
    await userEvent.click(canvas.getByRole("link", { name: /Open planning assignment/ }));
    await expect(statusActions).toEqual(["seen"]);
    await expect(canvas.getByRole("alertdialog")).toHaveAccessibleName("Seite wird geöffnet");
    await expect(getRouter().push).not.toHaveBeenCalled();
    title.focus();
    await userEvent.keyboard("new draft after departure started");
    completeNotificationResponse?.();
    await waitFor(() => expect(getRouter().push).toHaveBeenCalledTimes(1));
    await expect(title).toHaveValue("Reliable planning");
    await expect(getRouter().push).toHaveBeenCalledWith("/tasks/item-page-task");
    await expect(statusActions).toEqual(["seen"]);
  },
};

export const CleanItemProfileNavigationRemainsImmediate: Story = {
  args: { host: "item" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Bearbeiten" }));
    await userEvent.click(canvas.getByRole("button", { name: "Account-Menü öffnen" }));
    await userEvent.click(canvas.getByRole("button", { name: /Profil/ }));
    await expect(getRouter().push).toHaveBeenCalledTimes(1);
    await expect(getRouter().push).toHaveBeenCalledWith("/profile");
    await expect(canvas.queryByRole("alertdialog")).not.toBeInTheDocument();
    await expect(statusActions).toEqual([]);
  },
};

async function expectDirtyItemDepartureRecovery(canvasElement: HTMLElement, message: string | RegExp) {
  const canvas = within(canvasElement);
  await userEvent.click(await canvas.findByRole("button", { name: "Bearbeiten" }));
  const title = canvas.getByRole("textbox", { name: "Titel" });
  await userEvent.type(title, " with private edits");
  await userEvent.click(canvas.getByRole("button", { name: "Benachrichtigungen" }));
  await userEvent.click(canvas.getByRole("link", { name: /Open planning assignment/ }));
  await userEvent.click(within(await canvas.findByRole("alertdialog")).getByRole("button", { name: "Änderungen verwerfen" }));
  await expect(within(canvas.getByRole("alertdialog")).getByRole("status")).toBeVisible();
  completeNotificationResponse?.();
  await waitFor(() => expect(canvas.queryByRole("alertdialog")).not.toBeInTheDocument());
  await expect(await canvas.findByText(message)).toBeVisible();
  await userEvent.type(title, " recovered");
  await expect(title).toHaveValue("Reliable planning with private edits recovered");
  await expect(getRouter().push).not.toHaveBeenCalled();
  await expect(statusActions).toEqual(["seen"]);
  await userEvent.click(canvas.getByRole("button", { name: "Account-Menü öffnen" }));
  await userEvent.click(canvas.getByRole("button", { name: /Profil/ }));
  await userEvent.keyboard("{Escape}");
  await waitFor(() => expect(canvas.queryByRole("alertdialog")).not.toBeInTheDocument());
  await expect(title).toHaveValue("Reliable planning with private edits recovered");
  await expect(getRouter().push).not.toHaveBeenCalled();
}

export const DirtyItemRecoversAfterRejectedNotificationDeparture: Story = {
  args: { host: "item", outcome: "delayed", delayedResult: "rejected" },
  play: ({ canvasElement }) => expectDirtyItemDepartureRecovery(canvasElement, "Die Benachrichtigung kann nicht geöffnet werden."),
};

export const DirtyItemRecoversAfterUnconfirmedNotificationDeparture: Story = {
  args: { host: "item", outcome: "delayed", delayedResult: "unconfirmed" },
  play: ({ canvasElement }) => expectDirtyItemDepartureRecovery(canvasElement, /Ob die Benachrichtigung als gesehen markiert wurde, ist noch unklar/),
};

export const SessionEndReleasesApprovedItemDeparture: Story = {
  args: { host: "item", outcome: "delayed" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Bearbeiten" }));
    await userEvent.type(canvas.getByRole("textbox", { name: "Titel" }), " with private edits");
    await userEvent.click(canvas.getByRole("button", { name: "Benachrichtigungen" }));
    await userEvent.click(canvas.getByRole("link", { name: /Open planning assignment/ }));
    await userEvent.click(within(await canvas.findByRole("alertdialog")).getByRole("button", { name: "Änderungen verwerfen" }));
    await expect(within(canvas.getByRole("alertdialog")).getByRole("status")).toBeVisible();
    await createBrowserSessionAdapter().logout();
    await waitFor(() => expect(canvas.queryByRole("textbox", { name: "Titel" })).not.toBeInTheDocument());
    completeNotificationResponse?.();
    await waitFor(() => expect(canvas.queryByRole("alertdialog")).not.toBeInTheDocument());
    await expect(getRouter().push).not.toHaveBeenCalled();
    await expect(statusActions).toEqual(["seen"]);
  },
};

export const RejectedSeenKeepsTheCurrentPage: Story = {
  args: { outcome: "rejected" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Benachrichtigungen" }));
    await userEvent.click(canvas.getByRole("link", { name: /Open planning assignment/ }));
    await expect(await canvas.findByText("Die Benachrichtigung kann nicht geöffnet werden.")).toBeVisible();
    await expect(getRouter().push).not.toHaveBeenCalled();
    await expect(statusActions).toEqual(["seen"]);
  },
};
