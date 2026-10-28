import { useState, useSyncExternalStore } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { HeaderCalendarDialog } from "@/features/planning/organisms/header-calendar-dialog";
import { EventsOverview } from "./events-overview";
import { useFounderEventCommands } from "../hooks/use-founder-event-commands";
import { createPlanningState } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { emptyPlanningHeaderData, projectHeaderCalendarEvents, readyHeaderSlot } from "@/lib/planning-header-data";
import type { EventConfirmation, FounderEventDraft } from "../model/event-state";
import type { FounderEvent } from "@/lib/types";
const initial: FounderEvent = { id: 1, title: "Founder-Termin", category: "other", startsAt: "2099-01-10T10:00:00.000Z", endsAt: "", location: "Berlin", description: "", audienceMode: "all", participantProfileIds: [], reminderDaysBefore: 7, reminderGeneratedAt: "", status: "planned", createdBy: "profile", createdAt: "r1", updatedAt: "r1" };
function CoordinatedEvents() {
  const [server] = useState(() => {
    let resolve!: (value: EventConfirmation) => void, reject!: (error: Error) => void, submitted!: FounderEventDraft;
    const fixture = { events: [initial], writes: 0, reads: 0, write: (draft: FounderEventDraft) => { submitted = draft; fixture.writes++; return new Promise<EventConfirmation>((yes, no) => { resolve = yes; reject = no; }); }, confirm: () => { const event = { ...initial, ...submitted, id: 1, updatedAt: "r2" }; fixture.events = [event]; resolve({ event }); }, lose: () => reject(new Error("Verbindung unterbrochen")), fail: () => reject(Object.assign(new Error("Titel abgelehnt"), { status: 422 })), newer: () => { fixture.events = [{ ...initial, title: "Fremder Serverstand", updatedAt: "foreign" }]; } };
    return fixture;
  });
  const [owner] = useState(() => createPlanningState({ userId: "event-story", initialWorkspace: "events", initialData: { ...emptyPlanningShellState, events: [initial] }, initialHeaderData: { ...emptyPlanningHeaderData, calendarEvents: readyHeaderSlot(projectHeaderCalendarEvents([initial])) }, adapter: {
    saveTask: async () => ({ task: {} }), readWorkspace: async () => null, updateEvent: (_basis, draft) => server.write(draft), createEvent: server.write,
    readEvents: async range => { server.reads++; return { events: server.events, coverage: { range, completeness: "complete" } }; },
    readHeader: async () => ({ ...emptyPlanningHeaderData, calendarEvents: readyHeaderSlot(projectHeaderCalendarEvents(server.events)) }),
  } }));
  const data = useSyncExternalStore(owner.planning.subscribe, owner.internal.getSnapshot, owner.internal.getSnapshot);
  const [error, setSaveError] = useState(""), [showEvents, setShowEvents] = useState(true), [calendarOpen, setCalendarOpen] = useState(false);
  const [selectedDate, setSelectedDate] = useState("2099-01-10"), [viewMonth, setViewMonth] = useState("2099-01-01");
  const commands = useFounderEventCommands({ planningState: owner.planning, setSaveError });
  return <main className="p-4"><h1>Events im gemeinsamen Planning-Zustand</h1>
    <p>Writes: {server.writes}</p><p>Checks: {server.reads}</p><output aria-label="Header-Kalender">{owner.planning.header().data.calendarEvents.data.map(event => event.title).join(", ")}</output>
    <div className="flex flex-wrap gap-3"><button onClick={() => setCalendarOpen(true)}>Header-Kalender öffnen</button><button onClick={server.confirm}>Confirm write</button><button onClick={server.lose}>Lose response</button><button onClick={server.fail}>Reject write</button><button onClick={async () => { server.newer(); await owner.planning.refreshEvents(); }}>Background refresh</button><button onClick={() => setShowEvents(value => !value)}>Bereich wechseln</button><button onClick={() => owner.internal.sessionChanged("replacement")}>Konto wechseln</button></div>
    {calendarOpen ? <HeaderCalendarDialog activeTab="events" anchor={{ right: 12, top: 12 }} calendarWorkweeks={[]} desktopPopover={false} eventSlot={owner.planning.header().data.calendarEvents} message="" now={new Date("2099-01-10T10:00:00Z")} onActiveTabChange={() => {}} onClose={() => setCalendarOpen(false)} onOpenTeam={() => {}} onSelectedDateChange={setSelectedDate} onViewMonthChange={setViewMonth} pending={false} profiles={[]} restoreFocusRef={{ current: null }} selectedDate={selectedDate} showWorkweek={false} viewMonth={viewMonth} workweekDateKey={selectedDate} workweeks={[]} /> : null}
    {error ? <p role="alert">{error}</p> : null}
    {showEvents ? <EventsOverview planningState={owner.planning} events={data.events} profiles={[]} canManageEvents pending={false} message={commands.eventMessage} onCreateEvent={commands.createFounderEvent} onUpdateEvent={commands.updateFounderEvent} /> : <p>Anderer Planning-Bereich</p>}
  </main>;
}
const meta = { component: CoordinatedEvents, title: "Planning/Events/CoordinatedState" } satisfies Meta<typeof CoordinatedEvents>;
export default meta;
type Story = StoryObj<typeof meta>;
async function edit(canvas: ReturnType<typeof within>) {
  await userEvent.click(canvas.getByRole("button", { name: "Bearbeiten" }));
  const title = canvas.getByRole("textbox", { name: "Titel" }); await userEvent.clear(title); await userEvent.type(title, "Mein Evententwurf");
  await userEvent.click(canvas.getByRole("button", { name: "Event speichern" }));
}
export const ConfirmationUpdatesEventsAndHeaderAcrossNavigation: Story = { play: async ({ canvasElement }) => {
  const canvas = within(canvasElement); await edit(canvas);
  await userEvent.click(canvas.getByRole("button", { name: "Bereich wechseln" })); await userEvent.click(canvas.getByRole("button", { name: "Confirm write" }));
  await waitFor(() => expect(canvas.getByLabelText("Header-Kalender")).toHaveTextContent("Mein Evententwurf"));
  await userEvent.click(canvas.getByRole("button", { name: "Bereich wechseln" })); await expect(canvas.getByRole("heading", { name: "Mein Evententwurf" })).toBeVisible();
  await userEvent.click(canvas.getByRole("button", { name: "Header-Kalender öffnen" })); const calendar = within(canvas.getByRole("dialog")); await expect(calendar.getByText("Mein Evententwurf")).toBeVisible();
} };
export const FailedSaveKeepsDraftAndRemovesOnlyItsEventEffect: Story = { play: async ({ canvasElement }) => {
  const canvas = within(canvasElement); await edit(canvas); await userEvent.click(canvas.getByRole("button", { name: "Reject write" }));
  await expect(canvas.getByRole("alert")).toHaveTextContent("Titel abgelehnt"); await expect(canvas.getByRole("textbox", { name: "Titel" })).toHaveValue("Mein Evententwurf"); await expect(canvas.getByRole("heading", { name: "Founder-Termin" })).toBeVisible();
} };
export const UnknownOutcomeRetainsSubmissionAndChecksWithoutReplay: Story = { play: async ({ canvasElement }) => {
  const canvas = within(canvasElement); await edit(canvas); await userEvent.click(canvas.getByRole("button", { name: "Lose response" }));
  await expect(canvas.getByText(/Bestätigung steht aus:/)).toBeVisible(); await expect(canvas.getByRole("button", { name: "Event speichern" })).toBeDisabled();
  await userEvent.click(canvas.getByRole("button", { name: "Serverstand prüfen" })); await waitFor(() => expect(canvas.getByText("Checks: 1")).toBeVisible()); await expect(canvas.getByText("Writes: 1")).toBeVisible();
  await userEvent.click(canvas.getByRole("button", { name: "Bereich wechseln" })); await userEvent.click(canvas.getByRole("button", { name: "Bereich wechseln" })); await expect(canvas.getByText(/Bestätigung steht aus:/)).toBeVisible();
} };
export const OriginalEditBasisSurvivesBackgroundRefresh: Story = { play: async ({ canvasElement }) => {
  const canvas = within(canvasElement); await userEvent.click(canvas.getByRole("button", { name: "Bearbeiten" }));
  const title = canvas.getByRole("textbox", { name: "Titel" }); await userEvent.clear(title); await userEvent.type(title, "Mein Evententwurf"); await userEvent.click(canvas.getByRole("button", { name: "Background refresh" }));
  await userEvent.click(canvas.getByRole("button", { name: "Event speichern" })); await expect(canvas.getByText(/Das Event wurde zwischenzeitlich geändert/)).toBeVisible(); await expect(canvas.getByText("Writes: 0")).toBeVisible();
  await userEvent.click(canvas.getByRole("button", { name: "Aktuellen Serverstand laden" })); await userEvent.click(await canvas.findByRole("button", { name: "Als Grundlage übernehmen" }));
  await expect(title).toHaveValue("Mein Evententwurf"); await userEvent.click(canvas.getByRole("button", { name: "Event speichern" })); await expect(canvas.getByText("Writes: 1")).toBeVisible();
} };
export const AccountChangeWithholdsLateConfirmation: Story = { play: async ({ canvasElement }) => {
  const canvas = within(canvasElement); await edit(canvas); await userEvent.click(canvas.getByRole("button", { name: "Konto wechseln" })); await userEvent.click(canvas.getByRole("button", { name: "Confirm write" }));
  await waitFor(() => expect(canvas.getByLabelText("Header-Kalender")).toBeEmptyDOMElement()); await expect(canvas.queryByRole("heading", { name: "Mein Evententwurf" })).not.toBeInTheDocument(); await expect(canvas.queryByRole("textbox", { name: "Titel" })).not.toBeInTheDocument();
} };
