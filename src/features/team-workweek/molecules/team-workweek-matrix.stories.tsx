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
    await expect(canvas.getAllByText("Noch nicht veröffentlicht").length).toBeGreaterThan(0);
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
    await expect(panel.getByText("Noch nicht veröffentlicht")).toBeVisible();
    await userEvent.keyboard("{ArrowRight}");
    await expect(canvas.getByRole("tab", { name: "Sonntag" })).toHaveFocus();
  },
};

export const PreservesBothSidesOfAChangeInsideTheWeek: Story = {
  parameters: {viewport:{defaultViewport:"mobile1"}},
  globals:{viewport:{value:"mobile1"}},
  args:{dateKey:"2026-10-14",profiles:ShowsTheCurrentPublishedWorkweek.args!.profiles,
    workweeks:[
      {...ShowsTheCurrentPublishedWorkweek.args!.workweeks![0],id:"before",effectiveFrom:"2026-10-12",effectiveUntil:"2026-10-14T10:00:00Z",effectiveTo:"2026-10-14"},
      {...ShowsTheCurrentPublishedWorkweek.args!.workweeks![0],id:"after",effectiveFrom:"2026-10-12",effectiveAt:"2026-10-14T10:00:00Z",publicationRevision:5},
    ]},
  play:async({canvasElement})=>{
    const canvas=within(canvasElement);
    const panel=within(canvas.getByRole("tabpanel"));
    await expect(panel.getByText("09:00–12:00")).toBeVisible();
    await expect(panel.getByText("12:00–17:00")).toBeVisible();
    await userEvent.click(canvas.getByRole("tab",{name:"Montag"}));
    await expect(panel.getByText("09:00–17:00")).toBeVisible();
    await expect(panel.queryByText("12:00–17:00")).not.toBeInTheDocument();
  },
};

export const KeepsEmptyDayLabelsInsideCompactCells: Story = {
  args: { ...ShowsTheCurrentPublishedWorkweek.args, compact: true },
  render: (args) => <div style={{ width: 900, maxWidth: "100vw" }}><TeamWorkweekMatrix {...args} /></div>,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const table = canvas.getByRole("table");
    const emptyCells = within(table).getAllByRole("cell", { name: "Kein Arbeitszeitfenster" });
    for (const cell of emptyCells) {
      const textRange = document.createRange();
      textRange.selectNodeContents(cell);
      for (const rect of Array.from(textRange.getClientRects())) {
        await expect(rect.right).toBeLessThanOrEqual(cell.getBoundingClientRect().right);
      }
    }
  },
};
