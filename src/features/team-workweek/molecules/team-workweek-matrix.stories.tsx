import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, within } from "storybook/test";
import { TeamWorkweekMatrix } from "./team-workweek-matrix";

const meta = {
  component: TeamWorkweekMatrix,
  tags: ["layer:molecule", "status:stable"],
  title: "Team Workweek/Molecules/TeamWorkweekMatrix",
} satisfies Meta<typeof TeamWorkweekMatrix>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ShowsTheCurrentPublishedWorkweek: Story = {
  args: {
    dateKey: "2026-09-07",
    profiles: [{
      id: "sebastian",
      name: "Sebastian",
      role: "member",
      platformRole: "ceo",
      orgRole: "CEO",
      githubLogin: "sebastian",
      weeklyCapacity: 40,
      color: "#2563eb",
    }],
    workweeks: [{
      id: "current-publication",
      ownerProfileId: "sebastian",
      effectiveFrom: "2026-09-07",
      effectiveTo: null,
      timezone: "Europe/Berlin",
      publicationRevision: 4,
      lastSyncAt: "2026-09-07T07:00:00.000Z",
      windows: {
        monday: [{ start: "09:00", end: "17:00" }],
        tuesday: [{ start: "09:00", end: "17:00" }],
        wednesday: [{ start: "09:00", end: "17:00" }],
        thursday: [{ start: "09:00", end: "17:00" }],
        friday: [{ start: "09:00", end: "14:00" }],
        saturday: [],
        sunday: [],
      },
    }],
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByText("09:00–17:00").length).toBeGreaterThan(0);
    await expect(canvas.getAllByText("Frei").length).toBeGreaterThan(0);
  },
};
