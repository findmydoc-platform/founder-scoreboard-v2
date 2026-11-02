import type { User } from "@supabase/supabase-js";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { getRouter } from "@storybook/nextjs-vite/navigation.mock";
import { expect, userEvent, within } from "storybook/test";
import type { AdministratorAccessSnapshot } from "@/features/administrator-access/model/administrator-access";
import { berlinDateKey } from "@/features/team-workweek/model/team-workweek-calendar";
import { isLocalLoginSimulationEnabled } from "@/lib/local-development-auth";
import type { HeaderDataSlot, PlanningHeaderData, Profile } from "@/lib/types";
import { emptyPlanningHeaderData, readyHeaderSlot } from "@/lib/planning-header-data";
import { PlatformReleaseArchive } from "../organisms/platform-release-archive";
import { PlatformReleaseDetail } from "../organisms/platform-release-detail";
import { releaseStoryFixture } from "../organisms/platform-release-story-fixture";
import { PlatformReleasesShell } from "./platform-releases-shell";
import { mockAccountLifecycle } from "../../../../tests/helpers/account-lifecycle-browser-fixture";

const user: User = { id: "release-user", email: "mara@example.com", user_metadata: { full_name: "Mara" }, app_metadata: {}, aud: "authenticated", created_at: "2026-11-01T00:00:00Z" };
const headerData: PlanningHeaderData = {
  ...emptyPlanningHeaderData,
  quickLinks: readyHeaderSlot([{ id: "guide", name: "Team guide", category: "knowledge", url: "https://example.com/guide", previewImageUrl: "" }]),
  calendarEvents: readyHeaderSlot([]),
  notifications: readyHeaderSlot({ unreadCount: 0, items: [] }),
};

type AdministratorFixture = "denied" | "eligible" | "active";
type IdentityFixture = "ready" | "loading" | "failed" | "denied" | "empty";
type ReleaseFixture = { detail?: boolean; administrator?: AdministratorFixture; identities?: IdentityFixture; calendarFailed?: boolean; githubUnavailable?: boolean };
const profile: Profile = { id: "release-profile", name: "Mara", githubLogin: "mara", platformRole: "founder", orgRole: "Founder", weeklyCapacity: 40, color: "#2563eb" };
let restoreGithubFixture = () => {};
function profilesFor(state: IdentityFixture): HeaderDataSlot<Profile[]> {
  if (state === "loading") return { state: "loading", data: [] };
  if (state === "failed" || state === "denied") return { state: "error", data: [], error: state === "denied" ? "Kein Zugriff auf Kalenderprofile." : "Kalenderprofile konnten nicht geladen werden." };
  return readyHeaderSlot(state === "empty" ? [] : [profile]);
}
function accessFor(mode: AdministratorFixture): AdministratorAccessSnapshot {
  return { eligible: mode !== "denied", active: mode === "active", expiresAt: mode === "active" ? new Date(Date.now() + 3600_000).toISOString() : null };
}
function releaseBrowserFixture({ administrator = "denied", calendarFailed = false, githubUnavailable = false }: ReleaseFixture) {
  let access = accessFor(administrator);
  let githubFailed = githubUnavailable;
  restoreGithubFixture = () => { githubFailed = false; };
  return mockAccountLifecycle("google", { linked: true, workspaceEmail: user.email }, (input, init) => {
    const path = new URL(String(input), window.location.origin).pathname;
    if (path === "/api/auth/session") return Response.json({ session: { userId: user.id, user: { id: user.id, displayName: "Mara" }, revision: "release-session", expiresAt: Math.floor(Date.now() / 1000) + 3600 } });
    if (path === "/api/planning-header-data") return Response.json({ headerData });
    if (path === "/api/administrator-access") {
      if (init?.method === "DELETE") access = accessFor("eligible");
      return Response.json({ administratorAccess: access });
    }
    if (path === "/api/github-app/status") return githubFailed ? Response.json({ error: "GitHub ist vorübergehend nicht verfügbar." }, { status: 503 }) : Response.json({ installation: { available: true }, user: { connected: true, needsReconnect: false }, waitingCommentCount: 0 });
    if (path === "/api/team-workweek/team") {
      if (calendarFailed) return Response.json({ error: "Arbeitszeiten konnten nicht geladen werden." }, { status: 503 });
      const schedule = { id: "release-publication", ownerProfileId: "release-profile", effectiveFrom: "2020-01-01", effectiveTo: null, timezone: "Europe/Berlin", publicationRevision: 2, lastSyncAt: "2026-11-01T09:00:00Z", windows: Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map(day => [day, [{ start: "09:00", end: "17:00" }]])) };
      return Response.json({ currentWorkweeks: [schedule], calendarWorkweeks: [schedule], referenceDate: berlinDateKey() });
    }
    throw new Error(`Unexpected release fixture request: ${path}`);
  });
}

function ReleaseComposition({ detail = false, administrator = "denied", identities = "ready", githubUnavailable = false }: ReleaseFixture) {
  return <><PlatformReleasesShell authUser={user} currentPlatformRole="founder" initialCurrentProfile={profile} initialAdministratorAccess={accessFor(administrator)} headerData={headerData} calendarProfiles={profilesFor(identities)} returnToArchive={detail}>
    {detail ? <PlatformReleaseDetail release={releaseStoryFixture()} /> : <PlatformReleaseArchive releases={[releaseStoryFixture()]} />}
  </PlatformReleasesShell>{githubUnavailable ? <button type="button" onClick={() => restoreGithubFixture()}>Restore GitHub service</button> : null}</>;
}

const meta = {
  title: "Features/PlatformReleases/Templates/Shell",
  component: ReleaseComposition,
  parameters: { layout: "fullscreen" },
  beforeEach: ({ args }) => releaseBrowserFixture(args),
} satisfies Meta<typeof ReleaseComposition>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ArchiveGlobalActions: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("heading", { name: "Releases", level: 1 })).toBeVisible();
    const actions = ["Kuratierte Links", "Kalender öffnen", "Benachrichtigungen", "Hilfe öffnen", /GitHub öffnen/, "Account-Menü öffnen"].map(name => canvas.getByRole("button", { name }));
    for (let index = 1; index < actions.length; index++) await expect(actions[index - 1].compareDocumentPosition(actions[index]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    await userEvent.click(canvas.getByRole("button", { name: /GitHub öffnen/ }));
    await expect(canvas.getByRole("dialog", { name: "GitHub-Sync" })).toBeVisible();
    await expect(await within(canvas.getByRole("dialog", { name: "GitHub-Sync" })).findByRole("button", { name: isLocalLoginSimulationEnabled() ? /GitHub App lokal nicht verfügbar/ : /Vollständig verbunden/ })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "GitHub schließen" }));
    await userEvent.click(canvas.getByRole("button", { name: "Kuratierte Links" }));
    await expect(within(document.body).getByRole("link", { name: /Team guide/ })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await userEvent.click(canvas.getByRole("button", { name: "Hilfe öffnen" }));
    await expect(within(document.body).getByRole("button", { name: /Geführte Hilfe/ })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await userEvent.click(canvas.getByRole("button", { name: "Account-Menü öffnen" }));
    await expect(canvas.queryByRole("button", { name: "Adminzugang für 60 Minuten aktivieren" })).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: /Profil/ }));
    await expect(getRouter().push).toHaveBeenCalledWith("/profile");
  },
};

export const DetailIdentityAndReturn: Story = {
  args: { detail: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    await expect(within(canvas.getByLabelText("Anwendung")).getByText("Releases", { exact: true })).toBeVisible();
    await expect(canvas.getByRole("heading", { name: "Klinikgruppen im Dashboard vorbereitet", level: 1 })).toBeVisible();
    const context = within(canvas.getByLabelText("Bereichskontext"));
    await expect(context.getByRole("link", { name: "Zurück zu Releases" })).toHaveAttribute("href", "/team/platform-releases");
    await expect(context.getByRole("link", { name: "Zurück zu Releases" })).toBeVisible();
  },
};

export const EligibleAdministratorAccount: Story = {
  args: { administrator: "eligible" },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Account-Menü öffnen" }));
    await expect(canvas.getByRole("button", { name: "Adminzugang für 60 Minuten aktivieren" })).toBeVisible();
    await expect(canvas.queryByRole("button", { name: "Adminzugang beenden" })).not.toBeInTheDocument();
  },
};

export const CalendarShowsPublishedWorkweek: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    await userEvent.click(canvas.getByRole("button", { name: "Kalender öffnen" }));
    await userEvent.click(await body.findByRole("tab", { name: "Arbeitswoche" }));
    await expect(await body.findAllByText("09:00–17:00")).not.toHaveLength(0);
    await expect(body.getAllByText("Mara")).not.toHaveLength(0);
    await userEvent.click(body.getByRole("button", { name: "Nächste Woche" }));
    const selectedWeek = body.getByRole("group", { name: "Angezeigte Arbeitswoche" }).textContent;
    await userEvent.click(body.getByRole("tab", { name: "Termine" }));
    await userEvent.click(body.getByRole("tab", { name: "Arbeitswoche" }));
    await expect(body.getByRole("group", { name: "Angezeigte Arbeitswoche" })).toHaveTextContent(selectedWeek!);
    await userEvent.click(body.getByRole("button", { name: "Im Team öffnen" }));
    await expect(getRouter().push).toHaveBeenCalledWith(expect.stringMatching(/^\/team\?week=\d{4}-\d{2}-\d{2}$/));
  },
};

export const ActiveAdministratorCanEndAccess: Story = {
  args: { administrator: "active", detail: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Account-Menü öffnen" }));
    await expect(canvas.getByRole("button", { name: "Öffnen" })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Adminzugang beenden" }));
    await userEvent.click(canvas.getByRole("button", { name: "Account-Menü öffnen" }));
    await expect(await canvas.findByRole("button", { name: "Adminzugang für 60 Minuten aktivieren" })).toBeVisible();
  },
};

async function expectCalendarState(canvasElement: HTMLElement, message: string) {
  const canvas = within(canvasElement);
  const body = within(canvasElement.ownerDocument.body);
  await userEvent.click(canvas.getByRole("button", { name: "Kalender öffnen" }));
  await userEvent.click(await body.findByRole("tab", { name: "Arbeitswoche" }));
  await expect((await body.findAllByText(message)).at(-1)).toBeVisible();
  await expect(body.queryByText("Niemand eingeplant.")).not.toBeInTheDocument();
  await userEvent.click(body.getByRole("tab", { name: "Termine" }));
  await expect(body.getByText("Keine FounderOps-Termine.")).toBeVisible();
}

export const LoadingCalendarIdentities: Story = { args: { identities: "loading" }, play: ({ canvasElement }) => expectCalendarState(canvasElement, "Team-Arbeitswoche wird geladen.") };
export const FailedCalendarIdentities: Story = { args: { identities: "failed" }, play: ({ canvasElement }) => expectCalendarState(canvasElement, "Kalenderprofile konnten nicht geladen werden.") };
export const DeniedCalendarIdentities: Story = { args: { identities: "denied", detail: true }, play: ({ canvasElement }) => expectCalendarState(canvasElement, "Kein Zugriff auf Kalenderprofile.") };
export const FailedWorkweekKeepsAppointments: Story = { args: { calendarFailed: true }, play: ({ canvasElement }) => expectCalendarState(canvasElement, "Arbeitszeiten konnten nicht geladen werden.") };

export const GithubConnectionRecoversAfterServiceReturns: Story = {
  args: { githubUnavailable: true, detail: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: /GitHub öffnen/ }));
    await expect(canvas.getByRole("dialog", { name: "GitHub-Sync" })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "GitHub schließen" }));
    await userEvent.click(canvas.getByRole("button", { name: "Restore GitHub service" }));
    await userEvent.click(canvas.getByRole("button", { name: /GitHub öffnen/ }));
    const dialog = within(canvas.getByRole("dialog", { name: "GitHub-Sync" }));
    await expect(await dialog.findByRole("button", { name: isLocalLoginSimulationEnabled() ? /GitHub App lokal nicht verfügbar/ : /Vollständig verbunden/ })).toBeVisible();
  },
};
