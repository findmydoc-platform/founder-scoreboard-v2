import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { expect, fn, userEvent, within } from "storybook/test";
import { AdministrationOverview } from "./administration-overview";
import { IntegrationsDeliveryAdministration } from "./integrations-delivery-administration";
import { PeopleAccessAdministration } from "./people-access-administration";
import { AdministrationWorkspaceTemplate, type AdministrationTab } from "../templates/administration-workspace-template";
import type { AdministrationWorkspaceModel } from "../model/administration-read-model";

export const administrationStoryModel: AdministrationWorkspaceModel = {
  revision: "2026-09-22T14:00:00.000Z",
  capabilities: {
    technicalAdministration: true,
    manageAdministratorEligibility: true,
    operationalCorrection: true,
    ceoGovernance: false,
  },
  people: [
    {
      id: "sebastian",
      name: "Sebastian Schütze",
      platformRole: "ceo",
      orgRole: "CEO",
      githubLogin: "SebastianSchuetze",
      githubConnection: { status: "active", description: "GitHub ist aktiv mit FounderOps verbunden.", lastSignInAt: "2026-09-22T11:45:00.000Z" },
      googleChatUserId: "sebastian@example.com",
      googleChatDmSpace: "spaces/direct-sebastian",
      notificationsEnabled: true,
      googleChatReady: true,
      administratorAccess: { eligible: true, active: true, expiresAt: "2026-09-22T15:00:00.000Z" },
    },
    {
      id: "volkan",
      name: "Volkan Özkan",
      platformRole: "founder",
      orgRole: "Founder",
      githubLogin: "volkanoezkan",
      githubConnection: { status: "prepared", description: "GitHub ist vorbereitet. Die erste erfolgreiche Anmeldung bei FounderOps steht noch aus.", lastSignInAt: null },
      googleChatUserId: "volkan@example.com",
      googleChatDmSpace: "spaces/direct-volkan",
      notificationsEnabled: true,
      googleChatReady: true,
      administratorAccess: { eligible: true, active: false, expiresAt: null },
    },
    {
      id: "anil",
      name: "Anil Kaya",
      platformRole: "viewer",
      orgRole: "Design",
      githubLogin: "anilkaya",
      githubConnection: { status: "incomplete", description: "GitHub-Login und GitHub-Identität stimmen nicht überein.", lastSignInAt: null },
      googleChatUserId: "",
      googleChatDmSpace: "",
      notificationsEnabled: false,
      googleChatReady: false,
      administratorAccess: { eligible: false, active: false, expiresAt: null },
    },
    {
      id: "oezen",
      name: "Özen Aksoy",
      platformRole: "founder",
      orgRole: "Operations",
      githubLogin: "oezenaksoy",
      githubConnection: { status: "incomplete", description: "Das Profil ist noch keiner FounderOps-Anmeldung zugeordnet.", lastSignInAt: null },
      googleChatUserId: "oezen@example.com",
      googleChatDmSpace: "spaces/direct-oezen",
      notificationsEnabled: true,
      googleChatReady: true,
      administratorAccess: { eligible: false, active: false, expiresAt: null },
    },
  ],
  githubProject: { id: "findmydoc-founder-execution", owner: "findmydoc-platform", number: 7 },
  notificationEvents: [
    {
      id: 103,
      type: "sprint_update",
      actorProfileId: "volkan",
      actorLabel: "Volkan Özkan",
      recipientProfileId: "sebastian",
      entityType: "sprint",
      entityId: "2026-39",
      title: "Sprint-Update",
      body: "Der aktuelle Sprint wurde aktualisiert.",
      targetPath: "/sprint",
      status: "sent",
      seenAt: "",
      dismissedAt: "",
      resolvedAt: "",
      resolutionReason: "",
      createdAt: "2026-09-22T10:14:00.000Z",
    },
    {
      id: 102,
      type: "delivery_failure",
      actorProfileId: "sebastian",
      actorLabel: "Sebastian Schütze",
      recipientProfileId: "volkan",
      entityType: "task",
      entityId: "website-search",
      title: "Fehlerhinweis: Website-Suche",
      body: "Die Nachricht konnte nicht zugestellt werden.",
      targetPath: "/planning",
      status: "failed",
      seenAt: "",
      dismissedAt: "",
      resolvedAt: "",
      resolutionReason: "",
      createdAt: "2026-09-22T09:03:00.000Z",
    },
    {
      id: 101,
      type: "release_available",
      actorProfileId: "sebastian",
      actorLabel: "Sebastian Schütze",
      recipientProfileId: "oezen",
      entityType: "release",
      entityId: "v0.45.0",
      title: "Release v0.45.0 verfügbar",
      body: "Eine neue Version ist verfügbar.",
      targetPath: "/releases",
      status: "sent",
      seenAt: "",
      dismissedAt: "",
      resolvedAt: "",
      resolutionReason: "",
      createdAt: "2026-09-21T16:27:00.000Z",
    },
  ],
  notificationDeliveries: [
    { id: 203, eventId: 103, channel: "google_chat", status: "sent", attempts: 1, target: "Sebastian", lastError: "", deliveryMode: "direct_dm", digestSize: 1, deliveredAt: "2026-09-22T10:14:05.000Z", createdAt: "2026-09-22T10:14:00.000Z" },
    { id: 202, eventId: 102, channel: "google_chat", status: "failed", attempts: 2, target: "Volkan", lastError: "Google Chat hat die Zustellung abgelehnt.", deliveryMode: "direct_dm", digestSize: 1, deliveredAt: "", createdAt: "2026-09-22T09:03:00.000Z" },
    { id: 201, eventId: 101, channel: "google_chat", status: "sent", attempts: 1, target: "Özen", lastError: "", deliveryMode: "direct_dm", digestSize: 1, deliveredAt: "2026-09-21T16:27:04.000Z", createdAt: "2026-09-21T16:27:00.000Z" },
  ],
  integrationStatus: {
    githubApp: {
      available: true,
      state: "ready",
      description: "Die GitHub App ist erreichbar und die Installation ist verfügbar.",
      nextStep: "",
    },
    googleChat: { ready: true, webhookConfigured: true, apiConfigured: true, deliveryEnabled: true, mode: "direct-dm" },
    pendingDeliveries: 2,
    failedDeliveries: 1,
  },
};

const model = administrationStoryModel;

function AdministrationStory({ initialModel = model }: { initialModel?: AdministrationWorkspaceModel }) {
  const [activeTab, setActiveTab] = useState<AdministrationTab>("people");
  const [storyModel, setStoryModel] = useState(initialModel);
  return (
    <main className="min-h-screen bg-[#f4f7fb] px-4 py-6 text-slate-950 sm:px-8 lg:px-12">
      <div className="mx-auto grid max-w-[1184px] gap-4">
        <AdministrationWorkspaceTemplate activeTab={activeTab} visibleTabs={["overview", "people", "integrations"]} onTabChange={setActiveTab}>
          {activeTab === "overview" && <AdministrationOverview model={storyModel} onNavigate={setActiveTab} onRefresh={fn()} />}
          {activeTab === "people" && (
            <PeopleAccessAdministration
              busy={false}
              model={storyModel}
              showTechnicalIdentity
              onSavePerson={async (profileId, patch) => setStoryModel((current) => ({
                ...current,
                people: current.people.map((person) => person.id === profileId ? {
                  ...person,
                  ...patch.technicalIdentity,
                  administratorAccess: { ...person.administratorAccess, eligible: patch.eligible },
                } : person),
              }))}
            />
          )}
          {activeTab === "integrations" && (
            <IntegrationsDeliveryAdministration
              busy={false}
              model={storyModel}
              onDeliver={fn(async () => undefined)}
              onSaveGitHubProject={fn(async () => undefined)}
            />
          )}
        </AdministrationWorkspaceTemplate>
      </div>
    </main>
  );
}

const meta = {
  component: AdministrationStory,
  parameters: { layout: "fullscreen" },
  render: () => <AdministrationStory />,
  tags: ["layer:organism", "status:stable"],
  title: "Administration/Organisms/AdministrationWorkspace",
} satisfies Meta<typeof AdministrationStory>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ActiveAdministrator: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);

    await expect(canvas.queryByRole("columnheader", { name: "GitHub-Login" })).not.toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: /GitHub-Status für Sebastian Schütze: Aktiv.*GitHub-Login: SebastianSchuetze.*Zuletzt angemeldet am/ })).toBeInTheDocument();
    const peopleRegion = canvas.getByRole("region", { name: "Personen & Zugänge" });
    const regionScrollHeight = peopleRegion.scrollHeight;
    const pageScrollHeight = document.documentElement.scrollHeight;
    await userEvent.hover(canvas.getByRole("button", { name: /GitHub-Status für Özen Aksoy: Unvollständig/ }));
    const statusTooltip = await within(document.body).findByRole("tooltip");
    await expect(statusTooltip).toBeVisible();
    const tooltipBounds = statusTooltip.getBoundingClientRect();
    await expect(peopleRegion.scrollHeight).toBe(regionScrollHeight);
    await expect(document.documentElement.scrollHeight).toBe(pageScrollHeight);
    await expect(tooltipBounds.left).toBeGreaterThanOrEqual(0);
    await expect(tooltipBounds.top).toBeGreaterThanOrEqual(0);
    await expect(tooltipBounds.right).toBeLessThanOrEqual(window.innerWidth);
    await expect(tooltipBounds.bottom).toBeLessThanOrEqual(window.innerHeight);
    await userEvent.unhover(canvas.getByRole("button", { name: /GitHub-Status für Özen Aksoy: Unvollständig/ }));
    await userEvent.click(canvas.getByRole("button", { name: "Volkan Özkan" }));
    await expect(within(canvas.getByRole("complementary")).getByRole("heading", { name: "Volkan Özkan" })).toBeInTheDocument();
    const detail = within(canvas.getByRole("complementary"));
    await expect(detail.getByText("GitHub ist vorbereitet. Die erste erfolgreiche Anmeldung bei FounderOps steht noch aus.")).toBeInTheDocument();
    const eligibility = detail.getByRole("switch", { name: "Admin-Zugang berechtigt" });
    await userEvent.click(eligibility);
    await expect(eligibility).not.toBeChecked();
    await userEvent.click(detail.getByRole("button", { name: "Abbrechen" }));
    await expect(eligibility).toBeChecked();
    await userEvent.click(eligibility);
    await userEvent.click(detail.getByRole("button", { name: "Speichern" }));
    await expect(detail.getByRole("switch", { name: "Kein Admin-Zugang" })).not.toBeChecked();

    await userEvent.click(canvas.getByRole("tab", { name: "Übersicht" }));
    await expect(canvas.queryByRole("heading", { name: "Schnellzugriff" })).not.toBeInTheDocument();

    await userEvent.click(canvas.getByRole("tab", { name: "Integrationen & Zustellung" }));
    const githubAppStatus = canvas.getByRole("region", { name: "GitHub-App-Betriebsstatus" });
    await expect(within(githubAppStatus).getByText("Verfügbar")).toBeInTheDocument();
    await expect(within(githubAppStatus).getByText("Die GitHub App ist erreichbar und die Installation ist verfügbar.")).toBeInTheDocument();
    await expect(canvas.queryByText("Geprüft")).not.toBeInTheDocument();
    await expect(canvas.queryByText("Konfiguriert")).not.toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: "Erneut senden" })).toBeInTheDocument();
    await expect(canvas.queryByText("Konfiguration", { selector: "div" })).not.toBeInTheDocument();
    await expect(canvas.getByRole("button", { name: /Technische Details Testzustellung und Diagnose/ })).toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: /Technische Details Testzustellung und Diagnose/ }));
    await expect(canvas.getByRole("combobox", { name: "Empfänger für Test-DM" })).toBeInTheDocument();
  },
};

export const GitHubAppUnavailable: Story = {
  render: () => (
    <AdministrationStory
      initialModel={{
        ...administrationStoryModel,
        integrationStatus: {
          ...administrationStoryModel.integrationStatus,
          githubApp: {
            available: false,
            state: "unavailable",
            description: "Die GitHub-App-Installation ist momentan nicht erreichbar.",
            nextStep: "Installation, Berechtigungen und GitHub-Verfügbarkeit prüfen.",
          },
        },
      }}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("tab", { name: "Integrationen & Zustellung" }));
    const githubAppStatus = canvas.getByRole("region", { name: "GitHub-App-Betriebsstatus" });
    await expect(within(githubAppStatus).getByText("Nicht verfügbar")).toBeInTheDocument();
    await expect(within(githubAppStatus).getByText("Die GitHub-App-Installation ist momentan nicht erreichbar.")).toBeInTheDocument();
    await expect(within(githubAppStatus).getByText("Installation, Berechtigungen und GitHub-Verfügbarkeit prüfen.")).toBeInTheDocument();
    await expect(canvas.queryByText(/token=|\/private\/|upstream rejected/i)).not.toBeInTheDocument();
  },
};
