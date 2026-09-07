import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";
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

function client(version: Record<string, unknown> | null): BrowserApiClient {
  return {
    requestJson: async (input: RequestInfo | URL) => {
      const path = String(input);
      if (path === "/api/team-workweek/private-draft") {
        return response({
          editBase: { windows: publishedWindows },
          latestPublished: {
            id: "publication-1",
            effectiveFrom: "2026-09-07",
            status: "published",
            syncState: "confirmed",
            publicationRevision: 1,
            publishedAt: "2026-09-07T07:00:00.000Z",
            lastSyncAt: "2026-09-07T07:00:00.000Z",
            googleReconciliationState: "confirmed",
            lastGoogleReconciliationAt: "2026-09-07T07:00:00.000Z",
          },
          minimumEffectiveFrom: "2026-09-14",
          publication: null,
          version,
        });
      }
      if (path === "/api/team-workweek/conflict") return response({ conflict: null });
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
  tags: ["layer:molecule", "status:stable"],
  title: "Team Workweek/Molecules/PrivateTeamWorkweekCard",
} satisfies Meta<typeof PrivateTeamWorkweekCard>;

export default meta;
type Story = StoryObj<typeof meta>;

export const PrefillsThePublishedWorkweek: Story = {
  args: { apiClient: client(null), profile },
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
    apiClient: client({
      id: "private-1",
      effectiveFrom: "2026-09-21",
      timezone: "Europe/Berlin",
      status: "preparing",
      createdAt: "2026-09-07T08:00:00.000Z",
      windows: { ...publishedWindows, monday: [{ start: "08:00", end: "12:00" }] },
    }),
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
