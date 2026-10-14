import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";
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
      platformRole: "ceo",
      orgRole: "CEO",
      githubLogin: "sebastian",
      weeklyCapacity: 40,
      color: "#2563eb",
    }, {
      id: "ozan",
      name: "Ozan",
      platformRole: "founder",
      orgRole: "Founder",
      githubLogin: "ozan",
      weeklyCapacity: 40,
      color: "#ef4444",
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
    await expect(canvas.getAllByText("Kein Arbeitszeitfenster").length).toBeGreaterThan(0);
    await expect(canvas.getAllByText("Keine veröffentlichten Arbeitszeiten").length).toBeGreaterThan(0);
    await expect(canvas.queryByText("Frei")).not.toBeInTheDocument();
  },
};

export const KeepsMobileDaySelectionAndMissingSchedulesDistinct: Story = {
  args: ShowsTheCurrentPublishedWorkweek.args,
  parameters: { viewport: { defaultViewport: "mobile1" } },
  globals: { viewport: { value: "mobile1" } },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const saturday = canvas.getByRole("tab", { name: "Samstag" });
    await userEvent.click(saturday);
    const panel = within(canvas.getByRole("tabpanel"));
    await expect(panel.getByText("Kein Arbeitszeitfenster")).toBeVisible();
    await expect(panel.getByText("Keine veröffentlichten Arbeitszeiten")).toBeVisible();
    await userEvent.keyboard("{ArrowRight}");
    await expect(canvas.getByRole("tab", { name: "Sonntag" })).toHaveFocus();
  },
};
