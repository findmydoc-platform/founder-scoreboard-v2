import { expect, test } from "vitest";
import { createPlanningState } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import type { FounderEvent, FmdTool, PlanningShellState } from "@/lib/types";
const event: FounderEvent = { id: 1, title: "Original", category: "other", startsAt: "2099-01-10T10:00:00.000Z", endsAt: "", location: "", description: "", audienceMode: "all", participantProfileIds: [], reminderDaysBefore: 7, reminderGeneratedAt: "", status: "planned", createdBy: "person", createdAt: "r1", updatedAt: "baseline" };
const tool: FmdTool = { id: "tool", name: "Original", category: "tool", kind: "Werkzeuge", description: "Useful tool description", url: "https://example.test/", owner: "Team", status: "active", isCurated: true, previewImageUrl: "", previewImageSource: "none", sortOrder: 10, updatedAt: "baseline" };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
for (const domain of ["events", "tools"] as const)
    for (const path of ["domain", "workspace"] as const)
        for (const order of ["read-first", "receipt-first"] as const)
            test(`${domain} ${path} ${order}: overlapping baseline read cannot discard an actual write or independent receipt`, async () => {
                const response = deferred<{
                    event: FounderEvent;
                }>(), toolResponse = deferred<{
                    tool: FmdTool;
                }>(), reading = deferred<void>();
                const cache: {
                    current: PlanningShellState | null;
                } = { current: null };
                let reads = 0, writes = 0;
                const otherEvent = { ...event, id: 2, title: "Independent" }, otherTool = { ...tool, id: "other", name: "Independent" };
                const events = [event, otherEvent], tools = [tool, otherTool];
                const { planning } = createPlanningState({ userId: "account", initialWorkspace: domain, initialData: { ...emptyPlanningShellState, events, fmdTools: tools }, publishCache: data => { cache.current = data; }, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => { reads++; await reading.promise; return { data: { ...emptyPlanningShellState, events, fmdTools: tools }, eventCoverage: { range: null, completeness: "complete" }, toolCoverage: "complete" }; }, readEvents: async () => { reads++; await reading.promise; return { events, coverage: { range: null, completeness: "complete" } }; }, readTools: async () => { reads++; await reading.promise; return { tools, completeness: "complete" }; }, updateEvent: async (basis) => { writes++; return basis.id === 1 ? response.promise : { event: { ...otherEvent, title: "Independent confirmed", updatedAt: "other-confirmed" } }; }, updateTool: async (basis) => { writes++; return basis.id === "tool" ? toolResponse.promise : { tool: { ...otherTool, name: "Independent confirmed", updatedAt: "other-confirmed" } }; } } });
                const saving = domain === "events" ? planning.updateEvent("own", event, { ...event, title: "Confirmed" }) : planning.updateTool("own", tool, { ...tool, name: "Confirmed" });
                const read = path === "workspace" ? planning.refreshWorkspace(domain) : domain === "events" ? planning.refreshEvents() : planning.refreshTools();
                if (order === "read-first") {
                    reading.resolve();
                    await read;
                }
                if (domain === "events")
                    await planning.updateEvent("other", otherEvent, { ...otherEvent, title: "Independent confirmed" });
                else
                    await planning.updateTool("other", otherTool, { ...otherTool, name: "Independent confirmed" });
                response.resolve({ event: { ...event, title: "Confirmed", updatedAt: "own-confirmed" } });
                toolResponse.resolve({ tool: { ...tool, name: "Confirmed", updatedAt: "own-confirmed" } });
                expect(await saving).toMatchObject({ phase: "saved" });
                if (order === "receipt-first") {
                    reading.resolve();
                    await read;
                }
                const rows = domain === "events" ? planning.events().events : planning.tools().tools;
                expect(rows).toEqual(expect.arrayContaining([expect.objectContaining({ updatedAt: "own-confirmed" }), expect.objectContaining({ updatedAt: "other-confirmed" })]));
                expect((domain === "events" ? cache.current?.events : cache.current?.fmdTools)?.map(row => row.updatedAt)).toEqual(expect.arrayContaining(["own-confirmed", "other-confirmed"]));
                expect({ reads, writes }).toEqual({ reads: 1, writes: 2 });
            });
for (const domain of ["events", "tools"] as const)
    test(`${domain} creation receipt survives a later-started complete empty read before commit`, async () => {
        const eventResponse = deferred<{
            event: FounderEvent;
        }>(), toolResponse = deferred<{
            tool: FmdTool;
        }>();
        const cache: {
            current: PlanningShellState | null;
        } = { current: null };
        const { planning } = createPlanningState({ userId: "account", initialWorkspace: domain, initialData: emptyPlanningShellState, publishCache: data => { cache.current = data; }, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => null, createEvent: () => eventResponse.promise, createTool: () => toolResponse.promise, readEvents: async () => ({ events: [], coverage: { range: null, completeness: "complete" } }), readTools: async () => ({ tools: [], completeness: "complete" }) } });
        const saving = domain === "events" ? planning.createEvent("new", event) : planning.createTool("new", tool);
        if (domain === "events")
            await planning.refreshEvents();
        else
            await planning.refreshTools();
        eventResponse.resolve({ event: { ...event, updatedAt: "created" } });
        toolResponse.resolve({ tool: { ...tool, updatedAt: "created" } });
        expect(await saving).toMatchObject({ phase: "saved" });
        expect(domain === "events" ? planning.events().events : planning.tools().tools).toEqual([expect.objectContaining({ updatedAt: "created" })]);
        expect(domain === "events" ? cache.current?.events : cache.current?.fmdTools).toEqual([expect.objectContaining({ updatedAt: "created" })]);
    });
for (const domain of ["events", "tools"] as const)
    for (const order of ["read-first", "receipt-first"] as const)
        test(`${domain} ${order}: a foreign read after write dispatch stays authoritative over its earlier own receipt`, async () => {
            const eventResponse = deferred<{
                event: FounderEvent;
            }>(), toolResponse = deferred<{
                tool: FmdTool;
            }>(), readReady = deferred<void>();
            const cache: {
                current: PlanningShellState | null;
            } = { current: null };
            let reads = 0;
            const foreignEvent = { ...event, title: "Foreign current", updatedAt: "foreign" }, foreignTool = { ...tool, name: "Foreign current", updatedAt: "foreign" };
            const { planning } = createPlanningState({ userId: "account", initialWorkspace: domain, initialData: { ...emptyPlanningShellState, events: [event], fmdTools: [tool] }, publishCache: data => { cache.current = data; }, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => null, updateEvent: () => eventResponse.promise, updateTool: () => toolResponse.promise, readEvents: async () => { reads++; await readReady.promise; return { events: [foreignEvent], coverage: { range: null, completeness: "complete" } }; }, readTools: async () => { reads++; await readReady.promise; return { tools: [foreignTool], completeness: "complete" }; } } });
            const saving = domain === "events" ? planning.updateEvent("own", event, { ...event, title: "Mine" }) : planning.updateTool("own", tool, { ...tool, name: "Mine" });
            const reading = domain === "events" ? planning.refreshEvents() : planning.refreshTools();
            if (order === "read-first") {
                readReady.resolve();
                await reading;
            }
            eventResponse.resolve({ event: { ...event, title: "Mine", updatedAt: "own" } });
            toolResponse.resolve({ tool: { ...tool, name: "Mine", updatedAt: "own" } });
            expect(await saving).toMatchObject({ phase: "saved" });
            if (order === "receipt-first") {
                readReady.resolve();
                await reading;
            }
            expect((domain === "events" ? planning.events().events : planning.tools().tools)[0].updatedAt).toBe("foreign");
            expect((domain === "events" ? cache.current?.events : cache.current?.fmdTools)?.[0].updatedAt).toBe("foreign");
            expect(reads).toBe(1);
        });

test("an Event receipt preserves a newer observation when overlapping ranges contain different event dates", async () => {
  const response = deferred<{ event: FounderEvent }>(), older = deferred<void>();
  const january = { from: "2099-01-01T00:00:00.000Z", to: "2099-02-01T00:00:00.000Z" }, february = { from: "2099-02-01T00:00:00.000Z", to: "2099-03-01T00:00:00.000Z" };
  const own = { ...event, startsAt: "2099-02-10T10:00:00.000Z", title: "Moved", updatedAt: "own" };
  const { planning } = createPlanningState({ userId: "account", initialWorkspace: "events", initialData: { ...emptyPlanningShellState, events: [event] }, adapter: {
    saveTask: async () => ({ task: {} }), readWorkspace: async () => null, updateEvent: () => response.promise,
    readEvents: async range => { const old = range?.from === january.from; if (old) await older.promise; return { events: [old ? { ...event, title: "Older foreign", updatedAt: "older-foreign" } : own], coverage: { range, completeness: "complete" } }; },
  } });
  const saving = planning.updateEvent("own", event, own), oldRead = planning.refreshEvents(january);
  await planning.refreshEvents(february); response.resolve({ event: own }); await saving;
  older.resolve(); await oldRead;
  expect(planning.events().events).toEqual([own]);
});
