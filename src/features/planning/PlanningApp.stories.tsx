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
import type { SprintWorkspaceModel } from "@/features/sprint/model/sprint-read-model";
import { mockAccountLifecycle } from "../../../tests/helpers/account-lifecycle-browser-fixture";
import { productUpdates } from "@/features/product-updates/model/product-update-registry";
import type { NotionDecisionLogResult } from "@/lib/notion-decision-log";
import { inactiveAdministratorAccess, sessionAuthority } from "@/features/administrator-access/model/administrator-access";
import { administrationStoryModel } from "@/features/administration/organisms/administration-workspace.stories";
import { PlanningStateProvider } from "./organisms/planning-state-provider";
import { workspaceRoutes } from "./model/workspace-routes";

const profile: Profile = { id: "workspace-member", name: "Mara Beispiel", platformRole: "ceo", orgRole: "CEO", githubLogin: "workspace-member", weeklyCapacity: 40, color: "#2563eb" };
const user = { id: "workspace-user", email: "mara@example.com" } as User;
const headerData = { ...emptyPlanningHeaderData, quickLinks: readyHeaderSlot([]), calendarEvents: readyHeaderSlot([]), notifications: readyHeaderSlot({ unreadCount: 0, items: [] }) };
const event: FounderEvent = { id: 1, title: "Teamtermin", category: "other", startsAt: "2099-01-10T10:00:00.000Z", endsAt: "", location: "", description: "", audienceMode: "all", participantProfileIds: [], reminderDaysBefore: 7, reminderGeneratedAt: "", status: "planned", createdBy: profile.id, createdAt: "r1", updatedAt: "r1" };
const sprints: Sprint[] = [
  { id: "workspace-sprint-1", name: "Sprint 1", startDate: "2099-01-01", endDate: "2099-01-14", reviewDueAt: "", scoreLocked: false, status: "planning", updatedAt: "r1" },
  { id: "workspace-sprint-2", name: "Sprint 2", startDate: "2099-01-15", endDate: "2099-01-28", reviewDueAt: "", scoreLocked: false, status: "planning", updatedAt: "r1" },
];
const sprintTask = taskDetailStoryTask({ id: "workspace-task", title: "Sprint-Aufgabe", sprintId: sprints[0].id });
const sprintModel: SprintWorkspaceModel = { revision: "sprint", project: emptyPlanningShellState.project, people: [profile], items: [sprintTask], sprints, commitments: [], scores: [], strikeStates: [], strikeEvents: [], objections: [], meetings: [], attendance: [] };
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
    const access = args.initialAdministratorAccess || inactiveAdministratorAccess;
    const capabilities = sessionAuthority({ platformRole: args.initialCurrentProfile?.platformRole || "viewer", credentialKind: "session", administratorAccess: access }).capabilities;
    const seenKey = `founderops.product-updates.seen.${profile.id}`;
    const previousSeen = localStorage.getItem(seenKey);
    localStorage.setItem(seenKey, JSON.stringify(productUpdates.map(update => update.id)));
    const restore = mockAccountLifecycle("google", { linked: true, workspaceEmail: "mara@example.com" }, (input, init) => {
    const path = String(input).split("?")[0];
    if (path === "/api/auth/session") return Response.json({ session: { user, userId: user.id, revision: "workspace-session", expiresAt: Math.floor(Date.now() / 1000) + 3600 } });
    if (path === "/api/administrator-access") return init?.method && init.method !== "GET" ? Response.json({ error: "This fixture does not activate administrator access" }, { status: 403 }) : Response.json({ administratorAccess: access });
    if (path === "/api/administration-data") return capabilities.manageAdministratorEligibility ? Response.json({ administration: { ...administrationStoryModel, capabilities, people: [], notificationEvents: [], notificationDeliveries: [] } }) : Response.json({ error: "Kein Zugriff", code: "administrator_access_required" }, { status: 403 });
    if (path === "/api/planning-header-data") return Response.json({ headerData });
    if (path === "/api/team/platform-releases/v1/releases") return Response.json({ releases: [] });
    if (path === "/api/github-app/status") return Response.json({ installation: { available: false }, user: { connected: false } });
    if (path === "/api/events-data") return Response.json({ model: { revision: "events", events: [event], people: [profile], coverage: { completeness: "complete" } } });
    if (path === "/api/events" && init?.method === "POST") return Response.json({ event: { ...event, ...JSON.parse(String(init.body)), id: 2, updatedAt: "r2" } });
    if (path === "/api/tools/metadata") return Response.json({ metadata: { title: "", description: "", imageUrl: "", siteName: "" } });
    if (path === "/api/tools" && init?.method === "POST") return Response.json({ tool: { ...tool, ...JSON.parse(String(init.body)), id: "created-tool", updatedAt: "r2" } });
    if (path === "/api/notifications-data") return Response.json({ headerData: { ...headerData, quickLinks: readyHeaderSlot([{ id: "guide", name: "Aktueller Teamleitfaden", category: "knowledge", url: "https://example.com/guide", previewImageUrl: "" }]) }, model: { revision: "notifications", people: args.initialData.profiles, items: [], events: args.initialData.notificationEvents, deliveries: [], coverage: { events: "complete", deliveries: "forbidden" } } });
    if (path === "/api/decision-log") return Response.json({ result: { ...decisionLog, fetchedAt: "2099-01-02T10:00:00Z" } });
    if (path === "/api/profile-data") return Response.json({ model: { revision: "profile", people: args.initialData.profiles, project: args.initialData.project, initiatives: [], notificationPreferences: [], preferences: [] } });
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
    await expect(await canvas.findByRole("heading", { name: "Termine & Erinnerungen", level: 1 })).toBeVisible();
    await expect(await canvas.findByRole("heading", { name: "Teamtermin" })).toBeVisible();
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

export const ProfileSectionsKeepDraft: Story = {
  args: { initialWorkspace: "profile", initialData: { ...emptyPlanningShellState, profiles: [profile] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const focus = await canvas.findByRole("textbox", { name: "Fokus" });
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
    const context = within(await canvas.findByLabelText("Bereichskontext"));
    await userEvent.click(await context.findByRole("button", { name: "Link eintragen" }));
    const dialog = within(await within(document.body).findByRole("dialog", { name: "Link eintragen" }));
    await userEvent.type(dialog.getByRole("textbox", { name: "Name" }), "Teamwiki");
    await userEvent.type(dialog.getByRole("textbox", { name: "Beschreibung" }), "Wissen für das Team");
    await userEvent.type(dialog.getByRole("textbox", { name: "Link" }), "https://example.com/wiki");
    await userEvent.click(dialog.getByRole("button", { name: "Eintragen" }));
    await expect(await canvas.findByRole("heading", { name: "Teamwiki" })).toBeVisible();
    await expect(canvas.getByRole("searchbox", { name: "Links durchsuchen" })).toBeVisible();
    await expect(context.queryByRole("searchbox")).not.toBeInTheDocument();
  },
};

export const NotificationViewSurvivesHeaderRefresh: Story = {
  args: { initialWorkspace: "notifications", initialData: { ...emptyPlanningShellState, profiles: [profile], notificationEvents: [pendingNotification, doneNotification] } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const context = within(await canvas.findByLabelText("Bereichskontext"));
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
    const context = within(await canvas.findByLabelText("Bereichskontext"));
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
    const context = within(await canvas.findByLabelText("Bereichskontext"));
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
    await expect(await canvas.findByText("Für Administration ist eine CEO-Sitzung oder ein aktiver Adminzugang erforderlich.")).toBeVisible();
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
    await expect(await canvas.findByRole("button", { name: "Event eintragen" })).toBeVisible();
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
    const search = await canvas.findByRole("searchbox", { name: "Backlog durchsuchen" });
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
    await expect(await canvas.findByRole("heading", { name: "Team", level: 1 })).toBeVisible();
    await expect(await canvas.findByRole("heading", { name: "Rollen & Vertretung" })).toBeVisible();
    await expect(canvas.queryByLabelText("Bereichskontext")).not.toBeInTheDocument();
    for (const name of ["Kuratierte Links", "Kalender öffnen", "Benachrichtigungen", "Hilfe öffnen", /GitHub öffnen/, "Account-Menü öffnen"]) await expect(canvas.getByRole("button", { name })).toBeVisible();
  },
};
