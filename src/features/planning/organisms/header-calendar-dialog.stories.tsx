import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { useState } from "react";
import { HeaderCalendarDialog } from "./header-calendar-dialog";

const profile = {
  id: "sebastian",
  name: "Sebastian",
  platformRole: "ceo" as const,
  orgRole: "CEO",
  githubLogin: "sebastian",
  weeklyCapacity: 40,
  color: "#2563eb",
};

const emptyWindows = {
  monday: [],
  tuesday: [],
  wednesday: [],
  thursday: [],
  friday: [],
  saturday: [],
  sunday: [],
};

function StoryDialog() {
  const [selectedDate, setSelectedDate] = useState("2026-09-06");
  const [activeTab, setActiveTab] = useState<"events" | "workweek">("events");
  return (
    <HeaderCalendarDialog
      activeTab={activeTab}
      anchor={{ right: 12, top: 12 }}
      calendarWorkweeks={[
        {
          id: "historical",
          ownerProfileId: profile.id,
          effectiveFrom: "2026-08-31",
          effectiveTo: "2026-09-06",
          timezone: "Europe/Berlin",
          publicationRevision: 1,
          lastSyncAt: "2026-08-31T07:00:00.000Z",
          windows: { ...emptyWindows, sunday: [{ start: "08:00", end: "12:00" }] },
        },
        {
          id: "current",
          ownerProfileId: profile.id,
          effectiveFrom: "2026-09-07",
          effectiveTo: null,
          timezone: "Europe/Berlin",
          publicationRevision: 2,
          lastSyncAt: "2026-09-07T07:00:00.000Z",
          windows: { ...emptyWindows, monday: [{ start: "10:00", end: "18:00" }] },
        },
      ]}
      desktopPopover={false}
      eventSlot={{ data: [], error: "", state: "ready" }}
      message=""
      now={new Date("2026-09-07T10:00:00.000Z")}
      onActiveTabChange={setActiveTab}
      onClose={fn()}
      onOpenTeam={fn()}
      onSelectedDateChange={setSelectedDate}
      onViewMonthChange={fn()}
      pending={false}
      profiles={[profile]}
      restoreFocusRef={{ current: null }}
      selectedDate={selectedDate}
      showWorkweek
      viewMonth="2026-09-01"
      workweekDateKey="2026-09-07"
      workweeks={[{
        id: "current",
        ownerProfileId: profile.id,
        effectiveFrom: "2026-09-07",
        effectiveTo: null,
        timezone: "Europe/Berlin",
        publicationRevision: 2,
        lastSyncAt: "2026-09-07T07:00:00.000Z",
        windows: { ...emptyWindows, monday: [{ start: "10:00", end: "18:00" }] },
      }]}
    />
  );
}

const meta = {
  component: StoryDialog,
  parameters: { layout: "fullscreen", viewport: { defaultViewport: "mobile1" } },
  render: () => <StoryDialog />,
  tags: ["layer:organism", "status:stable"],
  title: "Planning/Organisms/HeaderCalendarDialog",
} satisfies Meta<typeof StoryDialog>;

export default meta;
type Story = StoryObj<typeof meta>;

export const KeepsTheSelectedWeekWhenChangingTabs: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByText("08:00–12:00")).toBeInTheDocument();
    await expect(canvas.getByText("geplant · keine Live-Präsenz")).toBeVisible();
    await userEvent.click(canvas.getByRole("tab", { name: "Arbeitswoche" }));
    await expect(canvas.getAllByText("08:00–12:00").length).toBeGreaterThan(0);
    await expect(canvas.queryByText("10:00–18:00")).not.toBeInTheDocument();
    await userEvent.click(canvas.getByRole("button", { name: "Nächste Woche" }));
    await expect(canvas.getAllByText("10:00–18:00").length).toBeGreaterThan(0);
  },
};

export const KeepsAnInitialLoadErrorDistinctFromNoPublication: Story = {
  render: () => (
    <HeaderCalendarDialog
      activeTab="workweek"
      anchor={{ right: 12, top: 12 }}
      calendarWorkweeks={[]}
      desktopPopover={false}
      eventSlot={{ data: [], error: "", state: "ready" }}
      message="Arbeitszeiten konnten nicht geladen werden."
      now={new Date("2026-09-07T10:00:00.000Z")}
      onActiveTabChange={fn()}
      onClose={fn()}
      onOpenTeam={fn()}
      onSelectedDateChange={fn()}
      onViewMonthChange={fn()}
      pending={false}
      profiles={[profile]}
      restoreFocusRef={{ current: null }}
      selectedDate="2026-09-07"
      showWorkweek
      viewMonth="2026-09-01"
      workweekDateKey="2026-09-07"
      workweeks={[]}
    />
  ),
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getAllByText("Arbeitszeiten konnten nicht geladen werden.").length).toBeGreaterThan(0);
    await expect(canvas.queryByText("Nicht veröffentlicht")).not.toBeInTheDocument();
  },
};
