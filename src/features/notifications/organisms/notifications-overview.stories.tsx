import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { NotificationsOverview } from "./notifications-overview";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { createPlanningState } from "@/features/planning/model/internal/planning-state-owner";
import { useEffect, useState, useSyncExternalStore } from "react";
import { PlanningBusinessStateContext } from "@/features/planning/hooks/use-planning-business-state";
import { usePlanningHeaderData } from "@/features/planning/hooks/use-planning-header-data";
import { PlanningServerNotificationReceipt } from "@/features/planning/organisms/planning-server-notification-receipt";
import { notificationCountSlot } from "../model/notification-count-slot";
const meta = { component: NotificationsOverview, args: { currentProfile: null, data: emptyPlanningShellState, onOpenNotification: () => {}, onDismissNotification: () => {} } } satisfies Meta<typeof NotificationsOverview>;
export default meta;
type Story = StoryObj<typeof meta>;
export const ForbiddenIsNotAnEmptyResult: Story = { args: { readStatus: "forbidden" }, play: async ({ canvasElement }) => {
  const canvas = within(canvasElement);
  await expect(canvas.getByRole("status")).toHaveTextContent("Kein Zugriff auf Benachrichtigungen.");
  await expect(canvas.queryByText("Keine Hinweise für diesen Filter.")).not.toBeInTheDocument();
} };
export const Loading: Story = { args: { readStatus: "loading" } };
export const Unavailable: Story = { args: { readStatus: "unavailable" } };

const event = { id: 41, type: "task.assigned", actorProfileId: "", actorLabel: "System", recipientProfileId: "person", entityType: "task", entityId: "off-page-item", title: "Inbox item", body: "", createdAt: "2026-11-02T09:00:00Z", status: "pending", seenAt: "", dismissedAt: "", resolvedAt: "", resolutionReason: "" } as const;
export const InboxSeparatesLoadedAndExactCounts: Story = {
  args: { data: { ...emptyPlanningShellState, notificationEvents: [event] }, completeness: "partial", count: { state: "ready", data: 42 } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Inbox item")).toBeVisible();
    await expect(canvas.getByText("42 ungelesen insgesamt")).toBeVisible();
    await expect(canvas.getByText("1 neu in geladenen Hinweisen")).toBeVisible();
  },
};
export const InboxSurvivesCountFailure: Story = {
  args: { data: { ...emptyPlanningShellState, notificationEvents: [event] }, completeness: "partial", count: { state: "error", data: null }, onRetryCount: () => {} },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Inbox item")).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Ungelesene Anzahl erneut laden" })).toBeVisible();
    await expect(canvas.queryByText("0 ungelesen insgesamt")).not.toBeInTheDocument();
  },
};

export const AdditionalInboxPageIsReachable: Story = {
  args: { data: { ...emptyPlanningShellState, notificationEvents: [event] }, completeness: "partial", continuation: "next", onLoadMore: fn() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Weitere Hinweise laden" }));
    await expect(args.onLoadMore).toHaveBeenCalledOnce();
    await expect(canvas.getByText("Inbox item")).toBeVisible();
  },
};

export const EmptyLoadedFilterStillOffersNextPage: Story = {
  args: { data: { ...emptyPlanningShellState, notificationEvents: [event] }, completeness: "partial", continuation: "next", onLoadMore: fn() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: /Erledigt/ }));
    await expect(canvas.getByText("Keine geladenen Hinweise für diesen Filter.")).toBeVisible();
    await expect(canvas.queryByText("Keine Hinweise für diesen Filter.")).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Weitere Hinweise laden" }));
    await expect(args.onLoadMore).toHaveBeenCalledOnce();
  },
};

export const FailedNextPageKeepsRowsAndCanRetry: Story = {
  args: { data: { ...emptyPlanningShellState, notificationEvents: [event] }, completeness: "partial", continuation: "next", pageError: true, onLoadMore: fn() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Inbox item")).toBeVisible();
    await expect(canvas.getByText("Weitere Hinweise konnten nicht geladen werden.")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Weitere Hinweise laden" }));
    await expect(args.onLoadMore).toHaveBeenCalledOnce();
  },
};

export const FailedInboxCanBeRetried: Story = {
  args: { readStatus: "unavailable", onRetryInbox: fn() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Benachrichtigungen erneut laden" }));
    await expect(args.onRetryInbox).toHaveBeenCalledOnce();
    await expect(canvas.queryByText("Keine Hinweise für diesen Filter.")).not.toBeInTheDocument();
  },
};

export const ExactCountSurvivesInboxFailure: Story = {
  args: { readStatus: "unavailable", count: { state: "ready", data: 42 }, onRetryInbox: fn() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("status")).toHaveTextContent("Benachrichtigungen konnten nicht geladen werden.");
    await expect(canvas.getByText("42 ungelesen insgesamt")).toBeVisible();
  },
};

export const TargetedReferenceOpensWithoutLoadedTask: Story = {
  args: { data: { ...emptyPlanningShellState, notificationEvents: [event] }, references: [{ itemId: "off-page-item", title: "Targeted Item", taskType: "deliverable" }], onOpenNotification: fn() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Targeted Item")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: /Inbox item/ }));
    await expect(args.onOpenNotification).toHaveBeenCalledWith(event);
  },
};

export const MissingReferencesDoNotHideNotifications: Story = {
  args: { data: { ...emptyPlanningShellState, notificationEvents: [event] }, references: [], referenceCoverage: "unavailable", onOpenNotification: fn() },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Planungsdetails sind nicht vollständig verfügbar.")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: /Inbox item/ }));
    await expect(args.onOpenNotification).toHaveBeenCalledWith(event);
  },
};

function InteractiveInboxFixture() {
  const [owner] = useState(() => {
    const actor = { id: "person", name: "Reader", platformRole: "founder" as const, orgRole: "Founder", githubLogin: "", weeklyCapacity: 40 };
    let reads = 0;
    return createPlanningState({ userId: "reader", initialCurrentProfile: actor, initialData: emptyPlanningShellState, adapter: {
      saveTask: async () => ({ task: {} }), readWorkspace: async () => null,
      readNotificationInbox: async () => { const version = ++reads; return { events: [{ ...event, title: version === 1 ? "Before update" : "After update" }], coverage: "complete" as const, continuation: null, references: [], referenceCoverage: "complete" as const, sourceRevision: `source-${version}`, observedAt: new Date(Date.now() - 1).toISOString(), validUntil: new Date(Date.now() + 60_000).toISOString(), readAuthority: { userId: "reader", deadline: Date.now() + 60_000 }, readActor: { profileId: actor.id, platformRole: actor.platformRole } }; },
    } });
  });
  const data = useSyncExternalStore(owner.planning.subscribe, owner.internal.getSnapshot, owner.internal.getSnapshot);
  useEffect(() => { void owner.planning.loadNotificationPage(); return () => owner.internal.dispose(); }, [owner]);
  return <><button type="button" onClick={() => { void owner.planning.loadNotificationPage(); }}>Remote update</button><NotificationsOverview data={data} currentProfile={null} readStatus={owner.planning.notifications().readStatus} onOpenNotification={() => {}} onDismissNotification={() => {}} onInteractionChange={active => owner.planning.setNotificationInteraction(active)} /></>;
}
export const FocusedFilterKeepsItsInboxUntilBlur: Story = {
  render: () => <InteractiveInboxFixture />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("Before update")).toBeVisible();
    const filter = canvas.getByRole("button", { name: /Erledigt/ });
    filter.focus();
    canvas.getByRole("button", { name: "Remote update" }).click();
    await expect(await canvas.findByText("Der Stand der Benachrichtigungen wird geprüft.")).toBeVisible();
    await expect(filter).toHaveFocus();
    await expect(canvas.getByText("Before update")).toBeVisible();
    canvas.getByRole("button", { name: "Remote update" }).focus();
    await expect(await canvas.findByText("After update")).toBeVisible();
  },
};

function StreamedInboxFixture() {
  const [fixture] = useState(() => {
    const now = Date.now(), userId = "notification-entry-user";
    const readAuthority = { userId, deadline: now + 15_000 };
    const session = { user: { id: userId }, userId, revision: "entry-session", expiresAt: Math.ceil((now + 16_000) / 1_000) };
    const initialCurrentProfile = { id: "person", name: "Viewer", githubLogin: "", platformRole: "viewer" as const };
    const read = { id: "notification-entry", readAuthority, session, timeoutAt: now + 10_000 };
    const receipt = { readAuthority, readActor: { profileId: "person", platformRole: "viewer" as const }, sourceRevision: "entry-source",
      observedAt: new Date(now - 1).toISOString(), validUntil: new Date(now + 13_000).toISOString() };
    const owner = createPlanningState({ userId, initialData: emptyPlanningShellState, initialWorkspace: "notifications", initialCurrentProfile,
      initialSession: session, initialNotificationEntry: read, adapter: {
        saveTask: async () => ({ task: {} }), readWorkspace: async () => null,
        readNotificationInbox: async () => { throw new Error("Unexpected duplicate inbox"); },
        readNotificationCount: async () => ({ ...receipt, unreadCount: 42 }),
      } });
    return { owner, receipt, read };
  });
  const { owner, receipt, read } = fixture;
  const [inbox, setInbox] = useState(false), [countFailed, setCountFailed] = useState(false);
  const data = useSyncExternalStore(owner.planning.subscribe, owner.internal.getSnapshot, owner.internal.getSnapshot);
  useEffect(() => { owner.internal.watchServerHeaderRead(); return () => owner.internal.dispose(); }, [owner]);
  usePlanningHeaderData({ planningState: owner.planning, enabled: true, notificationsWorkspace: true });
  return <PlanningBusinessStateContext.Provider value={owner.planning}>
    <button type="button" onClick={() => setInbox(true)}>Receive Inbox receipt</button>
    <button type="button" onClick={() => setCountFailed(true)}>Fail Count receipt</button>
    {inbox ? <PlanningServerNotificationReceipt id={read.id} outcome={{ area: "inbox", result: { status: "ready", receipt: {
      ...receipt, events: [event], references: [], referenceCoverage: "unavailable", coverage: "complete", continuation: null,
    } } }} /> : null}
    {countFailed ? <PlanningServerNotificationReceipt id={read.id} outcome={{ area: "count", result: { status: "unavailable" } }} /> : null}
    <NotificationsOverview data={data} currentProfile={null} readStatus={owner.planning.notifications().readStatus}
      count={notificationCountSlot(owner.planning.notificationCount())}
      onRetryCount={() => { void owner.planning.refreshNotificationCount(); }} onOpenNotification={() => {}} onDismissNotification={() => {}} />
  </PlanningBusinessStateContext.Provider>;
}

export const StreamedInboxSurvivesAnIndependentCountFailure: Story = {
  render: () => <StreamedInboxFixture />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("Benachrichtigungen werden geladen.")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Receive Inbox receipt" }));
    await expect(await canvas.findByText("Inbox item")).toBeVisible();
    await expect(canvas.queryByText("42 ungelesen insgesamt")).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Fail Count receipt" }));
    await userEvent.click(await canvas.findByRole("button", { name: "Ungelesene Anzahl erneut laden" }));
    await expect(await canvas.findByText("42 ungelesen insgesamt")).toBeVisible();
    await expect(canvas.getByText("Inbox item")).toBeVisible();
  },
};
