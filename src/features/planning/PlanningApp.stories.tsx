import type { User } from "@supabase/supabase-js";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { getRouter } from "@storybook/nextjs-vite/navigation.mock";
import { useEffect, useState, type ComponentProps } from "react";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { PlanningApp } from "./PlanningApp";
import { emptyPlanningShellState } from "./model/planning-shell-state";
import { emptyPlanningHeaderData, readyHeaderSlot } from "@/lib/planning-header-data";
import type { FmdTool, FounderEvent, NotificationEvent, Profile, Sprint } from "@/lib/types";
import { taskDetailStoryTask } from "@/features/tasks/molecules/task-detail-story-fixtures";
import { DEFAULT_SPRINT_TASK_FILTERS } from "@/features/sprint/model/sprint-task-table-view-model";
import type { SprintScopedPage } from "@/features/sprint/model/sprint-scoped-read";
import type { SprintWorkspaceModel } from "@/features/sprint/model/sprint-read-model";
import { mockAccountLifecycle } from "../../../tests/helpers/account-lifecycle-browser-fixture";
import { productUpdates } from "@/features/product-updates/model/product-update-registry";
import type { NotionDecisionLogResult } from "@/lib/notion-decision-log";
import { inactiveAdministratorAccess, sessionAuthority } from "@/features/administrator-access/model/administrator-access";
import { administrationStoryModel } from "@/features/administration/organisms/administration-workspace.stories";
import { PlanningStateProvider } from "./organisms/planning-state-provider";
import { workspaceRoutes } from "./model/workspace-routes";
import { expectApplicationHeader } from "../../../tests/helpers/application-header-browser-contract";

const profile: Profile = { id: "workspace-member", name: "Mara Beispiel", platformRole: "ceo", orgRole: "CEO", githubLogin: "workspace-member", weeklyCapacity: 40, color: "#2563eb" };
const user = { id: "workspace-user", email: "mara@example.com" } as User;
const headerData = { ...emptyPlanningHeaderData, quickLinks: readyHeaderSlot([]), calendarEvents: readyHeaderSlot([]), notifications: readyHeaderSlot({ unreadCount: 0, items: [] }) };
const event: FounderEvent = { id: 1, title: "Teamtermin", category: "other", startsAt: "2099-01-10T10:00:00.000Z", endsAt: "", location: "", description: "", audienceMode: "all", participantProfileIds: [], reminderDaysBefore: 7, reminderGeneratedAt: "", status: "planned", createdBy: profile.id, createdAt: "r1", updatedAt: "r1" };
const sprints: Sprint[] = [
  { id: "workspace-sprint-1", name: "Sprint 1", startDate: "2099-01-01", endDate: "2099-01-14", reviewDueAt: "", scoreLocked: false, status: "planning", updatedAt: "r1" },
  { id: "workspace-sprint-2", name: "Sprint 2", startDate: "2099-01-15", endDate: "2099-01-28", reviewDueAt: "", scoreLocked: false, status: "planning", updatedAt: "r1" },
];
const sprintTask = taskDetailStoryTask({ id: "workspace-task", title: "Sprint-Aufgabe", sprintId: sprints[0].id });
const assignmentTask = taskDetailStoryTask({ id: "workspace-offpage-assignment", title: "Später Zuweisungskandidat", sprintId: sprints[1].id });
let assignmentRequests = 0;
let projectedSprintRequests = 0;
let fullSprintRequests = 0;
let jointSprintRequests = 0;
let projectionGate = Promise.withResolvers<void>();
let releaseAssignment = () => {};
const sprintFixtureTime = Date.now();
const sprintFixtureAuthority = { userId: user.id, deadline: sprintFixtureTime + 240_000 };
const sprintFixtureActor = { profileId: profile.id, platformRole: profile.platformRole };
const sprintStorySession = { user, userId: user.id, revision: "workspace-session", expiresAt: Math.floor(sprintFixtureTime / 1000) + 3600 };
const scopedSprintPage = (sprintId: string, items = [sprintTask]): SprintScopedPage => ({ scope: "selected", sprintId, items, context: [], matchedTotal: items.length,
  scopeTotal: items.length, continuation: null, sourceRevision: "sprint-story-source", evaluatedAt: new Date(sprintFixtureTime - 1).toISOString(),
  validUntil: new Date(sprintFixtureTime + 240_000).toISOString(), unassignedTotal: 0, sprintTaskCounts: { [sprints[0].id]: 1, [sprints[1].id]: 1 }, assignmentTargetsByItemId: {} });
let selectedSprintGate = Promise.withResolvers<void>();
const sprintModel: SprintWorkspaceModel = { revision: "sprint-story-source", project: emptyPlanningShellState.project, people: [profile], items: [sprintTask], sprints, commitments: [], scores: [], strikeStates: [], strikeEvents: [], objections: [], meetings: [], attendance: [] };
const tool: FmdTool = { id: "workspace-tool", name: "Teamhandbuch", category: "tool", kind: "Werkzeuge", description: "Gemeinsame Dokumentation", url: "https://example.com/handbook", owner: "Team", status: "active", isCurated: false, previewImageUrl: "", previewImageSource: "none", sortOrder: 10, updatedAt: "r1" };
const pendingNotification: NotificationEvent = { id: 1, type: "sprint_update", actorProfileId: profile.id, actorLabel: profile.name, recipientProfileId: profile.id, entityType: "sprint", entityId: sprints[0].id, title: "Offener Hinweis", body: "Bitte prüfe den Sprint.", targetPath: "/sprint", status: "pending", seenAt: "", dismissedAt: "", resolvedAt: "", resolutionReason: "", createdAt: "2099-01-01T10:00:00Z" };
const doneNotification: NotificationEvent = { ...pendingNotification, id: 2, title: "Abgeschlossener Hinweis", status: "dismissed", dismissedAt: "2099-01-02T10:00:00Z" };
const decisionLog: NotionDecisionLogResult = { ok: true, fetchedAt: "2099-01-01T10:00:00Z", entries: [] };
const administratorProfile = { ...profile, platformRole: "founder" as const };
const activeAdministratorAccess = { eligible: true, active: true, expiresAt: new Date(Date.now() + 30 * 60_000).toISOString() };

function WorkspaceNavigation(props: ComponentProps<typeof PlanningApp>) {
  const [workspace, setWorkspace] = useState(props.initialWorkspace);
  useEffect(() => {
    const push = getRouter().push;
    push.mockImplementation((href: string) => {
      const route = workspaceRoutes.find(route => route.href === href);
      if (route) setWorkspace(route.id);
    });
    return () => { push.mockReset(); };
  }, []);
  return <PlanningApp key={workspace} {...props} initialWorkspace={workspace} />;
}

const meta = {
  title: "Planning/Application workspaces",
  component: PlanningApp,
  decorators: [Story => <PlanningStateProvider><Story /></PlanningStateProvider>],
  parameters: { layout: "fullscreen", nextjs: { appDirectory: true, navigation: { pathname: "/events" } } },
  args: {
    initialData: { ...emptyPlanningShellState, profiles: [profile], events: [event] },
    initialHeaderData: headerData,
    initialWorkspace: "events",
    source: "supabase",
    authRequired: true,
    initialAuthUser: user,
    initialCurrentProfile: profile,
    initialProtectedDataLoaded: true,
  },
  beforeEach: ({ args }) => {
    assignmentRequests = 0;
    projectedSprintRequests = 0;
    fullSprintRequests = 0;
    jointSprintRequests = 0;
    projectionGate = Promise.withResolvers<void>();
    releaseAssignment = () => {};
    selectedSprintGate = Promise.withResolvers<void>();
    const access = args.initialAdministratorAccess || inactiveAdministratorAccess;
    const capabilities = sessionAuthority({ platformRole: args.initialCurrentProfile?.platformRole || "viewer", credentialKind: "session", administratorAccess: access }).capabilities;
    const seenKey = `founderops.product-updates.seen.${profile.id}`;
    const previousSeen = localStorage.getItem(seenKey);
    localStorage.setItem(seenKey, JSON.stringify(productUpdates.map(update => update.id)));
    const notificationReceiptTime = Date.now();
    const restore = mockAccountLifecycle("google", { linked: true, workspaceEmail: "mara@example.com" }, (input, init) => {
    const url = new URL(String(input), window.location.origin), path = url.pathname;
    if (path === "/api/auth/session") return Response.json({ session: sprintStorySession });
    if (path === "/api/administrator-access") return init?.method && init.method !== "GET" ? Response.json({ error: "This fixture does not activate administrator access" }, { status: 403 }) : Response.json({ administratorAccess: access });
    if (path === "/api/administration-data") return capabilities.manageAdministratorEligibility ? Response.json({ administration: { ...administrationStoryModel, capabilities, people: [], notificationEvents: [], notificationDeliveries: [] } }) : Response.json({ error: "Kein Zugriff", code: "administrator_access_required" }, { status: 403 });
    if (path === "/api/planning-header-data") return Response.json({ headerData, readAuthority: { userId: user.id, deadline: Date.now() + 60_000 } });
    if (path === "/api/team/platform-releases/v1/releases") return Response.json({ releases: [] });
    if (path === "/api/github-app/status") return Response.json({ installation: { available: false }, user: { connected: false } });
    if (path === "/api/events-data") return Response.json({ model: { revision: "events", events: [event], people: [profile], coverage: { completeness: "complete" } } });
    if (path === "/api/events" && init?.method === "POST") return Response.json({ event: { ...event, ...JSON.parse(String(init.body)), id: 2, updatedAt: "r2" } });
    if (path === "/api/tools/metadata") return Response.json({ metadata: { title: "", description: "", imageUrl: "", siteName: "" } });
    if (path === "/api/tools" && init?.method === "POST") return Response.json({ tool: { ...tool, ...JSON.parse(String(init.body)), id: "created-tool", updatedAt: "r2" } });
    if (path === "/api/notifications-data") {
      const area = url.searchParams.get("area"), events = args.initialData.notificationEvents;
      const receipt = { readAuthority: { userId: user.id, deadline: notificationReceiptTime + 60_000 }, readActor: { profileId: args.initialCurrentProfile?.id, platformRole: args.initialCurrentProfile?.platformRole }, sourceRevision: "notification-story", observedAt: new Date(notificationReceiptTime - 1).toISOString(), validUntil: new Date(notificationReceiptTime + 60_000).toISOString() };
      if (area === "preview") return Response.json({ ...receipt, items: events.filter(row => row.status === "pending" && !row.seenAt) });
      if (area === "count") return Response.json({ ...receipt, unreadCount: events.filter(row => row.status === "pending" && !row.seenAt).length });
      if (area === "inbox") { const offset = url.searchParams.has("continuation") ? 40 : 0, page = events.slice(offset, offset + 40), more = events.length > offset + page.length; return Response.json({ ...receipt, events: page, coverage: more ? "partial" : "complete", continuation: more ? "next-page" : null, references: [], referenceCoverage: "complete" }); }
      return Response.json({ headerData: { ...headerData, quickLinks: readyHeaderSlot([{ id: "guide", name: "Aktueller Teamleitfaden", category: "knowledge", url: "https://example.com/guide", previewImageUrl: "" }]) }, model: { revision: "notifications", people: args.initialData.profiles, items: [], events, deliveries: [], coverage: { events: "complete", deliveries: "forbidden" } } });
    }
    if (path === "/api/decision-log") return Response.json({ result: { ...decisionLog, fetchedAt: "2099-01-02T10:00:00Z" } });
    if (path === "/api/profile-data") return Response.json({ model: { revision: "profile", people: args.initialData.profiles, project: args.initialData.project, initiatives: [], notificationPreferences: [], preferences: [] } });
    if (path === "/api/sprint-data" && url.searchParams.get("scope") === "selected") {
      const selected = url.searchParams.get("sprintId");
      if (url.searchParams.get("projection") === "matches") {
        projectedSprintRequests += 1;
        if (url.searchParams.get("basis") !== "document-selected-basis") return Response.json({ error: "Unexpected selected basis" }, { status: 400 });
        const { evaluatedAt, validUntil, sourceRevision } = scopedSprintPage(sprints[0].id);
        return projectionGate.promise.then(() => Response.json({ projection: "matches", sprintId: sprints[0].id,
          matchedIds: [], matchedTotal: 0, scopeTotal: 1, sourceRevision, evaluatedAt, validUntil,
          readActor: sprintFixtureActor, readAuthority: sprintFixtureAuthority }));
      }
      fullSprintRequests += 1;
      const id = selected === sprints[1].id ? sprints[1].id : sprints[0].id;
      const item = selected === sprints[1].id ? assignmentTask : sprintTask;
      const result = () => Response.json({ model: { ...sprintModel, items: [item], coverage: { sprints: "complete", items: "partial" } },
        page: scopedSprintPage(id, [item]), readActor: sprintFixtureActor, readAuthority: sprintFixtureAuthority });
      if (selected === sprints[1].id) return selectedSprintGate.promise.then(result);
      return result();
    }
    if (path === "/api/sprint-data" && url.searchParams.get("scope") === "assignment") {
      assignmentRequests += 1;
      const joint = url.searchParams.get("selectedBasis") === "document-selected-basis";
      if (joint) jointSprintRequests += 1;
      const page = scopedSprintPage(sprints[0].id);
      return new Promise<Response>(resolve => { releaseAssignment = () => resolve(Response.json({
        ...(joint ? { selected: { status: "ready", read: { projection: "matches", sprintId: page.sprintId, matchedIds: [],
          matchedTotal: 0, scopeTotal: 1, sourceRevision: page.sourceRevision, evaluatedAt: page.evaluatedAt, validUntil: page.validUntil,
          readActor: sprintFixtureActor, readAuthority: sprintFixtureAuthority } } } : {}),
        page: { scope: "assignment", sprintId: sprints[0].id, items: [assignmentTask], context: [], matchedTotal: 1, scopeTotal: 1, continuation: null,
          unassignedTotal: null, sprintTaskCounts: null, assignmentTargetsByItemId: { [assignmentTask.id]: [sprints[0].id] },
          sourceRevision: "sprint-story-source", evaluatedAt: joint ? page.evaluatedAt : new Date(notificationReceiptTime - 1).toISOString(), validUntil: joint ? page.validUntil : new Date(notificationReceiptTime + 60_000).toISOString() },
        readActor: { profileId: profile.id, platformRole: profile.platformRole }, readAuthority: joint ? sprintFixtureAuthority : { userId: user.id, deadline: notificationReceiptTime + 60_000 },
      })); });
    }
    if (path === "/api/backlog-data") return Response.json({ model: { revision: "backlog", people: args.initialData.profiles, items: args.initialData.tasks, sprints: args.initialData.sprints, commitments: [] } });
    return Response.json({ error: "Not provided by this workspace fixture" }, { status: 503 });
    });
    return () => {
      restore();
      if (previousSeen === null) localStorage.removeItem(seenKey);
      else localStorage.setItem(seenKey, previousSeen);
    };
  },
} satisfies Meta<typeof PlanningApp>;
export default meta;
type Story = StoryObj<typeof meta>;

export const EventCreationFromContext: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expectApplicationHeader(canvasElement, "Termine & Erinnerungen");
    await expect(await canvas.findByRole("heading", { name: "Termine & Erinnerungen", level: 1 })).toBeVisible();
    await expect(await canvas.findByRole("heading", { name: "Teamtermin" }, { timeout: 5_000 })).toBeVisible();
    const context = within(await canvas.findByLabelText("Bereichskontext"));
    await userEvent.click(await context.findByRole("button", { name: "Event eintragen" }));
    await userEvent.type(canvas.getByRole("textbox", { name: "Titel" }), "Planungsrunde");
    await userEvent.click(canvas.getByRole("button", { name: "Event erstellen" }));
    await expect(await canvas.findByRole("heading", { name: "Planungsrunde" })).toBeVisible();
    await expect(canvas.queryByRole("textbox", { name: "Titel" })).not.toBeInTheDocument();
  },
};

export const SprintSelectionUpdatesWorkspace: Story = {
  args: { initialWorkspace: "sprint", initialData: { ...emptyPlanningShellState, profiles: [profile], sprints, tasks: [sprintTask] }, initialSprintModel: sprintModel },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expectApplicationHeader(canvasElement, "Sprint & Score");
    await expect(await canvas.findByLabelText("1 verknüpfte Aufgaben, Zeitraum geschützt", {}, { timeout: 5_000 })).toBeVisible();
    const context = within(await canvas.findByLabelText("Bereichskontext"));
    const selection = await context.findByRole("combobox", { name: "Sprint" });
    await userEvent.click(selection);
    await userEvent.click(within(document.body).getByRole("option", { name: "Sprint 2" }));
    await waitFor(() => expect(context.getAllByRole("combobox", { name: "Sprint" })).toHaveLength(1));
    await expect(context.getByRole("combobox", { name: "Sprint" })).toHaveTextContent("Sprint 2");
    await expect(canvas.getByText("15. Jan. - 28. Jan.")).toBeVisible();
    await expect(canvas.queryByLabelText("1 verknüpfte Aufgaben, Zeitraum geschützt")).not.toBeInTheDocument();
    await expect(context.queryByRole("combobox", { name: "Status" })).not.toBeInTheDocument();
  },
};

export const SprintTasksRevealBeforeAssignmentDiscovery: Story = {
  args: { initialWorkspace: "sprint", initialData: { ...emptyPlanningShellState, profiles: [profile], sprints, tasks: [sprintTask] }, initialSprintModel: sprintModel },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole("link", { name: "Sprint-Aufgabe" })).toBeVisible();
    await expect(assignmentRequests).toBe(0);
    await userEvent.click(await canvas.findByRole("button", { name: "Backlog und andere Sprints laden" }));
    await expect(await canvas.findByText("Zuweisungskandidaten werden geladen.")).toBeVisible();
    await expect(canvas.getByRole("link", { name: "Sprint-Aufgabe" })).toBeVisible();
    await expect(assignmentRequests).toBe(1);
    releaseAssignment();
    await expect(await canvas.findByRole("link", { name: "Später Zuweisungskandidat" })).toBeVisible();
    await expect(canvas.getByRole("link", { name: "Sprint-Aufgabe" })).toBeVisible();
  },
};

export const SprintSelectionDoesNotPresentOldMembershipAsEmpty: Story = {
  args: {
    initialWorkspace: "sprint", initialData: { ...emptyPlanningShellState, profiles: [profile], sprints, tasks: [sprintTask] }, initialSprintModel: sprintModel,
    initialWorkspaceRead: {
      workspace: "sprint", queryKey: "workspace", revision: sprintModel.revision, scopeRevision: "sprint-story-source",
      session: sprintStorySession, readAuthority: sprintFixtureAuthority, coverage: { sprints: "complete", tasks: "partial" }, taskOmittedFields: [],
      sprintScope: { query: { scope: "selected", sprintId: sprints[0].id, filters: DEFAULT_SPRINT_TASK_FILTERS, continuation: null },
        page: scopedSprintPage(sprints[0].id), readActor: sprintFixtureActor },
    },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole("link", { name: "Sprint-Aufgabe" })).toBeVisible();
    const selector = within(await canvas.findByLabelText("Bereichskontext")).getByRole("combobox", { name: "Sprint" });
    await userEvent.click(selector);
    await userEvent.click(within(document.body).getByRole("option", { name: /^Sprint 2/ }));
    await expect(await canvas.findByText("Sprint-Aufgaben werden geladen.")).toBeVisible();
    await expect(canvas.queryByRole("link", { name: "Sprint-Aufgabe" })).not.toBeInTheDocument();
    await expect(canvas.queryByText("Noch keine Aufgaben in diesem Sprint.")).not.toBeInTheDocument();
    selectedSprintGate.resolve();
    await expect(await canvas.findByRole("link", { name: "Später Zuweisungskandidat" })).toBeVisible();
    await expect(assignmentRequests).toBe(0);
  },
};

const sprintSearchArgs = {
  initialWorkspace: "sprint" as const, initialData: { ...emptyPlanningShellState, profiles: [profile], sprints, tasks: [sprintTask] }, initialSprintModel: sprintModel,
  initialWorkspaceRead: {
    workspace: "sprint", queryKey: "workspace", revision: sprintModel.revision, scopeRevision: "sprint-story-source",
    session: sprintStorySession, readAuthority: sprintFixtureAuthority, coverage: { sprints: "complete", tasks: "partial" }, taskOmittedFields: [],
    sprintScope: { query: { scope: "selected", sprintId: sprints[0].id, filters: DEFAULT_SPRINT_TASK_FILTERS, continuation: null },
      page: scopedSprintPage(sprints[0].id), readActor: sprintFixtureActor, selectionBasis: "document-selected-basis" },
  },
} satisfies Story["args"];

export const SprintSharedSearchUsesOneAuthorizedRead: Story = {
  args: sprintSearchArgs,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole("link", { name: "Sprint-Aufgabe" })).toBeVisible();
    await userEvent.click(await canvas.findByRole("button", { name: "Backlog und andere Sprints laden" }));
    await waitFor(() => expect(assignmentRequests).toBe(1));
    releaseAssignment();
    await expect(await canvas.findByRole("link", { name: "Später Zuweisungskandidat" })).toBeVisible();
    const search = canvas.getByRole("searchbox", { name: "Sprint-Aufgaben durchsuchen" });
    await userEvent.type(search, "Später Zuweisungskandidat{Enter}");
    await waitFor(() => expect(assignmentRequests).toBe(2));
    await waitFor(() => expect(jointSprintRequests).toBe(1));
    await expect(canvas.getByText("Sprint-Aufgaben werden geladen.")).toBeVisible();
    await expect(canvas.queryByText("Noch keine Aufgaben in diesem Sprint.")).not.toBeInTheDocument();
    releaseAssignment();
    await expect(await canvas.findByRole("link", { name: "Später Zuweisungskandidat" })).toBeVisible();
    await waitFor(() => expect(canvas.queryByText("Sprint-Aufgaben werden geladen.")).not.toBeInTheDocument());
    await expect(search).toHaveFocus();
    await expect(search).toHaveValue("Später Zuweisungskandidat");
    await expect(fullSprintRequests).toBe(0);
    await expect(projectedSprintRequests).toBe(0);
  },
};

export const SprintSearchWhileCandidatesAreClosedDoesNotLoadAssignments: Story = {
  args: sprintSearchArgs,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole("link", { name: "Sprint-Aufgabe" })).toBeVisible();
    const search = canvas.getByRole("searchbox", { name: "Sprint-Aufgaben durchsuchen" });
    await userEvent.type(search, "Später Zuweisungskandidat{Enter}");
    await waitFor(() => expect(projectedSprintRequests).toBe(1));
    projectionGate.resolve();
    await waitFor(() => expect(canvas.queryByText("Sprint-Aufgaben werden geladen.")).not.toBeInTheDocument());
    await expect(assignmentRequests).toBe(0);
    await expect(jointSprintRequests).toBe(0);
    await expect(search).toHaveFocus();
  },
};

export const ProfileSectionsKeepDraft: Story = {
  args: { initialWorkspace: "profile", initialData: { ...emptyPlanningShellState, profiles: [profile] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expectApplicationHeader(canvasElement, "Mein Profil");
    const focus = await canvas.findByRole("textbox", { name: "Fokus" }, { timeout: 5_000 });
    const context = within(await canvas.findByLabelText("Bereichskontext"));
    await userEvent.type(focus, "Mein lokaler Entwurf");
    await userEvent.click(context.getByRole("button", { name: "Planung" }));
    await expect(canvas.getByRole("heading", { name: "Planungs-Defaults" })).toBeVisible();
    await userEvent.click(context.getByRole("button", { name: "Profil" }));
    await expect(canvas.getByRole("textbox", { name: "Fokus" })).toHaveValue("Mein lokaler Entwurf");
    await expect(canvas.getByText("Ungespeicherte Änderungen")).toBeVisible();
    await expect(canvas.getByRole("button", { name: "Speichern" })).toBeVisible();
    await expect(context.queryByRole("button", { name: "Speichern" })).not.toBeInTheDocument();
  },
};

export const ToolsCreationFromContext: Story = {
  args: { initialWorkspace: "tools", initialData: { ...emptyPlanningShellState, profiles: [profile], fmdTools: [tool] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expectApplicationHeader(canvasElement, "Links & Tools");
    const context = within(await canvas.findByLabelText("Bereichskontext", {}, { timeout: 5_000 }));
    await userEvent.click(await context.findByRole("button", { name: "Link eintragen" }));
    const dialog = within(await within(document.body).findByRole("dialog", { name: "Link eintragen" }));
    await userEvent.type(dialog.getByRole("textbox", { name: "Name" }), "Teamwiki");
    await userEvent.type(dialog.getByRole("textbox", { name: "Beschreibung" }), "Wissen für das Team");
    await userEvent.type(dialog.getByRole("textbox", { name: "Link" }), "https://example.com/wiki");
    await userEvent.click(dialog.getByRole("button", { name: "Eintragen" }));
    await waitFor(() => expect(canvas.getByRole("heading", { name: "Teamwiki" })).toBeVisible());
    await expect(canvas.getByRole("searchbox", { name: "Links durchsuchen" })).toBeVisible();
    await expect(context.queryByRole("searchbox")).not.toBeInTheDocument();
  },
};

export const NotificationViewSurvivesHeaderRefresh: Story = {
  args: { initialWorkspace: "notifications", initialHeaderData: { ...headerData, quickLinks: readyHeaderSlot([{ id: "guide", name: "Aktueller Teamleitfaden", category: "knowledge", url: "https://example.com/guide", previewImageUrl: "" }]) }, initialData: { ...emptyPlanningShellState, profiles: [profile], notificationEvents: [pendingNotification, doneNotification] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expectApplicationHeader(canvasElement, "Benachrichtigungen");
    const context = within(await canvas.findByLabelText("Bereichskontext", {}, { timeout: 5_000 }));
    await userEvent.click(await context.findByRole("button", { name: /^Erledigt/ }));
    await expect(canvas.getByText("Abgeschlossener Hinweis")).toBeVisible();
    await expect(canvas.queryByText("Offener Hinweis")).not.toBeInTheDocument();
    document.dispatchEvent(new Event("visibilitychange"));
    await userEvent.click(canvas.getByRole("button", { name: "Kuratierte Links" }));
    await expect(await within(document.body).findByRole("link", { name: /Aktueller Teamleitfaden/ })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await expect(context.getByRole("button", { name: /^Erledigt/ })).toHaveAttribute("aria-pressed", "true");
    await expect(canvas.getByText("Abgeschlossener Hinweis")).toBeVisible();
  },
};

export const DecisionLogRefreshFromContext: Story = {
  args: { initialWorkspace: "decision-log", initialData: { ...emptyPlanningShellState, profiles: [profile] }, initialDecisionLogResult: decisionLog },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expectApplicationHeader(canvasElement, "Decision Log");
    const context = within(await canvas.findByLabelText("Bereichskontext", {}, { timeout: 5_000 }));
    await userEvent.click(await context.findByRole("button", { name: "Decision Log aktualisieren" }));
    await expect(await canvas.findByText(/Zuletzt geladen: 02\.01\.2099/)).toBeVisible();
    await expect(canvas.getByRole("group", { name: "Decision-Log-Ansicht" })).toBeVisible();
    await expect(context.queryByRole("searchbox")).not.toBeInTheDocument();
  },
};

export const AuthorizedAdministrationContext: Story = {
  args: { initialWorkspace: "administration", initialData: { ...emptyPlanningShellState, profiles: [administratorProfile] }, initialCurrentProfile: administratorProfile, initialAdministratorAccess: activeAdministratorAccess },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expectApplicationHeader(canvasElement, "Administration");
    const context = within(await canvas.findByLabelText("Bereichskontext", {}, { timeout: 5_000 }));
    const tabs = within(await context.findByRole("tablist", { name: "Administrationsbereiche" }));
    await userEvent.click(tabs.getByRole("tab", { name: "Personen & Zugänge" }));
    await expect(canvas.getByRole("tabpanel", { name: "Personen & Zugänge" })).toBeVisible();
    await userEvent.keyboard("{ArrowRight}");
    await expect(canvas.getByRole("tabpanel", { name: "Integrationen & Zustellung" })).toBeVisible();
    await expect(tabs.getByRole("tab", { name: "Integrationen & Zustellung" })).toHaveFocus();
    await expect(canvas.getByRole("button", { name: "Account-Menü öffnen" })).toBeVisible();
  },
};

export const DeniedAdministrationKeepsGlobalHeader: Story = {
  args: { initialWorkspace: "administration", initialData: { ...emptyPlanningShellState, profiles: [administratorProfile] }, initialCurrentProfile: administratorProfile },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expectApplicationHeader(canvasElement, "Administration");
    await expect(await canvas.findByText("Für Administration ist eine CEO-Sitzung oder ein aktiver Adminzugang erforderlich.", {}, { timeout: 5_000 })).toBeVisible();
    await expect(canvas.queryByLabelText("Bereichskontext")).not.toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Kalender öffnen" })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Account-Menü öffnen" }));
    await expect(canvas.queryByRole("button", { name: "Adminzugang für 60 Minuten aktivieren" })).not.toBeInTheDocument();
    await expect(canvas.queryByRole("button", { name: "Adminzugang beenden" })).not.toBeInTheDocument();
    await expect(canvas.queryByRole("button", { name: "Personen & Zugänge öffnen" })).not.toBeInTheDocument();
    await expect(canvas.queryByRole("button", { name: "Öffnen" })).not.toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Mein Profil" })).toBeVisible();
  },
};

export const AccountNavigationReplacesWorkspaceContext: Story = {
  render: args => <WorkspaceNavigation {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole("button", { name: "Event eintragen" }, { timeout: 5_000 })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Account-Menü öffnen" }));
    await userEvent.click(canvas.getByRole("button", { name: "Mein Profil" }));
    await expect(await canvas.findByRole("heading", { name: "Mein Profil", level: 1 })).toBeVisible();
    const profileContext = within(await canvas.findByLabelText("Bereichskontext"));
    await expect(profileContext.getAllByRole("button", { name: "Profil" })).toHaveLength(1);
    await expect(canvas.queryByRole("button", { name: "Event eintragen" })).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Account-Menü öffnen" }));
    await userEvent.click(canvas.getByRole("button", { name: "Personen & Zugänge öffnen" }));
    await expect(await canvas.findByRole("heading", { name: "Administration", level: 1 })).toBeVisible();
    await expect(await canvas.findByRole("tabpanel", { name: "Personen & Zugänge" })).toBeVisible();
    const administrationContext = within(await canvas.findByLabelText("Bereichskontext"));
    await expect(administrationContext.getByRole("tablist", { name: "Administrationsbereiche" })).toBeVisible();
    await expect(administrationContext.queryByRole("button", { name: "Profil" })).not.toBeInTheDocument();
  },
};

export const BacklogFocusPreservesContentFilters: Story = {
  args: { initialWorkspace: "backlog", initialData: { ...emptyPlanningShellState, profiles: [profile], tasks: [sprintTask], sprints }, initialBacklogModel: { revision: "backlog", people: [profile], items: [sprintTask], sprints, commitments: [] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expectApplicationHeader(canvasElement, "Backlog");
    const search = await canvas.findByRole("searchbox", { name: "Backlog durchsuchen" }, { timeout: 5_000 });
    await userEvent.type(search, "Sprint");
    await expect(within(canvas.getByLabelText("Bereichskontext")).queryByRole("searchbox")).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Fokusmodus" }));
    await expect(canvas.getByRole("button", { name: "Account-Menü öffnen" })).toBeVisible();
    await expect(canvas.queryByLabelText("Bereichskontext")).not.toBeInTheDocument();
    await expect(search).toHaveValue("Sprint");
    await userEvent.click(canvas.getByRole("button", { name: "Fokusmodus beenden" }));
    await expect(canvas.getByRole("heading", { name: "Backlog", level: 1 })).toBeVisible();
    await expect(canvas.getByRole("searchbox", { name: "Backlog durchsuchen" })).toHaveValue("Sprint");
    await expect(canvas.getByRole("button", { name: "Fokusmodus" })).toBeVisible();
  },
};

export const TeamKeepsContentControlsWithoutEmptyContext: Story = {
  args: { initialWorkspace: "team", initialData: { ...emptyPlanningShellState, profiles: [profile] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expectApplicationHeader(canvasElement, "Team");
    await expect(await canvas.findByRole("heading", { name: "Team", level: 1 })).toBeVisible();
    await expect(await canvas.findByRole("heading", { name: "Rollen & Vertretung" }, { timeout: 5_000 })).toBeVisible();
    await expect(canvas.queryByLabelText("Bereichskontext")).not.toBeInTheDocument();
    for (const name of ["Kuratierte Links", "Kalender öffnen", "Benachrichtigungen", "Hilfe öffnen", /GitHub öffnen/, "Account-Menü öffnen"]) await expect(canvas.getByRole("button", { name })).toBeVisible();
  },
};

export const NotificationInboxLoadsBeyondFirstPage: Story = {
  args: { initialWorkspace: "notifications", initialData: { ...emptyPlanningShellState, profiles: [profile], notificationEvents: Array.from({ length: 41 }, (_, index) => ({ ...pendingNotification, id: index + 1, title: index === 40 ? "Hinweis auf weiterer Seite" : `Hinweis ${index + 1}` })) } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("41 ungelesen insgesamt")).toBeVisible();
    await expect(canvas.getByText("40 neu in geladenen Hinweisen")).toBeVisible();
    await expect(canvas.queryByText("Hinweis auf weiterer Seite")).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Weitere Hinweise laden" }));
    await expect(await canvas.findByText("Hinweis auf weiterer Seite")).toBeVisible();
    await expect(canvas.getByText("41 neu in geladenen Hinweisen")).toBeVisible();
  },
};
