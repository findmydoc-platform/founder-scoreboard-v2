import { HeaderCalendarAction } from "../molecules/header-calendar-action";
import { PublishedTeamWorkweeksCard } from "@/features/team-workweek/molecules/published-team-workweeks-card";
import { useCalendarPlanningState } from "../../../../tests/helpers/workweek-calendar-owner";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { useState } from "react";
import { addCalendarDays, addCalendarMonths, berlinDateKey, firstCalendarDayOfMonth, calendarGridRange } from "@/features/team-workweek/model/team-workweek-calendar";
import { useHeaderCalendar } from "../hooks/use-header-calendar";
import type { BrowserApiClient } from "@/lib/browser-api-client";
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


function HookDialog({ apiClient }: { apiClient: BrowserApiClient }) {
  const planningState = useCalendarPlanningState(apiClient, [profile]);
  const calendar = useHeaderCalendar({ planningState, onOpenTeam: fn() });
  return <>
    <button onClick={calendar.openCalendar}>Kalender öffnen</button>
    {calendar.open && <HeaderCalendarDialog
      activeTab={calendar.activeTab} anchor={{ right: 12, top: 12 }}
      workweekCoverage={planningState.workweekCalendar({ policy: "header-month", ...calendarGridRange(calendar.viewMonth) }).coverage}
      calendarWorkweeks={calendar.calendarWorkweeks} workweeksByDay={calendar.workweeksByDay} desktopPopover={false}
      eventSlot={{ data: [], error: "", state: "ready" }} message={calendar.message}
      now={calendar.now} onActiveTabChange={calendar.setActiveTab} onClose={calendar.closeCalendar}
      onOpenTeam={calendar.openTeamWorkspace} onSelectedDateChange={calendar.setSelectedDate}
      onViewMonthChange={calendar.setViewMonth} pending={calendar.pending} profiles={[profile]}
      restoreFocusRef={{ current: null }} selectedDate={calendar.selectedDate} showWorkweek
      viewMonth={calendar.viewMonth} workweekDateKey={calendar.workweekReferenceDate} workweeks={calendar.workweeks}
    />}
  </>;
}

function calendarClient(mode: "refresh-failure" | "activation" | "publication"): BrowserApiClient {
  let reads = 0;
  let activationAt: string | undefined;
  return { requestJson: async () => {
    reads += 1;
    activationAt ||= new Date(Date.now() + 120_000).toISOString();
    if (mode === "refresh-failure" && reads > 1) return {
      response: new Response(null, { status: 503 }), body: { error: "Arbeitszeiten konnten nicht geladen werden." },
    };
    const visible = mode === "activation" ? Date.now() >= Date.parse(activationAt) : mode !== "publication" || reads > 1;
    const schedule = {
      id: "loaded", ownerProfileId: profile.id, effectiveFrom: "2020-01-01", effectiveTo: null,
      timezone: "Europe/Berlin", publicationRevision: 1, lastSyncAt: null,
      windows: { ...emptyWindows, monday: [{ start: "09:00", end: "17:00" }] },
    };
    return { response: new Response(null, { status: 200 }), body: {
      currentWorkweeks: visible ? [schedule] : [], calendarWorkweeks: visible ? [schedule] : [],
      referenceDate: "2026-10-16", workweeks: mode === "activation" ? [{ effectiveAt: activationAt }] : [],
    } };
  } } as unknown as BrowserApiClient;
}

export const HookRetainsConfirmedHoursOnFailedPublicationRefresh: Story = {
  render: () => <HookDialog apiClient={calendarClient("refresh-failure")} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Kalender öffnen" }));
    await userEvent.click(canvas.getByRole("tab", { name: "Arbeitswoche" }));
    await canvas.findAllByText("09:00–17:00");
    window.dispatchEvent(new Event("founderops:team-workweek-published"));
    await expect(await canvas.findByText("Aktualisierung verzögert. Zuletzt bestätigte Zeiten.")).toBeVisible();
    await expect(canvas.getAllByText("09:00–17:00").length).toBeGreaterThan(0);
  },
};

export const HookRefreshesPublishedHours: Story = {
  render: () => <HookDialog apiClient={calendarClient("publication")} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Kalender öffnen" }));
    await userEvent.click(canvas.getByRole("tab", { name: "Arbeitswoche" }));
    await canvas.findAllByText("Noch nicht veröffentlicht");
    window.dispatchEvent(new Event("founderops:team-workweek-published"));
    await canvas.findAllByText("09:00–17:00");
  },
};

let crossActivationBoundary: () => void;

export const HookRefreshesAtActivation: Story = {
  beforeEach: () => {
    const initialTime = Date.now();
    const nativeTimeout = window.setTimeout.bind(window);
    const nativeClearTimeout = window.clearTimeout.bind(window);
    const scheduled = new Map<number, { due: number; run: () => void }>();
    const nativeNow = Date.now;
    const originalTimeout = window.setTimeout;
    let clockTime = initialTime;
    Date.now = () => clockTime;
    // Control long browser deadlines while leaving interaction and polling timers real.
    window.setTimeout = ((handler: TimerHandler, delay = 0, ...args: unknown[]) => {
      if (typeof handler !== "function" || delay < 60_000) return nativeTimeout(handler, delay, ...args);
      const id = nativeTimeout(() => {}, 2_147_483_647);
      scheduled.set(id, { due: Date.now() + delay, run: () => handler(...args) });
      return id;
    }) as typeof window.setTimeout;
    crossActivationBoundary = () => {
      const advancedTime = initialTime + 180_000;
      clockTime = advancedTime;
      for (const [id, timer] of scheduled) {
        if (timer.due > advancedTime) continue;
        scheduled.delete(id);
        nativeClearTimeout(id);
        timer.run();
      }
    };
    return () => {
      for (const id of scheduled.keys()) nativeClearTimeout(id);
      window.setTimeout = originalTimeout;
      Date.now = nativeNow;
    };
  },
  render: () => <HookDialog apiClient={calendarClient("activation")} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Kalender öffnen" }));
    await userEvent.click(canvas.getByRole("tab", { name: "Arbeitswoche" }));
    await canvas.findAllByText("Noch nicht veröffentlicht");
    crossActivationBoundary();
    await waitFor(() => expect(canvas.getAllByText("09:00–17:00").length).toBeGreaterThan(0));
  },
};


function outOfOrderClient(): BrowserApiClient {
  let reads = 0;
  return { requestJson: async () => {
    const first = ++reads === 1;
    if (first) await new Promise<void>((resolve) => window.addEventListener("fixture:release-calendar", () => resolve(), { once: true }));
    const schedule = {
      id: "range", ownerProfileId: profile.id, effectiveFrom: "2020-01-01", effectiveTo: null,
      timezone: "Europe/Berlin", publicationRevision: 1, lastSyncAt: null,
      windows: { ...emptyWindows, monday: [{ start: first ? "09:00" : "11:00", end: "17:00" }] },
    };
    return { response: new Response(null, { status: 200 }), body: {
      currentWorkweeks: [schedule], calendarWorkweeks: [schedule], referenceDate: "2026-10-16",
    } };
  } } as unknown as BrowserApiClient;
}

export const HookIgnoresAnOlderMonthResponse: Story = {
  render: () => <HookDialog apiClient={outOfOrderClient()} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Kalender öffnen" }));
    await canvas.findByText("Arbeitszeiten werden geladen.");
    await userEvent.click(canvas.getByRole("button", { name: "Nächster Monat" }));
    await userEvent.click(canvas.getByRole("tab", { name: "Arbeitswoche" }));
    await canvas.findAllByText("11:00–17:00");
    window.dispatchEvent(new Event("fixture:release-calendar"));
    // Let the released browser transport settle before checking the visible range.
    await new Promise((resolve) => window.setTimeout(resolve, 0));
    await expect(canvas.queryByText("09:00–17:00")).not.toBeInTheDocument();
    await expect(canvas.getAllByText("11:00–17:00").length).toBeGreaterThan(0);
  },
};


export const HookRejectsMissingSelectedRangeProjection: Story = {
  render: () => <HookDialog apiClient={{ requestJson: async () => ({
    response: new Response(null, { status: 200 }), body: { currentWorkweeks: [], referenceDate: "2026-10-16" },
  }) } as unknown as BrowserApiClient} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Kalender öffnen" }));
    await userEvent.click(canvas.getByRole("tab", { name: "Arbeitswoche" }));
    await canvas.findAllByText("Arbeitszeiten konnten nicht geladen werden.");
    await expect(canvas.queryByText("Noch nicht veröffentlicht")).not.toBeInTheDocument();
  },
};

function firstMondayOfVisibleMonth() {
  const month = firstCalendarDayOfMonth(berlinDateKey());
  const weekday = new Date(`${month}T12:00:00Z`).getUTCDay();
  return addCalendarDays(month, (8 - weekday) % 7);
}

function retainedMonthClient(): BrowserApiClient {
  let reads = 0;
  const firstMonth = firstCalendarDayOfMonth(berlinDateKey());
  return { requestJson: async () => {
    reads += 1;
    if (reads > 2) return { response: new Response(null, { status: 503 }), body: { error: "Arbeitszeiten konnten nicht geladen werden." } };
    const month = reads === 1 ? firstMonth : addCalendarMonths(firstMonth, 1);
    const schedule = {
      id: month, ownerProfileId: profile.id,
      effectiveFrom: reads === 1 ? firstMondayOfVisibleMonth() : month,
      effectiveTo: reads === 1 ? addCalendarDays(firstMondayOfVisibleMonth(), 6) : addCalendarDays(addCalendarMonths(month, 1), -1),
      timezone: "Europe/Berlin", publicationRevision: 1, lastSyncAt: null,
      windows: { ...emptyWindows, monday: [{ start: reads === 1 ? "09:00" : "11:00", end: "17:00" }] },
    };
    return { response: new Response(null, { status: 200 }), body: {
      currentWorkweeks: [schedule], calendarWorkweeks: [schedule], referenceDate: firstMonth,
    } };
  } } as unknown as BrowserApiClient;
}

export const HookRetainsOtherMonthsWhenReturningDuringAnOutage: Story = {
  render: () => <HookDialog apiClient={retainedMonthClient()} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Kalender öffnen" }));
    const dayLabel = new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "2-digit", month: "long", timeZone: "UTC" }).format(new Date(`${firstMondayOfVisibleMonth()}T12:00:00Z`));
    await userEvent.click(canvas.getByRole("button", { name: new RegExp(`^${dayLabel},`) }));
    await userEvent.click(canvas.getByRole("tab", { name: "Arbeitswoche" }));
    await canvas.findAllByText("09:00–17:00");
    await userEvent.click(canvas.getByRole("tab", { name: "Termine" }));
    await userEvent.click(canvas.getByRole("button", { name: "Nächster Monat" }));
    await userEvent.click(canvas.getByRole("tab", { name: "Arbeitswoche" }));
    await userEvent.click(canvas.getByRole("button", { name: "Nächste Woche" }));
    await canvas.findAllByText("11:00–17:00");
    await userEvent.click(canvas.getByRole("tab", { name: "Termine" }));
    await userEvent.click(canvas.getByRole("button", { name: "Vorheriger Monat" }));
    await userEvent.click(canvas.getByRole("button", { name: new RegExp(`^${dayLabel},`) }));
    await userEvent.click(canvas.getByRole("tab", { name: "Arbeitswoche" }));
    await canvas.findByText("Aktualisierung verzögert. Zuletzt bestätigte Zeiten.");
    await expect(canvas.getAllByText("09:00–17:00").length).toBeGreaterThan(0);
    await expect(canvas.queryByText("11:00–17:00")).not.toBeInTheDocument();
  },
};


let denySharedCalendar: () => void;
function SharedCalendarFixture() {
  const monday = firstMondayOfVisibleMonth();
  const [apiClient] = useState(() => {
    let reads = 0;
    let denied = false;
    denySharedCalendar = () => { denied = true; window.dispatchEvent(new Event("founderops:team-workweek-published")); };
    return { requestJson: async () => {
      if (denied) return { response: new Response(null, { status: 403 }), body: { error: "Kalenderzugriff entzogen." } };
      const schedule = { id: "shared-publication", ownerProfileId: profile.id, effectiveFrom: monday, effectiveTo: null, timezone: "Europe/Berlin", publicationRevision: ++reads, lastSyncAt: "2026-10-01T07:00:00Z", windows: { ...emptyWindows, monday: [{ start: reads === 1 ? "09:00" : "11:00", end: "17:00" }] } };
      return { response: new Response(null, { status: 200 }), body: { currentWorkweeks: [schedule], calendarWorkweeks: [schedule], publishedOwnerIds: [profile.id], referenceDate: berlinDateKey() } };
    } } as unknown as BrowserApiClient;
  });
  const planningState = useCalendarPlanningState(apiClient, [profile]);
  return <><HeaderCalendarAction planningState={planningState} events={{ data: [], state: "ready" }} profiles={[profile]} onOpenTeam={fn()} /><PublishedTeamWorkweeksCard planningState={planningState} profiles={[profile]} initialDate={monday} /></>;
}
export const SharesHeaderAndTeamPublicationsAndWithholdsDeniedScopes: Story = {
  render: () => <SharedCalendarFixture />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const body = within(canvasElement.ownerDocument.body);
    await canvas.findAllByText("09:00–17:00");
    await userEvent.click(canvas.getByRole("button", { name: "Kalender öffnen" }));
    await waitFor(() => expect(canvas.getAllByText("11:00–17:00").length).toBeGreaterThan(0));
    await expect(canvas.queryByText("09:00–17:00")).not.toBeInTheDocument();
    await body.findByRole("dialog", { name: "Kalender" });
    const label = new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "2-digit", month: "long", timeZone: "UTC" }).format(new Date(`${firstMondayOfVisibleMonth()}T12:00:00Z`));
    await userEvent.click(body.getByRole("button", { name: new RegExp(`^${label},`) }));
    await expect(within(body.getByRole("dialog", { name: "Kalender" })).getByText("11:00–17:00")).toBeVisible();
    await expect(body.getByRole("button", { name: new RegExp(`^${label},`) })).toHaveAccessibleName(/1 eingeplant/);
    denySharedCalendar();
    await waitFor(() => expect(body.queryAllByText("11:00–17:00")).toHaveLength(0));
    await expect(body.getAllByText("Kein Zugriff auf veröffentlichte Arbeitszeiten.").length).toBeGreaterThan(0);
    await expect(body.getByRole("button", { name: new RegExp(`^${label},`) })).not.toHaveAccessibleName(/\d+ eingeplant/);
  },
};

function publicationCountClient(mode: "complete-empty" | "complete" | "partial" | "unavailable"): BrowserApiClient {
  return { requestJson: async () => {
    if (mode === "unavailable") return { response: new Response(null, { status: 503 }), body: { error: "Arbeitszeiten konnten nicht geladen werden." } };
    const schedule = { id: "count-publication", ownerProfileId: profile.id, effectiveFrom: "2020-01-01", effectiveTo: null, timezone: "Europe/Berlin", publicationRevision: 1, lastSyncAt: null, windows: { ...emptyWindows, monday: [{ start: "09:00", end: "17:00" }] } };
    const rows = mode === "complete-empty" ? [] : [schedule];
    return { response: new Response(null), body: { currentWorkweeks: rows, calendarWorkweeks: rows, calendarCoverage: mode === "partial" ? "partial" : "complete", referenceDate: berlinDateKey() } };
  } } as unknown as BrowserApiClient;
}
async function openCountDay(canvasElement: HTMLElement) {
  const canvas = within(canvasElement);
  await userEvent.click(canvas.getByRole("button", { name: "Kalender öffnen" }));
  const label = new Intl.DateTimeFormat("de-DE", { weekday: "long", day: "2-digit", month: "long", timeZone: "UTC" }).format(new Date(`${firstMondayOfVisibleMonth()}T12:00:00Z`));
  const day = await canvas.findByRole("button", { name: new RegExp(`^${label},`) });
  await userEvent.click(day);
  return { canvas, day };
}
export const PreservesAuthoritativeCompleteEmptyDayCount: Story = {
  render: () => <HookDialog apiClient={publicationCountClient("complete-empty")} />,
  play: async ({ canvasElement }) => {
    const { canvas, day } = await openCountDay(canvasElement);
    await waitFor(() => expect(day).toHaveAccessibleName(/0 eingeplant/));
    await expect(canvas.getByText("Niemand eingeplant.")).toBeVisible();
  },
};
export const PreservesAuthoritativeCompleteDayCount: Story = {
  render: () => <HookDialog apiClient={publicationCountClient("complete")} />,
  play: async ({ canvasElement }) => {
    const { canvas, day } = await openCountDay(canvasElement);
    await canvas.findByText("09:00–17:00");
    await expect(day).toHaveAccessibleName(/1 eingeplant/);
  },
};
export const PartialPublicationKeepsKnownHoursWithoutAnExactCount: Story = {
  render: () => <HookDialog apiClient={publicationCountClient("partial")} />,
  play: async ({ canvasElement }) => {
    const { canvas, day } = await openCountDay(canvasElement);
    await canvas.findByText("09:00–17:00");
    await expect(day).not.toHaveAccessibleName(/\d+ eingeplant/);
    await expect(canvas.queryByText("Niemand eingeplant.")).not.toBeInTheDocument();
  },
};
export const UnavailablePublicationDoesNotClaimZeroPlannedPeople: Story = {
  render: () => <HookDialog apiClient={publicationCountClient("unavailable")} />,
  play: async ({ canvasElement }) => {
    const { canvas, day } = await openCountDay(canvasElement);
    await canvas.findByText("Arbeitszeiten konnten nicht geladen werden.");
    await expect(day).not.toHaveAccessibleName(/\d+ eingeplant/);
    await expect(canvas.queryByText("Niemand eingeplant.")).not.toBeInTheDocument();
  },
};
