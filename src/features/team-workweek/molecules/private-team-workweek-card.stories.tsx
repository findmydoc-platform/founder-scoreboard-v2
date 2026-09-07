import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { PrivateTeamWorkweekCard } from "./private-team-workweek-card";
import type { BrowserApiClient } from "@/lib/browser-api-client";

const profile = {
  id: "sebastian",
  name: "Sebastian",
  role: "member" as const,
  platformRole: "ceo" as const,
  orgRole: "CEO",
  githubLogin: "sebastian",
  weeklyCapacity: 40,
  color: "#2563eb",
};

const publishedWindows = {
  monday: [{ start: "09:00", end: "17:00" }],
  tuesday: [],
  wednesday: [],
  thursday: [],
  friday: [],
  saturday: [],
  sunday: [],
};

function response(body: unknown) {
  return { body, response: new Response(null, { status: 200 }) };
}

const latestPublished = {
  id: "publication-1",
  effectiveFrom: "2026-09-07",
  status: "published",
  syncState: "confirmed",
  publicationRevision: 1,
  publishedAt: "2026-09-07T07:00:00.000Z",
  lastSyncAt: "2026-09-07T07:00:00.000Z",
  googleReconciliationState: "confirmed",
  lastGoogleReconciliationAt: "2026-09-07T07:00:00.000Z",
};

type ClientOptions = {
  editBase?: { windows: typeof publishedWindows } | null;
  latestPublished?: Record<string, unknown> | null;
  publication?: Record<string, unknown> | null;
  publish?: {
    after: Record<string, unknown>;
    result: Record<string, unknown>;
  };
  version?: Record<string, unknown> | null;
};

function client(options: ClientOptions = {}): BrowserApiClient {
  let privateBody = {
    editBase: options.editBase === undefined ? { windows: publishedWindows } : options.editBase,
    latestPublished: options.latestPublished === undefined ? latestPublished : options.latestPublished,
    minimumEffectiveFrom: "2026-09-14",
    publication: options.publication || null,
    version: options.version || null,
  };
  return {
    requestJson: async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === "/api/team-workweek/private-draft") return response(privateBody);
      if (path === "/api/team-workweek/conflict") return response({ conflict: null });
      if (path === "/api/team-workweek/publish" && options.publish) {
        privateBody = options.publish.after as typeof privateBody;
        return response({ publication: options.publish.result });
      }
      if (path === "/api/google-workspace/status") {
        return response({ connection: { state: "not_connected", connectedAt: null, refreshedAt: null, lastUsedAt: null, accessTokenExpiresAt: null } });
      }
      if (path === "/api/google-workspace/disconnect") {
        return response({ disconnect: { state: "idle", activePublicationCount: 0, futureSeriesCount: 0, pendingSeriesCount: 0, teamVisibilityWillBeDisabled: false, connectionWillBeRevoked: true } });
      }
      throw new Error(`Unexpected request: ${path}`);
    },
  } as unknown as BrowserApiClient;
}

const meta = {
  component: PrivateTeamWorkweekCard,
  parameters: { viewport: { defaultViewport: "mobile1" } },
  tags: ["layer:molecule", "status:stable"],
  title: "Team Workweek/Molecules/PrivateTeamWorkweekCard",
} satisfies Meta<typeof PrivateTeamWorkweekCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const PrefillsThePublishedWorkweek: Story = {
  args: { apiClient: client(), profile },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Arbeitswoche bearbeiten" }));
    await expect(await canvas.findByLabelText("Montag, Fenster 1, Beginn")).toHaveValue("09:00");
    await expect(canvas.getByLabelText("Montag, Fenster 1, Ende")).toHaveValue("17:00");
    await expect(canvas.getByLabelText("Gültigkeitsbeginn der Arbeitswoche")).toHaveTextContent("14");
  },
};

export const ContinuesThePrivateDraft: Story = {
  args: {
    apiClient: client({ version: {
        id: "private-1",
        effectiveFrom: "2026-09-21",
        timezone: "Europe/Berlin",
        status: "preparing",
        createdAt: "2026-09-07T08:00:00.000Z",
        windows: { ...publishedWindows, monday: [{ start: "08:00", end: "12:00" }] },
      } }),
    profile,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Bearbeitung fortsetzen" }));
    await expect(await canvas.findByLabelText("Montag, Fenster 1, Beginn")).toHaveValue("08:00");
    await expect(canvas.getByLabelText("Montag, Fenster 1, Ende")).toHaveValue("12:00");
    await expect(canvas.getByLabelText("Gültigkeitsbeginn der Arbeitswoche")).toHaveTextContent("21");
  },
};

export const StartsTheFirstWorkweekEmpty: Story = {
  args: { apiClient: client({ editBase: null, latestPublished: null }), profile },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Arbeitswoche einrichten" }));
    await expect((await canvas.findAllByText("Freier Tag")).length).toBeGreaterThan(0);
    await expect(canvas.queryByLabelText("Montag, Fenster 1, Beginn")).not.toBeInTheDocument();
    await expect(canvas.getByLabelText("Gültigkeitsbeginn der Arbeitswoche")).toHaveTextContent("14");
  },
};

export const ShowsDelayedSynchronizationWithoutReplacingTheTeamState: Story = {
  args: {
    apiClient: client({
      publication: {
        ...latestPublished,
        id: "preparing-publication",
        status: "preparing",
        syncState: "delayed",
      },
      version: {
        id: "private-1",
        effectiveFrom: "2026-09-21",
        timezone: "Europe/Berlin",
        status: "preparing",
        createdAt: "2026-09-07T08:00:00.000Z",
        windows: { ...publishedWindows, monday: [{ start: "08:00", end: "12:00" }] },
      },
    }),
    profile,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(await canvas.findByRole("button", { name: "Bearbeitung fortsetzen" }));
    await expect((await canvas.findAllByText("Synchronisierung verzögert")).length).toBeGreaterThan(0);
    await expect(canvas.getByText(/Bisheriger Teamstand sichtbar/)).toBeInTheDocument();
  },
};

export const PublishesOnlyAfterProviderConfirmation: Story = {
  args: {
    apiClient: client({
      publish: {
        after: {
          editBase: { windows: publishedWindows },
          latestPublished: { ...latestPublished, id: "publication-2", effectiveFrom: "2026-09-21", publicationRevision: 2 },
          minimumEffectiveFrom: "2026-09-28",
          publication: null,
          version: null,
        },
        result: {
          id: "publication-2",
          status: "published",
          syncState: "confirmed",
          publicationRevision: 2,
          publishedAt: "2026-09-07T09:00:00.000Z",
          lastSyncAt: "2026-09-07T09:00:00.000Z",
          recovery: null,
        },
      },
      version: {
        id: "private-2",
        effectiveFrom: "2026-09-21",
        timezone: "Europe/Berlin",
        status: "preparing",
        createdAt: "2026-09-07T08:00:00.000Z",
        windows: publishedWindows,
      },
    }),
    profile,
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const published = fn();
    window.addEventListener("founderops:team-workweek-published", published, { once: true });
    await userEvent.click(await canvas.findByRole("button", { name: "Bearbeitung fortsetzen" }));
    await userEvent.click(await canvas.findByRole("button", { name: "Änderung in Google & Team veröffentlichen" }));
    await expect(published).toHaveBeenCalledOnce();
    await expect(canvas.queryByRole("dialog", { name: "Meine Arbeitswoche bearbeiten" })).not.toBeInTheDocument();
    await expect(canvas.getByText(/gültig ab 21\. Sept\./)).toBeInTheDocument();
  },
};
