import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import type { User } from "@supabase/supabase-js";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { productUpdates } from "@/features/product-updates/model/product-update-registry";
import { PlanningApp } from "@/features/planning/PlanningApp";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { planningTaskRevision } from "@/features/planning/model/planning-revision";
import { inactiveAdministratorAccess } from "@/features/administrator-access/model/administrator-access";
import { emptyPlanningHeaderData, readyHeaderSlot } from "@/lib/planning-header-data";
import { mockAccountLifecycle } from "../../../../tests/helpers/account-lifecycle-browser-fixture";

const profile = { id: "phone-planning-profile", name: "Mara", platformRole: "ceo" as const, orgRole: "CEO", githubLogin: "phone-planning", weeklyCapacity: 20 };
const user = { id: "phone-planning-user", email: "mara@example.test", app_metadata: {}, user_metadata: { name: "Mara" }, aud: "authenticated", created_at: "2026-01-01T00:00:00Z" } satisfies User;
const data = { ...emptyPlanningShellState, project: { ...emptyPlanningShellState.project, name: "findmydoc", range: "November 2026" }, profiles: [profile] };
const headerData = { ...emptyPlanningHeaderData, quickLinks: readyHeaderSlot([{ id: "guide", name: "Team guide", category: "knowledge", url: "https://example.com/guide", previewImageUrl: "" }]), notifications: readyHeaderSlot({ unreadCount: 0, items: [] }), calendarEvents: readyHeaderSlot([]) };

function ActivePlanningComposition() {
  return <PlanningApp initialData={data} initialHeaderData={headerData} initialWorkspace="planning" source="supabase" authRequired initialAuthUser={user} initialCurrentProfile={profile} initialProtectedDataLoaded initialAdministratorAccess={inactiveAdministratorAccess} />;
}

const meta = {
  title: "Application shell/Active Planning",
  component: ActivePlanningComposition,
  parameters: { layout: "fullscreen", nextjs: { appDirectory: true, navigation: { pathname: "/planning", query: {} } } },
  beforeEach: () => {
    const key = `founderops.product-updates.seen.${profile.id}`;
    const previousSeen = localStorage.getItem(key);
    localStorage.setItem(key, JSON.stringify(productUpdates.map(update => update.id)));
    const cleanup = mockAccountLifecycle("google", { linked: true, workspaceEmail: user.email }, input => {
    const path = new URL(String(input), "http://localhost").pathname;
    if (path === "/api/auth/session") return Response.json({ session: { userId: user.id, user: { id: user.id, email: user.email, displayName: "Mara" }, revision: "phone-planning-session", expiresAt: Math.floor(Date.now() / 1000) + 3600 } });
    if (path === "/api/administrator-access") return Response.json({ administratorAccess: inactiveAdministratorAccess });
    if (path === "/api/github-app/status") return Response.json({ installation: { available: true }, user: { connected: true }, waitingCommentCount: 0 });
    if (path === "/api/planning-header-data") return Response.json({ headerData });
    if (path === "/api/planning-revision") return Response.json({ revision: planningTaskRevision([]) });
    if (path.startsWith("/api/team-workweek/")) return Response.json({ error: "Arbeitszeiten sind in dieser Vorschau nicht verfügbar." }, { status: 503 });
    if (path.startsWith("/api/")) return Response.json({ error: "Diese Vorschau führt die Aktion nicht aus." }, { status: 503 });
    throw new Error("Unexpected non-API fixture request");
    });
    return () => {
      cleanup();
      if (previousSeen === null) localStorage.removeItem(key);
      else localStorage.setItem(key, previousSeen);
    };
  },
} satisfies Meta<typeof ActivePlanningComposition>;
export default meta;
type Story = StoryObj<typeof meta>;

export const PhonePlanningKeepsGlobalActions: Story = {
  globals: { viewport: { value: "phone" } },
  parameters: { viewport: { options: { phone: { name: "Phone", styles: { width: "390px", height: "844px" } } } } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByRole("heading", { name: "Planung", level: 1 })).toBeVisible();
    await expect(canvas.getByText("findmydoc · November 2026")).toBeVisible();
    const more = canvas.getByRole("button", { name: "Mehr" });
    await expect(canvas.getByRole("button", { name: "Account-Menü öffnen" })).toBeVisible();
    await userEvent.click(more);
    await expect(canvas.getAllByRole("menuitem")).toHaveLength(4);
    await userEvent.click(canvas.getByRole("menuitem", { name: "Kalender öffnen" }));
    const page = within(document.body);
    await expect(await page.findByRole("tab", { name: "Arbeitswoche" })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(more).toHaveFocus());
    await userEvent.click(canvas.getByRole("button", { name: "Fokusmodus" }));
    await expect(canvas.getByRole("button", { name: "Fokusmodus beenden" })).toBeVisible();
    await expect(canvas.queryByRole("button", { name: "Mehr" })).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Fokusmodus beenden" }));
    await expect(canvas.getByRole("button", { name: "Mehr" })).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Navigation öffnen" }));
    await expect(canvas.getAllByRole("button", { name: "Navigation schließen" }).find(button => button.tabIndex !== -1)!).toBeVisible();
    await expect(canvas.getByRole("link", { name: /Releases/ })).toBeVisible();
    await userEvent.click(canvas.getAllByRole("button", { name: "Navigation schließen" }).find(button => button.tabIndex !== -1)!);
    await expect(document.documentElement.scrollWidth).toBeLessThanOrEqual(window.innerWidth);
  },
};

export const ResponsivePlanning: Story = {};
