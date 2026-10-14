import { useEffect, useRef, useState } from "react";
import type { User } from "@supabase/supabase-js";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { NotificationInbox } from "@/features/notifications/organisms/notification-inbox";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { emptyPlanningHeaderData, readyHeaderSlot } from "@/lib/planning-header-data";
import type { BrowserApiClient, BrowserApiJsonResult } from "@/lib/browser-api-client";
import type { PlanningHeaderData } from "@/lib/types";
import { usePlanningHeaderData } from "./use-planning-header-data";
import { getProtectedPlanningShellStateCache, setProtectedPlanningShellStateCache } from "./use-planning-auth";

const initialHeader: PlanningHeaderData = {
  ...emptyPlanningHeaderData,
  quickLinks: readyHeaderSlot([]),
  calendarEvents: readyHeaderSlot([]),
};
type HeaderResponse = BrowserApiJsonResult<{ headerData: PlanningHeaderData }>;

function BackgroundHeaderStory() {
  const [signedIn, setSignedIn] = useState(true);
  const [baseHeaderData, setHeaderData] = useState(initialHeader);
  const [requestCount, setRequestCount] = useState(0);
  const requests = useRef<((response: HeaderResponse) => void)[]>([]);
  useEffect(() => {
    setProtectedPlanningShellStateCache({ authUserId: "story-user", data: emptyPlanningShellState, headerData: initialHeader, currentProfile: null });
    return () => setProtectedPlanningShellStateCache(null);
  }, []);
  const [apiClient] = useState<BrowserApiClient>(() => ({
    requestJson: <T,>() => new Promise<BrowserApiJsonResult<T>>((resolve) => {
      requests.current.push((response) => resolve(response as BrowserApiJsonResult<T>));
      setRequestCount(requests.current.length);
    }),
    requestBlob: async () => { throw new Error("Unexpected blob request"); },
    requestForm: async () => { throw new Error("Unexpected form request"); },
  }));
  const headerData = usePlanningHeaderData({
    apiClient, authRequired: true,
    authUser: signedIn ? { id: "story-user" } as User : null,
    baseHeaderData, currentProfileId: "story-profile", data: emptyPlanningShellState,
    protectedDataLoaded: signedIn, serverCurrentProfile: null, setHeaderData, workspace: "planning",
  });
  function respond(failed: boolean) {
    requests.current.at(-1)?.({
      response: new Response(null, { status: failed ? 503 : 200 }),
      body: failed ? null : { headerData: {
        ...emptyPlanningHeaderData,
        notifications: readyHeaderSlot({ unreadCount: requestCount, items: [] }),
      } },
    });
  }
  return (
    <main>
      <h1>Planning Board</h1>
      <p>Requests: {requestCount}</p>
      <p>Unread: {headerData.notifications.data.unreadCount}</p>
      <button onClick={() => document.dispatchEvent(new Event("visibilitychange"))}>Return to tab</button>
      <button onClick={() => respond(false)}>Complete request</button>
      <button onClick={() => respond(true)}>Fail request</button>
      <button onClick={() => { setProtectedPlanningShellStateCache(null); setSignedIn(false); setHeaderData(initialHeader); }}>Sign out</button>
      <button onClick={() => setProtectedPlanningShellStateCache(null)}>Clear session cache</button>
      <button onClick={() => setProtectedPlanningShellStateCache({
        authUserId: "story-user", currentProfile: null, headerData: initialHeader,
        data: { ...emptyPlanningShellState, project: { ...emptyPlanningShellState.project, name: "New board" } },
      })}>Update board cache</button>
      {signedIn ? <NotificationInbox notifications={headerData.notifications} open onToggle={() => {}} /> : <p>Signed out</p>}
    </main>
  );
}

const meta = {
  component: BackgroundHeaderStory,
  title: "Planning/Hooks/BackgroundHeader",
  tags: ["status:stable"],
} satisfies Meta<typeof BackgroundHeaderStory>;
export default meta;
type Story = StoryObj<typeof meta>;

export const InitialFetchOwnsNotifications: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { name: "Planning Board" })).toBeVisible();
    await waitFor(() => expect(canvas.getByText("Requests: 1")).toBeVisible());
    await expect(canvas.getByRole("button", { name: "Benachrichtigungen werden geladen" })).toHaveAttribute("aria-busy", "true");
    await userEvent.click(canvas.getByRole("button", { name: "Return to tab" }));
    await expect(canvas.getByText("Requests: 1")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Complete request" }));
    await waitFor(() => expect(canvas.getByText("Unread: 1")).toBeVisible());
    await expect(canvas.getByRole("button", { name: "Benachrichtigungen" })).toHaveAttribute("aria-busy", "false");
    await userEvent.click(canvas.getByRole("button", { name: "Return to tab" }));
    await waitFor(() => expect(canvas.getByText("Requests: 2")).toBeVisible());
    await userEvent.click(canvas.getByRole("button", { name: "Return to tab" }));
    await expect(canvas.getByText("Requests: 2")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Fail request" }));
    await expect(canvas.getByText("Unread: 1")).toBeVisible();
  },
};

export const SignOutDiscardsInitialResponse: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByText("Requests: 1")).toBeVisible());
    await userEvent.click(canvas.getByRole("button", { name: "Sign out" }));
    await userEvent.click(canvas.getByRole("button", { name: "Complete request" }));
    await expect(canvas.getByText("Signed out")).toBeVisible();
    await expect(canvas.getByText("Unread: 0")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Return to tab" }));
    await expect(canvas.getByText("Requests: 1")).toBeVisible();
  },
};

export const InitialFailureRecoversOnReturn: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByText("Requests: 1")).toBeVisible());
    await userEvent.click(canvas.getByRole("button", { name: "Fail request" }));
    await waitFor(() => expect(canvas.getByText("Headerdaten konnten nicht geladen werden.")).toBeVisible());
    await userEvent.click(canvas.getByRole("button", { name: "Return to tab" }));
    await waitFor(() => expect(canvas.getByText("Requests: 2")).toBeVisible());
    await userEvent.click(canvas.getByRole("button", { name: "Complete request" }));
    await waitFor(() => expect(canvas.getByText("Unread: 2")).toBeVisible());
    await expect(canvas.queryByText("Headerdaten konnten nicht geladen werden.")).not.toBeInTheDocument();
  },
};

export const CompletionDoesNotRestoreClearedCache: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByText("Requests: 1")).toBeVisible());
    await userEvent.click(canvas.getByRole("button", { name: "Clear session cache" }));
    await userEvent.click(canvas.getByRole("button", { name: "Complete request" }));
    await waitFor(() => expect(canvas.getByText("Unread: 1")).toBeVisible());
    await expect(getProtectedPlanningShellStateCache()).toBeNull();
  },
};

export const CompletionPreservesNewerBoardCache: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByText("Requests: 1")).toBeVisible());
    await userEvent.click(canvas.getByRole("button", { name: "Update board cache" }));
    await userEvent.click(canvas.getByRole("button", { name: "Complete request" }));
    await waitFor(() => expect(canvas.getByText("Unread: 1")).toBeVisible());
    await expect(getProtectedPlanningShellStateCache()?.data.project.name).toBe("New board");
    await expect(getProtectedPlanningShellStateCache()?.headerData.notifications.data.unreadCount).toBe(1);
  },
};

export const SignOutDiscardsPollResponse: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await waitFor(() => expect(canvas.getByText("Requests: 1")).toBeVisible());
    await userEvent.click(canvas.getByRole("button", { name: "Complete request" }));
    await waitFor(() => expect(canvas.getByText("Unread: 1")).toBeVisible());
    await userEvent.click(canvas.getByRole("button", { name: "Return to tab" }));
    await waitFor(() => expect(canvas.getByText("Requests: 2")).toBeVisible());
    await userEvent.click(canvas.getByRole("button", { name: "Sign out" }));
    await userEvent.click(canvas.getByRole("button", { name: "Complete request" }));
    await expect(canvas.getByText("Unread: 0")).toBeVisible();
    await expect(getProtectedPlanningShellStateCache()).toBeNull();
  },
};
