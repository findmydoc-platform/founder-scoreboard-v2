import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, waitFor, within } from "storybook/test";
import { PublishedTeamWorkweeksCard } from "./published-team-workweeks-card";
import type { BrowserApiClient } from "@/lib/browser-api-client";

const profile = { id: "sebastian", name: "Sebastian", platformRole: "ceo" as const, orgRole: "CEO", githubLogin: "sebastian", weeklyCapacity: 40, color: "#2563eb" };
const workweek = {
  id: "confirmed", ownerProfileId: profile.id, effectiveFrom: "2026-09-07", effectiveTo: null,
  timezone: "Europe/Berlin", publicationRevision: 1, lastSyncAt: "2026-09-07T07:00:00.000Z",
  windows: { monday: [{ start: "09:00", end: "17:00" }], tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [], sunday: [] },
};
function client(failInitially: boolean): BrowserApiClient {
  let loaded = false;
  return {
    requestJson: async () => {
      if (failInitially || loaded) return { response: new Response(null, { status: 503 }), body: { error: "Arbeitszeiten konnten nicht geladen werden." } };
      loaded = true;
      return { response: new Response(null, { status: 200 }), body: { currentWorkweeks: [workweek], referenceDate: "2026-09-07" } };
    },
  } as unknown as BrowserApiClient;
}
const meta = {
  component: PublishedTeamWorkweeksCard,
  title: "Team Workweek/Molecules/PublishedTeamWorkweeksCard",
  tags: ["layer:molecule", "status:stable"],
} satisfies Meta<typeof PublishedTeamWorkweeksCard>;
export default meta;
type Story = StoryObj<typeof meta>;

export const KeepsInitialFailureSeparateFromMissingHours: Story = {
  args: { apiClient: client(true), profiles: [profile] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("Arbeitszeiten konnten nicht geladen werden.")).toBeVisible();
    await expect(canvas.queryByText("Keine veröffentlichten Arbeitszeiten")).not.toBeInTheDocument();
  },
};
export const RetainsAndNamesTheLastConfirmedScheduleAfterAnUpdateFails: Story = {
  args: { apiClient: client(false), profiles: [profile] },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await canvas.findAllByText("09:00–17:00");
    window.dispatchEvent(new Event("founderops:team-workweek-published"));
    await expect(await canvas.findByText("Aktualisierung verzögert. Zuletzt bestätigte Zeiten.")).toBeVisible();
    await waitFor(() => expect(canvas.getAllByText("09:00–17:00").length).toBeGreaterThan(0));
    await expect(canvas.queryByText("Keine veröffentlichten Arbeitszeiten")).not.toBeInTheDocument();
  },
};
