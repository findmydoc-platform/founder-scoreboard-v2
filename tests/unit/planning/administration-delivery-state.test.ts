import { afterEach, expect, test, vi } from "vitest";
import { createPlanningState } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { emptyPlanningHeaderData, readyHeaderSlot } from "@/lib/planning-header-data";
import { sessionAuthority } from "@/features/administrator-access/model/administrator-access";
import { administrationStoryModel } from "@/features/administration/organisms/administration-workspace.stories";
const now = Date.parse("2026-01-01T12:00:00Z");
const authority = sessionAuthority({ platformRole: "ceo", credentialKind: "session", administratorAccess: { eligible: true, active: true, expiresAt: new Date(now + 60000).toISOString() } });
const model = { ...administrationStoryModel, coverage: { people: "complete" as const, technical: true, notificationEvents: "partial" as const, notificationDeliveries: "partial" as const } };
afterEach(() => vi.useRealTimers());
test("a mixed delivery receipt retains each actual result when later Administration reads fail", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    let reads = 0, writes = 0;
    const owner = createPlanningState({ userId: "user", initialData: emptyPlanningShellState, initialAdministrationAuthority: authority, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => null, readAdministration: async () => {
                if (reads++)
                    throw Object.assign(new Error("Reload unavailable"), { status: 503 });
                return model;
            }, executeAdministrationDelivery: async (selection) => { writes++; expect(selection).toEqual({ kind: "events", eventIds: [7, 8] }); return { ok: true, status: 200, sent: 1, failed: 1, skipped: 0, results: [{ eventId: 7, status: "sent" }, { eventId: 8, status: "failed", error: "Provider rejected" }] }; } } });
    await owner.planning.loadAdministration();
    const result = await owner.planning.runAdministrationDelivery({ kind: "events", eventIds: [7, 8] });
    expect(result.phase).toBe("partial");
    expect(owner.planning.administrationDeliveries()[0]).toMatchObject({ phase: "partial", sent: 1, failed: 1, skipped: 0, results: [{ eventId: 7, status: "sent" }, { eventId: 8, status: "failed" }], readStatus: "unavailable" });
    expect(writes).toBe(1);
    expect(owner.planning.administration().model?.githubProject).toEqual(model.githubProject);
    expect(owner.planning.administration().model?.people).toEqual(model.people);
});
test("a lost response keeps the exact delivery selection unconfirmed after matching sent records and never sends again", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    let writes = 0, reads = 0;
    const owner = createPlanningState({ userId: "user", initialData: emptyPlanningShellState, initialAdministrationAuthority: authority, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => null, readAdministration: async () => { reads++; return reads === 1 ? model : { ...model, notificationDeliveries: [{ id: 71, eventId: 7, channel: "google_chat" as const, status: "sent" as const, attempts: 1, target: "recipient", lastError: "", deliveryMode: "direct_dm" as const, digestSize: 1, deliveredAt: "2026-01-01T12:00:01Z", createdAt: "2026-01-01T12:00:01Z" }] }; }, executeAdministrationDelivery: async () => { writes++; throw new Error("Response lost"); } } });
    await owner.planning.loadAdministration();
    const selection = { kind: "events" as const, eventIds: [7] };
    const result = await owner.planning.runAdministrationDelivery(selection);
    expect(result.phase).toBe("unconfirmed");
    expect(owner.planning.administrationDeliveryAvailability(selection)).toBe("pending");
    await owner.planning.checkAdministrationDelivery(result.id);
    await owner.planning.runAdministrationDelivery(selection);
    expect(owner.planning.administrationDeliveries()[0]).toMatchObject({ phase: "unconfirmed", selection, readStatus: "current" });
    expect(owner.planning.administration().model?.notificationDeliveries[0]).toMatchObject({ eventId: 7, status: "sent" });
    expect({ writes, reads }).toEqual({ writes: 1, reads: 2 });
});
test("delivery receipts invalidate loaded Notification and Header scopes without inventing unread counters or delivery rows", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    let headerReads = 0, notificationReads = 0;
    const owner = createPlanningState({ userId: "user", initialData: emptyPlanningShellState, initialWorkspace: "notifications", initialHeaderData: { ...emptyPlanningHeaderData, notifications: readyHeaderSlot({ unreadCount: 37, items: [] }) }, initialAdministrationAuthority: authority, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => { notificationReads++; throw Object.assign(new Error("Notifications unavailable"), { status: 503 }); }, readHeader: async () => { headerReads++; throw Object.assign(new Error("Header unavailable"), { status: 503 }); }, readAdministration: async () => model, executeAdministrationDelivery: async () => ({ ok: true, status: 200, sent: 1, failed: 0, skipped: 0, results: [{ eventId: 7, status: "sent" }] }) } });
    await owner.planning.loadAdministration();
    await owner.planning.runAdministrationDelivery({ kind: "events", eventIds: [7] });
    expect(owner.planning.notifications().readStatus).toBe("unavailable");
    expect(owner.planning.header().slots.notifications.readStatus).toBe("unavailable");
    expect(owner.planning.header().data.notifications.data.unreadCount).toBe(37);
    expect(owner.planning.notifications().deliveries).toEqual([]);
    expect({ headerReads, notificationReads }).toEqual({ headerReads: 1, notificationReads: 1 });
});
test("an authoritative expired-access delivery response with partial fields ends restricted result acceptance before the local deadline", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    const owner = createPlanningState({ userId: "user", initialData: emptyPlanningShellState, initialAdministrationAuthority: authority, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => null, readAdministration: async () => model, executeAdministrationDelivery: async () => ({ ok: false, status: 403, code: "administrator_access_expired", sent: 0, failed: 1, skipped: 0, results: [{ eventId: 7, status: "failed", error: "Admin lease ended" }] }) } });
    await owner.planning.loadAdministration();
    const result = await owner.planning.runAdministrationDelivery({ kind: "events", eventIds: [7] });
    expect(result.phase).toBe("ended");
    expect(owner.planning.administrationDeliveries()).toEqual([]);
    expect(owner.planning.administration().coverage.technical).toBe(false);
    owner.internal.bindAdministrationAuthority(authority);
    expect(owner.planning.administrationDeliveryAvailability({ kind: "events", eventIds: [7] })).toBe("forbidden");
});
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }
test("Admin expiry while a post-receipt read waits withholds the returned restricted result without another delivery", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    let reads = 0, writes = 0;
    const read = deferred<typeof model>();
    const owner = createPlanningState({ userId: "user", initialData: emptyPlanningShellState, initialAdministrationAuthority: authority, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => null, readAdministration: async () => ++reads === 1 ? model : read.promise, executeAdministrationDelivery: async () => { writes++; return { ok: true, status: 200, sent: 1, failed: 0, skipped: 0, results: [{ eventId: 7, status: "sent" }] }; } } });
    await owner.planning.loadAdministration();
    const pending = owner.planning.runAdministrationDelivery({ kind: "events", eventIds: [7] });
    await vi.advanceTimersByTimeAsync(60001);
    read.resolve(model);
    const result = await pending;
    expect(result).toMatchObject({ phase: "ended", selection: null, sent: null, results: [] });
    expect(owner.planning.administrationDeliveries()).toEqual([]);
    expect(writes).toBe(1);
});
test("a valid non-success delivery response retains reported failures while a complete empty success claims no delivery", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    let writes = 0;
    const owner = createPlanningState({ userId: "user", initialData: emptyPlanningShellState, initialAdministrationAuthority: authority, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => null, readAdministration: async () => model, executeAdministrationDelivery: async () => ++writes === 1 ? { ok: false, status: 502, sent: 0, failed: 1, skipped: 0, results: [{ eventId: 7, status: "failed", error: "Recorded provider failure" }] } : { ok: true, status: 200, sent: 0, failed: 0, skipped: 0, results: [] } } });
    await owner.planning.loadAdministration();
    expect(await owner.planning.runAdministrationDelivery({ kind: "events", eventIds: [7] })).toMatchObject({ phase: "partial", sent: 0, failed: 1, results: [{ eventId: 7, status: "failed" }] });
    expect(await owner.planning.runAdministrationDelivery({ kind: "events", eventIds: [8] })).toMatchObject({ phase: "reported", sent: 0, failed: 0, results: [] });
});
test("an unknown selected event pauses overlapping delivery but leaves another event and Project settings usable", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    let deliveryWrites = 0, projectWrites = 0;
    const owner = createPlanningState({ userId: "user", initialData: emptyPlanningShellState, initialAdministrationAuthority: authority, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => null, readAdministration: async () => model, executeAdministrationDelivery: async (selection) => {
                deliveryWrites++;
                if (selection.kind === "events" && selection.eventIds.includes(7))
                    throw new Error("Uncertain");
                return { ok: true, status: 200, sent: 0, failed: 0, skipped: 0, results: [] };
            }, saveAdministrationProject: async (proposed) => { projectWrites++; return { project: proposed }; } } });
    await owner.planning.loadAdministration();
    await owner.planning.runAdministrationDelivery({ kind: "events", eventIds: [7] });
    await owner.planning.runAdministrationDelivery({ kind: "events", eventIds: [7] });
    expect(owner.planning.administrationDeliveryAvailability({ kind: "pending", limit: 20 })).toBe("pending");
    expect(owner.planning.administrationDeliveryAvailability({ kind: "events", eventIds: [8] })).toBe("available");
    await owner.planning.runAdministrationDelivery({ kind: "events", eventIds: [8] });
    const project = model.githubProject!;
    await expect(owner.planning.beginAdministrationProjectEdit(project).save({ ...project, number: 8 })).resolves.toEqual({ ok: true });
    expect({ deliveryWrites, projectWrites }).toEqual({ deliveryWrites: 2, projectWrites: 1 });
});
test.each([null, "another-account"])("a pending delivery detaches from session replacement %s and cannot restore its receipt", async (replacement) => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    let session!: (id: string | null) => void;
    const write = deferred<import("@/features/administration/model/administration-delivery-state").AdministrationDeliveryResponse>();
    const owner = createPlanningState({ userId: "user", initialData: emptyPlanningShellState, initialAdministrationAuthority: authority, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => null, subscribeSession: listener => { session = listener; return () => { }; }, readAdministration: async () => model, executeAdministrationDelivery: () => write.promise } });
    await owner.planning.loadAdministration();
    const pending = owner.planning.runAdministrationDelivery({ kind: "events", eventIds: [7] });
    session(replacement);
    write.resolve({ ok: true, status: 200, sent: 1, failed: 0, skipped: 0, results: [{ eventId: 7, status: "sent" }] });
    expect(await pending).toMatchObject({ phase: "ended", selection: null, results: [] });
    expect(owner.planning.administrationDeliveries()).toEqual([]);
    expect(owner.planning.administration().model).toBeNull();
});
test("known delivery rejection preserves an independent confirmed person eligibility change", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    let current = model;
    const write = deferred<import("@/features/administration/model/administration-delivery-state").AdministrationDeliveryResponse>();
    const owner = createPlanningState({ userId: "user", initialData: emptyPlanningShellState, initialAdministrationAuthority: authority, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => null, readAdministration: async () => current, executeAdministrationDelivery: () => write.promise, saveAdministrationEligibility: async (profileId, eligible) => { current = { ...current, people: current.people.map(person => person.id === profileId ? { ...person, administratorAccess: { eligible, active: false, expiresAt: null } } : person) }; return { profileId, eligible, active: false, expiresAt: null }; } } });
    await owner.planning.loadAdministration();
    const pending = owner.planning.runAdministrationDelivery({ kind: "events", eventIds: [7] });
    const person = current.people.find(person => !person.administratorAccess.eligible)!;
    const editor = owner.planning.beginAdministrationPersonEdit(person);
    await editor.save({ eligible: true, technicalIdentity: { githubLogin: person.githubLogin, googleChatUserId: person.googleChatUserId, googleChatDmSpace: person.googleChatDmSpace } });
    write.resolve({ ok: false, status: 424, sent: 0, failed: 0, skipped: 0, error: "Delivery disabled" });
    expect((await pending).phase).toBe("rejected");
    expect(owner.planning.administration().model?.people.find(row => row.id === person.id)?.administratorAccess.eligible).toBe(true);
    expect(editor.view().eligibility.phase).toBe("confirmed");
});
test.each([{ ok: false, status: 409 }, { ok: true, status: 200 }, { ok: true, status: 200, sent: 1, failed: 0, skipped: 0, results: [{ eventId: 99, status: "sent" as const }] }])("unproven delivery response %s cannot claim a selected event was sent", async (response) => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    let writes = 0;
    const owner = createPlanningState({ userId: "user", initialData: emptyPlanningShellState, initialAdministrationAuthority: authority, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => null, readAdministration: async () => model, executeAdministrationDelivery: async () => { writes++; return response; } } });
    await owner.planning.loadAdministration();
    const selection = { kind: "events" as const, eventIds: [7] };
    expect(await owner.planning.runAdministrationDelivery(selection)).toMatchObject({ phase: "unconfirmed", sent: null, results: [] });
    await owner.planning.checkAdministrationDelivery(owner.planning.administrationDeliveries()[0].id);
    await owner.planning.runAdministrationDelivery(selection);
    expect(writes).toBe(1);
});
