import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";
const { emptyPlanningShellState } = await importTestModule("src/features/planning/model/planning-shell-state.ts");
const { emptyPlanningHeaderData, readyHeaderSlot } = await importTestModule("src/lib/planning-header-data.ts");
afterEach(() => vi.resetModules());
const event = { id: 1, title: "Original", category: "other", startsAt: "2099-01-12T10:00:00.000Z", endsAt: "", location: "", description: "", audienceMode: "all", participantProfileIds: [], reminderDaysBefore: 7, reminderGeneratedAt: "", status: "planned", createdBy: "actor", createdAt: "r1", updatedAt: "r1" };
async function owner(requestJson, headerData = emptyPlanningHeaderData) {
  const { createBrowserPlanningState } = await importTestModule("src/features/planning/model/internal/browser-planning-state.ts", { "@/lib/browser-api-client": { createBrowserApiClient: () => ({ requestJson }) } });
  const browser = createBrowserPlanningState({ initialUserId: "browser-events", initialWorkspace: "events", initialCurrentProfile: null, initialData: { ...emptyPlanningShellState, events: [event] }, initialHeaderData: headerData });
  browser.runtime.session = { userId: "browser-events", revision: "event-session", expiresAt: 4102444800, user: { id: "browser-events" } };
  return browser.owner;
}
test("the owned Event browser adapter sends captured update basis and preserves actual confirmation", async () => {
  const calls = [], state = await owner(async (path, options) => { calls.push({ path, options }); return { response: new Response(null, { status: 200 }), body: { event: { ...event, title: "Confirmed", updatedAt: "r2" }, warning: "Protokollierung konnte nicht bestätigt werden." } }; });
  const result = await state.planning.updateEvent("update", event, { ...event, title: "Submitted" });
  assert.equal(calls.length, 1); assert.equal(calls[0].path, "/api/events/1"); assert.equal(calls[0].options.json.expectedUpdatedAt, "r1"); assert.equal(calls[0].options.expectedSession.userId, "browser-events"); assert.equal(calls[0].options.expectedSession.revision, "event-session"); assert.equal(calls[0].options.expectedSession.isCurrent(), true); assert.equal(calls[0].options.json.title, "Submitted"); assert.equal(result.phase, "saved"); assert.ok(result.warning); assert.equal(state.planning.events().events[0].title, "Confirmed");
});
test("the owned Event browser adapter preserves revision codes rather than inferring every 409 as conflict", async () => {
  const state = await owner(async () => ({ response: new Response(null, { status: 409 }), body: { code: "event_version_conflict", error: "Changed" } }));
  assert.equal((await state.planning.updateEvent("update", event, event)).phase, "conflict"); assert.equal(state.planning.events().events[0].title, "Original");
});
test("range requests normalize instants and preserve authoritative coverage and calendar identity", async () => {
  const calls = [], state = await owner(async path => { calls.push(path); const url = new URL(path, "https://app.example.test"); return { response: new Response(null, { status: 200 }), body: { model: { events: [{ ...event, title: "Fresh", updatedAt: "r2" }], people: [], revision: "r2", coverage: { range: { from: url.searchParams.get("from"), to: url.searchParams.get("to") }, completeness: "complete" } }, headerData: { ...emptyPlanningHeaderData, calendarEvents: readyHeaderSlot([{ ...event, title: "Fresh" }]) } } }; }, { ...emptyPlanningHeaderData, calendarEvents: readyHeaderSlot([]) });
  await state.planning.refreshEvents({ from: "2099-01-01T01:00:00+01:00", to: "2099-02-01T01:00:00+01:00" });
  assert.equal(calls.length, 1); const url = new URL(calls[0], "https://app.example.test"); assert.equal(url.pathname, "/api/events-data"); assert.equal(url.searchParams.get("from"), "2099-01-01T00:00:00.000Z"); assert.equal(state.planning.events().coverage.completeness, "complete"); assert.equal(state.planning.header().data.calendarEvents.data[0].title, "Fresh");
});
