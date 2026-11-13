import { useEffect, useState } from "react";
import type { User } from "@supabase/supabase-js";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { getRouter } from "@storybook/nextjs-vite/navigation.mock";
import { expect, userEvent, within } from "storybook/test";
import { PlanningApp } from "@/features/planning/PlanningApp";
import { PlanningStateProvider } from "@/features/planning/organisms/planning-state-provider";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { planningTaskRevision } from "@/features/planning/model/planning-revision";
import { PlatformReleasesShell } from "@/features/platform-releases/templates/platform-releases-shell";
import { PlatformReleaseArchive } from "@/features/platform-releases/organisms/platform-release-archive";
import { releaseStoryFixture } from "@/features/platform-releases/organisms/platform-release-story-fixture";
import { productUpdates } from "@/features/product-updates/model/product-update-registry";
import { inactiveAdministratorAccess } from "@/features/administrator-access/model/administrator-access";
import { berlinDateKey } from "@/features/team-workweek/model/team-workweek-calendar";
import { emptyPlanningHeaderData, readyHeaderSlot } from "@/lib/planning-header-data";
import type { Profile } from "@/lib/types";
import { mockAccountLifecycle } from "../../../../tests/helpers/account-lifecycle-browser-fixture";

const user = { id: "parity-user", email: "mara@example.test" } as User;
const profile: Profile = { id: "parity-profile", name: "Mara", platformRole: "ceo", orgRole: "CEO", githubLogin: "mara", weeklyCapacity: 27, focus: "Accepted planning focus", notificationsEnabled: false, color: "#2563eb" };
const calendarIdentity: Profile = { id: profile.id, name: profile.name, platformRole: "ceo", orgRole: "", githubLogin: "", weeklyCapacity: 0, color: profile.color };
const headerData = { ...emptyPlanningHeaderData, quickLinks: readyHeaderSlot([]), calendarEvents: readyHeaderSlot([]), notifications: readyHeaderSlot({ unreadCount: 0, items: [] }) };

function LifetimeJourney() {
  const [href, setHref] = useState("/planning");
  useEffect(() => {
    const push = getRouter().push;
    push.mockImplementation(setHref);
    // Storybook's Link adapter records clicks without calling the App Router adapter.
    const followLink = (event: MouseEvent) => {
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[href]") : null;
      const target = link?.getAttribute("href");
      if (target && ["/planning", "/team", "/team/platform-releases"].includes(target) && event.button === 0 && !event.metaKey && !event.ctrlKey && !event.shiftKey && !event.altKey) push(target);
    };
    document.addEventListener("click", followLink);
    return () => { push.mockReset(); document.removeEventListener("click", followLink); };
  }, []);
  const workspace = href.startsWith("/profile") ? "profile" : href === "/team" || href.startsWith("/team?") ? "team" : "planning";
  return <PlanningStateProvider>
    {href.startsWith("/team/platform-releases") ? <PlatformReleasesShell authUser={user} initialCurrentProfile={profile} currentPlatformRole="ceo" initialAdministratorAccess={inactiveAdministratorAccess} headerData={headerData} calendarProfiles={readyHeaderSlot([calendarIdentity])}>
      <PlatformReleaseArchive releases={[releaseStoryFixture()]} />
    </PlatformReleasesShell> : <PlanningApp key={href} initialData={{ ...emptyPlanningShellState, profiles: href === "/planning" ? [profile] : [] }} initialHeaderData={headerData} initialWorkspace={workspace} source="supabase" authRequired initialAuthUser={user} initialCurrentProfile={profile} initialProtectedDataLoaded initialAdministratorAccess={inactiveAdministratorAccess} />}
  </PlanningStateProvider>;
}

const meta = {
  title: "Application shell/Lifetime journey",
  component: LifetimeJourney,
  parameters: { layout: "fullscreen", nextjs: { appDirectory: true, navigation: { pathname: "/planning", query: {} } } },
  beforeEach: () => {
    const seenKey = `founderops.product-updates.seen.${profile.id}`;
    const previous = localStorage.getItem(seenKey);
    localStorage.setItem(seenKey, JSON.stringify(productUpdates.map(update => update.id)));
    let teamReads = 0;
    const restore = mockAccountLifecycle("google", { linked: true, workspaceEmail: user.email }, input => {
      const path = new URL(String(input), "http://localhost").pathname;
      if (path === "/api/auth/session") return Response.json({ session: { user, userId: user.id, revision: "parity-session", expiresAt: Math.floor(Date.now() / 1000) + 3600 } });
      if (path === "/api/administrator-access") return Response.json({ administratorAccess: inactiveAdministratorAccess });
      if (path === "/api/planning-header-data") return Response.json({ headerData, readAuthority: { userId: user.id, deadline: Date.now() + 60_000 } });
      if (path === "/api/planning-revision") return Response.json({ revision: planningTaskRevision([]) });
      if (path === "/api/github-app/status") return Response.json({ installation: { available: true }, user: { connected: true }, waitingCommentCount: 0 });
      if (path === "/api/team/platform-releases/v1/releases") return Response.json({ releases: [releaseStoryFixture()] });
      // A new response must not repair profile fields overwritten during the Release visit.
      if (path === "/api/team-data" && teamReads++ === 0) return Response.json({ model: { revision: "accepted-team", people: [profile], items: [], readCoverage: { people: "complete" } } });
      if (path === "/api/team-data" || path === "/api/profile-data") return new Promise<Response>(() => {});
      if (path === "/api/team-workweek/team") {
        const schedule = { id: "parity-publication", ownerProfileId: profile.id, effectiveFrom: "2020-01-01", effectiveTo: null, timezone: "Europe/Berlin", publicationRevision: 2, lastSyncAt: "2026-11-01T09:00:00Z", windows: Object.fromEntries(["monday", "tuesday", "wednesday", "thursday", "friday", "saturday", "sunday"].map(day => [day, [{ start: "09:00", end: "17:00" }]])) };
        return Response.json({ currentWorkweeks: [schedule], calendarWorkweeks: [schedule], referenceDate: berlinDateKey() });
      }
      if (path.startsWith("/api/")) return Response.json({ error: "Not provided by this local journey" }, { status: 503 });
      throw new Error("Unexpected non-API journey request");
    });
    return () => { restore(); if (previous === null) localStorage.removeItem(seenKey); else localStorage.setItem(seenKey, previous); };
  },
} satisfies Meta<typeof LifetimeJourney>;
export default meta;
type Story = StoryObj<typeof meta>;

export const ReleaseCalendarPreservesAcceptedBusinessProfile: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const page = within(document.body);
    await expect(canvas.getByRole("heading", { name: "Planung", level: 1 })).toBeVisible();
    await userEvent.click(canvas.getByRole("link", { name: "Team" }));
    await expect(await canvas.findByText("27h", {}, { timeout: 5_000 })).toBeVisible();
    await userEvent.click(canvas.getByRole("link", { name: "Planung" }));
    await expect(await canvas.findByRole("heading", { name: "Planung", level: 1 })).toBeVisible();
    await userEvent.click(canvas.getByRole("link", { name: /^Releases/ }));
    await expect(await canvas.findByRole("heading", { name: "Releases", level: 1 })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Kalender öffnen" }));
    await userEvent.click(await page.findByRole("tab", { name: "Arbeitswoche" }));
    await expect(await page.findAllByText("09:00–17:00")).not.toHaveLength(0);
    await expect(page.getAllByText("Mara")).not.toHaveLength(0);
    await userEvent.click(page.getByRole("button", { name: "Im Team öffnen" }));
    await expect(await canvas.findByRole("heading", { name: "Team", level: 1 })).toBeVisible();
    await expect(await canvas.findByText("27h", {}, { timeout: 5_000 })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Account-Menü öffnen" }));
    await userEvent.click(canvas.getByRole("button", { name: "Mein Profil" }));
    await expect(await canvas.findByRole("textbox", { name: "Fokus" }, { timeout: 5_000 })).toHaveValue("Accepted planning focus");
    await userEvent.click(within(canvas.getByLabelText("Bereichskontext")).getByRole("button", { name: "Benachrichtigungen" }));
    await expect(canvas.getByRole("switch", { name: "Google-Chat-Hinweise aktiv" })).not.toBeChecked();
  },
};
