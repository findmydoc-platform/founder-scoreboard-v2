import type { User } from "@supabase/supabase-js";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { getRouter, usePathname } from "@storybook/nextjs-vite/navigation.mock";
import { useEffect, useRef, useState } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { PlanningApp } from "./PlanningApp";
import { PlanningStateProvider } from "./organisms/planning-state-provider";
import { emptyPlanningShellState } from "./model/planning-shell-state";
import { emptyPlanningHeaderData, readyHeaderSlot } from "@/lib/planning-header-data";
import { taskDetailStoryTask } from "@/features/tasks/molecules/task-detail-story-fixtures";
import type { Profile } from "@/lib/types";
import { productUpdates } from "@/features/product-updates/model/product-update-registry";
import { mockAccountLifecycle } from "../../../tests/helpers/account-lifecycle-browser-fixture";
import { planningWorkspaceHydration } from "./model/planning-workspace-hydration";
import { createBrowserSessionAdapter } from "@/lib/credentials/browser";

const profile: Profile = { id: "entry-profile", name: "Entry Person", platformRole: "ceo", orgRole: "CEO", githubLogin: "entry-person", weeklyCapacity: 40 };
const user = { id: "entry-user", email: "entry@example.com" } as User;
const session = { user, userId: user.id, revision: "entry-session", expiresAt: Math.floor(Date.now() / 1000) + 3600 };
const task = taskDetailStoryTask({ id: "entry-task", title: "Planning entry task", updatedAt: "entry-r1", assigneeId: profile.id, ownerId: profile.id });
const headerData = { ...emptyPlanningHeaderData, quickLinks: readyHeaderSlot([]), calendarEvents: readyHeaderSlot([]) };
const model = { revision: "entry-r1", scopeRevision: "scope-r1", project: emptyPlanningShellState.project, items: [task], people: [profile], sprints: [], relationships: [], preferences: [], coverage: { items: "complete", people: "complete", strategies: "complete", raci: "complete", links: "complete", sprints: "complete", relationships: "complete", preferences: "complete" } } as const;

function PlanningEntryFlow({ startInEvents = false, backgroundFailure = false, changedPageOnReturn = false, revisionChanged = false, rotationRecovery = false }: { startInEvents?: boolean; backgroundFailure?: boolean; changedPageOnReturn?: boolean; revisionChanged?: boolean; rotationRecovery?: boolean }) {
  const navigationCalls = useRef(0);
  const [workspace, setWorkspace] = useState<"planning" | "events">(startInEvents ? "events" : "planning");
  const [reads, setReads] = useState(0);
  const [revisions, setRevisions] = useState(0);
  const [pages, setPages] = useState(1);
  const [finished, setFinished] = useState(0);
  const finishRead = useRef<() => void>(() => {});
  const [ready, setReady] = useState(false);
  const currentSession = useRef(session);
  const [eventReads, setEventReads] = useState(0);
  const [eventCredential, setEventCredential] = useState("");
  useEffect(() => {
    const seenKey = `founderops.product-updates.seen.${profile.id}`;
    const previousSeen = localStorage.getItem(seenKey);
    localStorage.setItem(seenKey, JSON.stringify(productUpdates.map(update => update.id)));
    let boardRequests = 0;
    const restore = mockAccountLifecycle("google", { linked: true }, (input) => {
      const path = String(input).split("?")[0];
      if (path === "/api/auth/session") return Response.json({ session: currentSession.current });
      if (path === "/api/planning-board-data") {
        setReads(count => count + 1);
        if (rotationRecovery && ++boardRequests === 1) return new Promise<Response>(resolve => {
          finishRead.current = () => { resolve(Response.json({ model: { ...model, items: [{ ...task, title: "Late old-session task" }] }, currentProfile: profile })); setFinished(count => count + 1); };
        });
        if (backgroundFailure || changedPageOnReturn) return new Promise<Response>(resolve => {
          finishRead.current = () => {
            resolve(backgroundFailure ? Response.json({ error: "Board temporarily unavailable" }, { status: 503 }) : Response.json({ model, currentProfile: profile }));
            setFinished(count => count + 1);
          };
        });
        return Response.json({ model, currentProfile: profile });
      }
      if (path === "/api/planning-source-version") { setRevisions(count => count + 1); return Response.json({ version: revisionChanged ? "scope-r2" : "scope-r1" }); }
      if (path === "/api/planning-revision") { setRevisions(count => count + 1); return Response.json({ revision: { activeTaskCount: 1, latestUpdatedAt: task.updatedAt, scopeRevision: revisionChanged ? "scope-r2" : "scope-r1" } }); }
      if (path === "/api/events-data") {
        setEventReads(count => count + 1);
        setEventCredential(currentSession.current.revision);
        return Response.json({ model: { revision: "events", people: [profile], events: rotationRecovery ? [{ id: 1, title: "Current-session event", category: "other", startsAt: "2099-01-10T10:00:00.000Z", endsAt: "", location: "", description: "", audienceMode: "all", participantProfileIds: [], reminderDaysBefore: 7, reminderGeneratedAt: "", status: "planned", createdBy: profile.id, createdAt: "r1", updatedAt: "r1" }] : [], coverage: { range: null, completeness: "complete" } } });
      }
      if (path === "/api/github-app/status") return Response.json({ installation: { available: false }, user: { connected: false } });
      if (path === "/api/administrator-access") return Response.json({ administratorAccess: { eligible: false, active: false, expiresAt: null } });
      if (path === "/api/team/platform-releases/v1/releases") return Response.json({ releases: [] });
      return Response.json({ error: "Optional header unavailable" }, { status: 503 });
    });
    const push = getRouter().push;
    usePathname.mockReturnValue(startInEvents ? "/events" : "/planning");
    push.mockImplementation((href: string) => {
      if (href === "/planning" || href === "/events") {
        usePathname.mockReturnValue(href);
        setWorkspace(href === "/planning" ? "planning" : "events");
        setPages(count => count + 1);
      }
    });
    queueMicrotask(() => setReady(true));
    return () => {
      restore();
      push.mockReset();
      if (previousSeen === null) localStorage.removeItem(seenKey); else localStorage.setItem(seenKey, previousSeen);
    };
  }, [startInEvents, backgroundFailure, changedPageOnReturn, revisionChanged, rotationRecovery]);
  const pageModel = changedPageOnReturn && pages > 1 ? { ...model, revision: "entry-r2", scopeRevision: "scope-r2", items: [{ ...task, title: "New page task", updatedAt: "entry-r2" }] } : model;
  return <div onClickCapture={() => { navigationCalls.current = getRouter().push.mock.calls.length; }} onClick={event => {
    const link = (event.target as Element).closest<HTMLAnchorElement>("a[href]");
    if (getRouter().push.mock.calls.length === navigationCalls.current && link && ["/planning", "/events"].includes(link.getAttribute("href") || "")) {
      event.preventDefault();
      getRouter().push(link.getAttribute("href")!);
    }
  }}>
    <output aria-label="Complete Board API reads">{reads}</output>
    <output aria-label="Page results">{pages}</output>
    <output aria-label="Revision checks">{revisions}</output>
    <output aria-label="Finished Board responses">{finished}</output>
    <output aria-label="Events API reads">{eventReads}</output>
    <output aria-label="Events session revision">{eventCredential}</output>
    <button onClick={() => { currentSession.current = { ...session, revision: "entry-rotated" }; void createBrowserSessionAdapter().refresh(); }}>Rotate same-user session</button>
    <button onClick={() => finishRead.current()}>Finish background Board response</button>
    {ready ? <PlanningStateProvider><PlanningApp key={workspace}
      initialWorkspace={workspace}
      initialWorkspaceRead={workspace === "planning" ? planningWorkspaceHydration("planning", pageModel, session) : undefined}
      initialData={{ ...emptyPlanningShellState, profiles: [profile], tasks: workspace === "planning" ? [...pageModel.items] : [] }}
      initialHeaderData={headerData} initialAuthUser={user} initialCurrentProfile={profile}
      initialProtectedDataLoaded authRequired source="supabase"
    /></PlanningStateProvider> : null}
  </div>;
}

const meta = { title: "Planning/Entry flow", component: PlanningEntryFlow, parameters: { layout: "fullscreen", nextjs: { appDirectory: true, navigation: { pathname: "/planning" } } } } satisfies Meta<typeof PlanningEntryFlow>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ReturnReusesSufficientPageResult: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText(task.title)).toBeVisible();
    await expect(canvas.getByLabelText("Complete Board API reads")).toHaveTextContent("0");
    await userEvent.click(canvas.getByRole("link", { name: "Termine & Erinnerungen" }));
    await expect(await canvas.findByRole("heading", { name: "Termine & Erinnerungen", level: 1 })).toBeVisible();
    await userEvent.click(canvas.getByRole("link", { name: "Planung" }));
    await expect(await canvas.findByText(task.title)).toBeVisible();
    await waitFor(() => expect(canvas.getByLabelText("Page results")).toHaveTextContent("3"));
    await expect(canvas.getByLabelText("Complete Board API reads")).toHaveTextContent("0");
  },
};

export const FirstPlanningEntryAcceptsItsPageResult: Story = {
  args: { startInEvents: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole("heading", { name: "Termine & Erinnerungen", level: 1 })).toBeVisible();
    await userEvent.click(canvas.getByRole("link", { name: "Planung" }));
    await expect(await canvas.findByText(task.title)).toBeVisible();
    await expect(canvas.getByLabelText("Complete Board API reads")).toHaveTextContent("0");
  },
};

export const FailedBackgroundReadKeepsBoardUsable: Story = {
  args: { backgroundFailure: true, revisionChanged: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText(task.title)).toBeVisible();
    await userEvent.click(await canvas.findByRole("button", { name: "Aktualisieren" }));
    await waitFor(() => expect(canvas.getByLabelText("Complete Board API reads")).toHaveTextContent("1"));
    await expect(canvas.getByText(task.title)).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Finish background Board response" }));
    await waitFor(() => expect(canvas.getByLabelText("Finished Board responses")).toHaveTextContent("1"));
    await expect(canvas.getByText(task.title)).toBeVisible();
    await expect(await canvas.findByRole("button", { name: "Aktualisieren" }, { timeout: 3000 })).toBeEnabled();
  },
};

export const NewPageRejectsOlderBackgroundResult: Story = {
  args: { changedPageOnReturn: true, revisionChanged: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Aktualisieren" }));
    await waitFor(() => expect(canvas.getByLabelText("Complete Board API reads")).toHaveTextContent("1"));
    await userEvent.click(canvas.getByRole("link", { name: "Termine & Erinnerungen" }));
    await expect(await canvas.findByRole("heading", { name: "Termine & Erinnerungen", level: 1 })).toBeVisible();
    await userEvent.click(canvas.getByRole("link", { name: "Planung" }));
    await expect(await canvas.findByText("New page task")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Finish background Board response" }));
    await waitFor(() => expect(canvas.getByLabelText("Finished Board responses")).toHaveTextContent("1"));
    await expect(canvas.getByText("New page task")).toBeVisible();
    await expect(canvas.getByLabelText("Complete Board API reads")).toHaveTextContent("1");
  },
};

export const TokenRotationThenVisibleEventsNavigationRecoversOnce: Story = {
  args: { rotationRecovery: true, revisionChanged: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText(task.title)).toBeVisible();
    await userEvent.click(await canvas.findByRole("button", { name: "Aktualisieren" }));
    await waitFor(() => expect(canvas.getByLabelText("Complete Board API reads")).toHaveTextContent("1"));
    await userEvent.click(canvas.getByRole("button", { name: "Rotate same-user session" }));
    await waitFor(() => expect(canvas.getByLabelText("Complete Board API reads")).toHaveTextContent("2"));
    await expect(await canvas.findByText(task.title)).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Finish background Board response" }));
    await expect(canvas.queryByText("Late old-session task")).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("link", { name: "Termine & Erinnerungen" }));
    await expect(await canvas.findByText("Current-session event")).toBeVisible();
    await expect(canvas.getByLabelText("Events API reads")).toHaveTextContent("1");
    await expect(canvas.getByLabelText("Events session revision")).toHaveTextContent("entry-rotated");
    await expect(canvas.queryByText("Late old-session task")).not.toBeInTheDocument();
  },
};
