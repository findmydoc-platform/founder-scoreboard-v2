import { expect, test } from "vitest";
import { createPlanningState } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";

const connected = { state: "connected" as const, calendarLabel: "calendar@example.test", connectedAt: null, refreshedAt: null, lastUsedAt: null, accessTokenExpiresAt: null };
const preview = { state: "idle" as const, activePublicationCount: 1, futureSeriesCount: 2, pendingSeriesCount: 0, teamVisibilityWillBeDisabled: true };
const base = { saveTask: async () => ({ task: {} }), readWorkspace: async () => null };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(yes => { resolve = yes; }); return { promise, resolve }; }

test("completed disconnect remains confirmed after a failed status refresh and invalidates only loaded calendar scopes", async () => {
  let reads = 0;
  const { planning } = createPlanningState({ userId: "account", initialData: emptyPlanningShellState, adapter: {
    ...base, readGoogleWorkspace: async () => ++reads === 1 ? { status: 200, value: { connection: connected, disconnectPending: false } } : { status: 503, value: { error: "Status nicht erreichbar" } },
    readGoogleDisconnect: async () => ({ status: 200, value: { disconnect: preview } }),
    disconnectGoogleWorkspace: async () => ({ status: 200, value: { result: { state: "completed", recovery: null } } }),
    readWorkweekCalendar: async () => ({ currentWorkweeks: [], calendarWorkweeks: [], referenceDate: "2026-10-28" }),
  } });
  const scope = { policy: "team-week" as const, from: "2026-10-26", to: "2026-11-01" };
  const month = { policy: "header-month" as const, from: "2026-10-26", to: "2026-12-06" };
  await planning.loadGoogleWorkspace(); await planning.loadGoogleDisconnectPreview(); await planning.loadWorkweekCalendar(scope); await planning.loadWorkweekCalendar(month);
  const before = planning.workweekCalendar(scope).invalidation;
  await planning.disconnectGoogleWorkspace(planning.googleWorkspace().previewBasis!); await planning.loadGoogleWorkspace();
  expect(planning.googleWorkspace()).toMatchObject({ connection: { state: "not_connected" }, operation: { phase: "completed", result: { state: "completed" } }, readStatus: "unavailable" });
  expect(planning.workweekCalendar(scope).invalidation).toBe(before + 1);
  expect(planning.workweekCalendar(month).invalidation).toBe(before + 1);
});


test("unknown disconnection checks use GET only and not-connected status cannot prove that earlier operation completed", async () => {
  let writes = 0; let removed = false;
  const { planning } = createPlanningState({ userId: "account", initialData: emptyPlanningShellState, adapter: {
    ...base, readGoogleWorkspace: async () => ({ status: 200, value: { connection: { ...connected, state: removed ? "not_connected" : "connected" }, disconnectPending: false } }),
    readGoogleDisconnect: async () => ({ status: 200, value: { disconnect: preview } }),
    disconnectGoogleWorkspace: async () => { writes++; removed = true; throw new Error("Antwort verloren"); },
  } });
  await planning.loadGoogleWorkspace(); await planning.loadGoogleDisconnectPreview();
  await planning.disconnectGoogleWorkspace(planning.googleWorkspace().previewBasis!);
  await planning.continueGoogleDisconnect(); expect(writes).toBe(1);
  await planning.loadGoogleWorkspace(); await planning.continueGoogleDisconnect();
  expect(writes).toBe(1);
  expect(planning.googleWorkspace()).toMatchObject({ connection: { state: "not_connected" }, operation: { phase: "unconfirmed", checked: true }, canContinue: false });
});


test("a refreshed preview cannot silently authorize the previously displayed confirmation", async () => {
  let count = 2; let writes = 0;
  const { planning } = createPlanningState({ userId: "account", initialData: emptyPlanningShellState, adapter: {
    ...base, readGoogleWorkspace: async () => ({ status: 200, value: { connection: connected } }),
    readGoogleDisconnect: async () => ({ status: 200, value: { disconnect: { ...preview, futureSeriesCount: count } } }),
    disconnectGoogleWorkspace: async () => { writes++; return { status: 200, value: { result: { state: "completed", recovery: null } } }; },
  } });
  await planning.loadGoogleWorkspace(); await planning.loadGoogleDisconnectPreview(); const displayed = planning.googleWorkspace().previewBasis!;
  count = 4; await planning.loadGoogleDisconnectPreview(); const result = await planning.disconnectGoogleWorkspace(displayed);
  expect(result.status).toBe(409); expect(writes).toBe(0); expect(displayed.preview.futureSeriesCount).toBe(2);
  expect(planning.googleWorkspace().preview?.futureSeriesCount).toBe(4);
});

test.each(["cleaning", "cleanup_pending", "remove_pending"] as const)("partial %s retains its real recovery without inventing connection removal", async state => {
  const { planning } = createPlanningState({ userId: "account", initialData: emptyPlanningShellState, adapter: {
    ...base, readGoogleWorkspace: async () => ({ status: 200, value: { connection: connected } }),
    readGoogleDisconnect: async () => ({ status: 200, value: { disconnect: preview } }),
    disconnectGoogleWorkspace: async () => ({ status: 202, value: { result: { state, recovery: "retry" } } }),
  } });
  await planning.loadGoogleWorkspace(); await planning.loadGoogleDisconnectPreview(); await planning.disconnectGoogleWorkspace(planning.googleWorkspace().previewBasis!);
  expect(planning.googleWorkspace()).toMatchObject({ connection: connected, operation: { phase: "partial", result: { state, recovery: "retry" } }, canContinue: true });
});

test("connection consumers coalesce status reads and load the preview only when requested or pending", async () => {
  let statuses = 0; let previews = 0;
  const { planning } = createPlanningState({ userId: "account", initialData: emptyPlanningShellState, adapter: {
    ...base, readGoogleWorkspace: async () => { statuses++; return { status: 200, value: { connection: connected } }; },
    readGoogleDisconnect: async () => { previews++; return { status: 200, value: { disconnect: preview } }; },
  } });
  await Promise.all([planning.loadGoogleWorkspace(), planning.loadGoogleWorkspace()]); expect(statuses).toBe(1); expect(previews).toBe(0);
  await Promise.all([planning.loadGoogleDisconnectPreview(), planning.loadGoogleDisconnectPreview()]); expect(previews).toBe(1);
});

test("a status read overlapping completed disconnect cannot restore its older connected result", async () => {
  const write = deferred<{ status: number; value: { result: { state: "completed"; recovery: null } } }>();
  const old = deferred<{ status: number; value: { connection: typeof connected } }>(); let reads = 0;
  const { planning } = createPlanningState({ userId: "account", initialData: emptyPlanningShellState, adapter: {
    ...base, readGoogleWorkspace: async () => ++reads === 1 ? { status: 200, value: { connection: connected } } : old.promise,
    readGoogleDisconnect: async () => ({ status: 200, value: { disconnect: preview } }), disconnectGoogleWorkspace: async () => write.promise,
  } });
  await planning.loadGoogleWorkspace(); await planning.loadGoogleDisconnectPreview(); const writing = planning.disconnectGoogleWorkspace(planning.googleWorkspace().previewBasis!);
  const reading = planning.loadGoogleWorkspace(); await Promise.resolve();
  write.resolve({ status: 200, value: { result: { state: "completed", recovery: null } } }); await writing;
  old.resolve({ status: 200, value: { connection: connected } }); await reading;
  expect(planning.googleWorkspace()).toMatchObject({ connection: { state: "not_connected" }, operation: { phase: "completed" } });
});

test.each([200, 409])("missing or session-suppressed disconnect confirmation %s stays unknown", async status => {
  const { planning } = createPlanningState({ userId: "account", initialData: emptyPlanningShellState, adapter: {
    ...base, readGoogleWorkspace: async () => ({ status: 200, value: { connection: connected } }), readGoogleDisconnect: async () => ({ status: 200, value: { disconnect: preview } }),
    disconnectGoogleWorkspace: async () => ({ status, value: { ...(status === 409 ? { code: "session_superseded" } : {}), error: "Bestätigung fehlt" } }),
  } });
  await planning.loadGoogleWorkspace(); await planning.loadGoogleDisconnectPreview(); await planning.disconnectGoogleWorkspace(planning.googleWorkspace().previewBasis!);
  expect(planning.googleWorkspace().operation.phase).toBe("unconfirmed");
});

test("authority loss withholds Google data and the late operation cannot reattach after read authorization returns", async () => {
  let denied = false;
  const write = deferred<{ status: number; value: { result: { state: "completed"; recovery: null } } }>();
  const { planning } = createPlanningState({ userId: "account", initialData: emptyPlanningShellState, adapter: {
    ...base, readGoogleWorkspace: async () => denied ? { status: 403, value: { error: "Kein Zugriff" } } : { status: 200, value: { connection: connected } },
    readGoogleDisconnect: async () => ({ status: 200, value: { disconnect: preview } }), disconnectGoogleWorkspace: async () => write.promise,
  } });
  await planning.loadGoogleWorkspace(); await planning.loadGoogleDisconnectPreview(); const writing = planning.disconnectGoogleWorkspace(planning.googleWorkspace().previewBasis!);
  denied = true; await planning.loadGoogleWorkspace();
  expect(planning.googleWorkspace()).toMatchObject({ readStatus: "forbidden", connection: null, preview: null, operation: { submitted: null }, history: [] });
  denied = false; await planning.loadGoogleWorkspace(); await planning.loadGoogleDisconnectPreview();
  write.resolve({ status: 200, value: { result: { state: "completed", recovery: null } } }); await writing;
  expect(planning.googleWorkspace().operation.phase).toBe("unconfirmed");
  expect(planning.googleWorkspace().connection?.state).toBe("connected");
});

test("account replacement clears retained disconnect status and ignores a late completion", async () => {
  const write = deferred<{ status: number; value: { result: { state: "completed"; recovery: null } } }>();
  const { planning, internal } = createPlanningState({ userId: "account", initialData: emptyPlanningShellState, adapter: {
    ...base, readGoogleWorkspace: async () => ({ status: 200, value: { connection: connected } }), readGoogleDisconnect: async () => ({ status: 200, value: { disconnect: preview } }), disconnectGoogleWorkspace: async () => write.promise,
  } });
  await planning.loadGoogleWorkspace(); await planning.loadGoogleDisconnectPreview(); const writing = planning.disconnectGoogleWorkspace(planning.googleWorkspace().previewBasis!);
  internal.sessionChanged("other-account"); write.resolve({ status: 200, value: { result: { state: "completed", recovery: null } } }); await writing;
  expect(planning.googleWorkspace()).toMatchObject({ connection: null, preview: null, operation: { phase: "idle", submitted: null }, history: [] });
});


test("a changed private publication context invalidates the original preview and active cleanup blocks dependent publication without erasing private data", async () => {
  let version = "private-before"; let posts = 0; let publications = 0;
  const { planning } = createPlanningState({ userId: "account", initialData: emptyPlanningShellState, adapter: {
    ...base, readGoogleWorkspace: async () => ({ status: 200, value: { connection: connected } }), readGoogleDisconnect: async () => ({ status: 200, value: { disconnect: preview } }),
    disconnectGoogleWorkspace: async () => { posts++; return { status: 202, value: { result: { state: "cleanup_pending", recovery: "retry" } } }; },
    readPrivateWorkweek: async () => ({ status: 200, value: { version: { id: version, effectiveFrom: "2026-11-02", timezone: "Europe/Berlin", status: "preparing", createdAt: "2026-10-28T09:00:00Z", windows: { monday: [], tuesday: [], wednesday: [], thursday: [], friday: [], saturday: [], sunday: [] } }, minimumEffectiveFrom: "2026-11-02" } }),
    readWorkweekConflict: async () => ({ status: 200, value: { conflict: null } }),
    publishPrivateWorkweek: async () => { publications++; return { status: 503, value: { error: "Must not publish during cleanup" } }; },
  } });
  await planning.loadPrivateWorkweek(); await planning.loadGoogleWorkspace(); await planning.loadGoogleDisconnectPreview(); const oldBasis = planning.googleWorkspace().previewBasis!;
  version = "private-after"; await planning.loadPrivateWorkweek();
  expect(planning.googleWorkspace()).toMatchObject({ previewBasis: null, previewStatus: "stale" });
  await planning.disconnectGoogleWorkspace(oldBasis); expect(posts).toBe(0);
  await planning.loadGoogleDisconnectPreview(); await planning.disconnectGoogleWorkspace(planning.googleWorkspace().previewBasis!);
  await planning.loadPrivateWorkweek(); await planning.publishPrivateWorkweek("private-after");
  expect(publications).toBe(0); expect(posts).toBe(1);
  expect(planning.privateWorkweek().context?.version?.id).toBe("private-after");
});


test("fresh pending evidence permits deliberate existing recovery while the previous lost call stays unproven", async () => {
  let writes = 0; let pending = false;
  const { planning } = createPlanningState({ userId: "account", initialData: emptyPlanningShellState, adapter: {
    ...base, readGoogleWorkspace: async () => ({ status: 200, value: { connection: connected, disconnectPending: pending } }),
    readGoogleDisconnect: async () => pending ? { status: 503, value: { error: "Vorschau derzeit nicht erreichbar" } } : { status: 200, value: { disconnect: preview } },
    disconnectGoogleWorkspace: async () => { writes++; if (writes === 1) { pending = true; throw new Error("Antwort verloren"); } return { status: 200, value: { result: { state: "completed", recovery: null } } }; },
  } });
  await planning.loadGoogleWorkspace(); await planning.loadGoogleDisconnectPreview(); await planning.disconnectGoogleWorkspace(planning.googleWorkspace().previewBasis!);
  await planning.loadGoogleWorkspace(); await planning.loadGoogleDisconnectPreview();
  expect(writes).toBe(1); expect(planning.googleWorkspace().canContinue).toBe(true);
  await planning.continueGoogleDisconnect(); expect(writes).toBe(2);
  expect(planning.googleWorkspace()).toMatchObject({ operation: { phase: "completed", submitted: { continuation: true, basis: null } }, history: [{ phase: "unconfirmed", submitted: { continuation: false } }] });
});

test("a read after confirmed completion cannot restore stale pending connection state", async () => {
  let completed = false;
  const { planning } = createPlanningState({ userId: "account", initialData: emptyPlanningShellState, adapter: {
    ...base, readGoogleWorkspace: async () => ({ status: 200, value: { connection: completed ? { ...connected, state: "not_connected" } : connected, disconnectPending: completed } }),
    readGoogleDisconnect: async () => ({ status: 200, value: { disconnect: preview } }),
    disconnectGoogleWorkspace: async () => { completed = true; return { status: 200, value: { result: { state: "completed", recovery: null } } }; },
  } });
  await planning.loadGoogleWorkspace(); await planning.loadGoogleDisconnectPreview(); await planning.disconnectGoogleWorkspace(planning.googleWorkspace().previewBasis!);
  await planning.loadGoogleWorkspace();
  expect(planning.googleWorkspace()).toMatchObject({ connection: { state: "not_connected" }, operation: { phase: "completed" }, disconnectPending: false, canContinue: false });
});


test("preview denial withholds its operation while preserving independently authorized connection and rejects the late result", async () => {
  let denied = false;
  const write = deferred<{ status: number; value: { result: { state: "completed"; recovery: null } } }>();
  const { planning } = createPlanningState({ userId: "account", initialData: emptyPlanningShellState, adapter: {
    ...base, readGoogleWorkspace: async () => ({ status: 200, value: { connection: connected } }),
    readGoogleDisconnect: async () => denied ? { status: 403, value: { error: "Kein Vorschauzugriff" } } : { status: 200, value: { disconnect: preview } }, disconnectGoogleWorkspace: async () => write.promise,
  } });
  await planning.loadGoogleWorkspace(); await planning.loadGoogleDisconnectPreview(); const writing = planning.disconnectGoogleWorkspace(planning.googleWorkspace().previewBasis!);
  denied = true; await planning.loadGoogleDisconnectPreview();
  expect(planning.googleWorkspace()).toMatchObject({ connection: connected, previewStatus: "forbidden", preview: null, operation: { submitted: null } });
  write.resolve({ status: 200, value: { result: { state: "completed", recovery: null } } }); await writing;
  expect(planning.googleWorkspace().connection?.state).toBe("connected");
  denied = false; await planning.loadGoogleWorkspace(); await planning.loadGoogleDisconnectPreview();
  expect(planning.googleWorkspace().operation.phase).toBe("unconfirmed");
});
