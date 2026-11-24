import { expect, test, vi } from "vitest";
import { createPlanningState } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { emptyPlanningHeaderData, readyHeaderSlot } from "@/lib/planning-header-data";
import type { PlanningServerHeaderRead } from "@/features/planning/model/planning-server-header-read";

const session = { userId: "slot-user", revision: "original-session", expiresAt: 100, user: { id: "slot-user" } };
const receipt: PlanningServerHeaderRead = { id: "original-page-read", userId: session.userId, sessionRevision: session.revision, deadline: 2_000, timeoutAt: 15_000 };
const calendar = { ...emptyPlanningHeaderData, calendarEvents: readyHeaderSlot([]) };
const links: import("@/lib/types").PlanningHeaderData = { ...emptyPlanningHeaderData, quickLinks: readyHeaderSlot([{ id: "old", name: "Old server links", category: "tool", previewImageUrl: "", url: "https://example.com" }]) };
function fixture() {
  let now = 1_000, browserReads = 0;
  const owner = createPlanningState({ userId: session.userId, initialSession: session, initialData: emptyPlanningShellState, initialServerHeaderRead: receipt, adapter: {
    now: () => now, saveTask: async () => ({ task: {} }), readWorkspace: async () => null,
    createTool: async draft => ({ tool: { ...draft, id: "saved", sortOrder: 10, updatedAt: "r2" } }),
    readHeader: async () => { browserReads++; return { ...emptyPlanningHeaderData, quickLinks: readyHeaderSlot([]) }; },
  } });
  return { ...owner, expire: () => { now = 2_000; }, browserReads: () => browserReads };
}
test("server slots are reserved before delivery and reveal independently without duplicate browser reads", async () => {
  const owner = fixture();
  expect(owner.planning.header().slots.quickLinks.readStatus).toBe("loading");
  expect(owner.planning.acceptServerHeaderSlot(receipt, "calendarEvents", calendar)).toBe(true);
  expect(owner.planning.header().slots.calendarEvents.readStatus).toBe("current");
  expect(owner.planning.header().slots.quickLinks.readStatus).toBe("loading");
  expect(owner.browserReads()).toBe(0);
  expect(owner.planning.acceptServerHeaderSlot(receipt, "quickLinks", { ...links, quickLinks: { state: "error", data: [], error: "Links unavailable" } })).toBe(true);
  expect(owner.planning.header().slots.quickLinks.readStatus).toBe("unavailable");
  expect(owner.planning.header().slots.calendarEvents.readStatus).toBe("current");
});
test("a confirmed affected client write wins over the already reserved delayed server slot and replay", async () => {
  const owner = fixture();
  const { defaultFmdToolDraft } = await import("@/features/tools/model/fmd-tools");
  await expect(owner.planning.createTool("client-write", { ...defaultFmdToolDraft(), description: "Confirmed curated link", name: "Saved link", url: "https://example.com", isCurated: true })).resolves.toMatchObject({ phase: "saved" });
  await owner.planning.refreshHeader(["quickLinks"]);
  expect(owner.planning.acceptServerHeaderSlot(receipt, "quickLinks", links)).toBe(false);
  expect(owner.planning.header().data.quickLinks.data).toEqual([]);
  expect(owner.planning.acceptServerHeaderSlot({ ...receipt, id: "unprepared-return-page" }, "quickLinks", links)).toBe(false);
  expect(owner.planning.header().data.quickLinks.data).toEqual([]);
});
test.each(["deadline", "revision", "user"])("delayed slots cannot renew original %s authority", kind => {
  const owner = fixture();
  if (kind === "deadline") owner.expire();
  if (kind === "revision") owner.internal.bindSession({ ...session, revision: "replacement-session" });
  if (kind === "user") owner.internal.sessionChanged("replacement-user");
  expect(owner.planning.acceptServerHeaderSlot(receipt, "quickLinks", links)).toBe(false);
  expect(owner.planning.header().data.quickLinks.data).toEqual([]);
});
test("a consumed server receipt cannot replace a later accepted value or reserve a new context", () => {
  const owner = fixture();
  expect(owner.planning.acceptServerHeaderSlot(receipt, "quickLinks", links)).toBe(true);
  expect(owner.planning.acceptServerHeaderSlot(receipt, "quickLinks", { ...emptyPlanningHeaderData, quickLinks: readyHeaderSlot([]) })).toBe(false);
  expect(owner.planning.header().data.quickLinks.data).toEqual(links.quickLinks.data);
});

test("accepted server Header data retains its original deadline independently of the Board clock", () => {
  const owner = fixture();
  owner.planning.acceptServerHeaderSlot(receipt, "quickLinks", links);
  owner.expire();
  expect(owner.planning.header().data.quickLinks.data).toEqual([]);
  expect(owner.planning.header().slots.quickLinks.readStatus).toBe("not-loaded");
});

test("Header API retries retain the actual read deadline and reject responses already expired on arrival", async () => {
  let now = 1_000;
  const incoming = { ...links, readAuthority: { userId: session.userId, deadline: 2_000 } };
  const owner = createPlanningState({ userId: session.userId, initialSession: session, initialData: emptyPlanningShellState, adapter: {
    now: () => now, saveTask: async () => ({ task: {} }), readWorkspace: async () => null, readHeader: async () => incoming,
  } });
  await expect(owner.planning.refreshHeader(["quickLinks"])).resolves.toBe(true);
  expect(owner.planning.header().data.quickLinks.data).toEqual(links.quickLinks.data);
  now = 2_000;
  expect(owner.planning.header().data.quickLinks.data).toEqual([]);
  await expect(owner.planning.refreshHeader(["quickLinks"])).resolves.toBe(false);
  expect(owner.planning.header().data.quickLinks.data).toEqual([]);
});

test("an interrupted receipt keeps the original 15-second timeout across remount and cannot accept its late result", async () => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000);
  try {
    const read = { ...receipt, deadline: 60_000 };
    const owner = createPlanningState({ userId: session.userId, initialSession: session, initialServerHeaderRead: read, initialData: emptyPlanningShellState, adapter: {
      saveTask: async () => ({ task: {} }), readWorkspace: async () => null,
    } });
    owner.internal.watchServerHeaderRead();
    await vi.advanceTimersByTimeAsync(10_000);
    owner.internal.watchServerHeaderRead();
    expect(owner.planning.header().slots.quickLinks.readStatus).toBe("loading");
    await vi.advanceTimersByTimeAsync(4_000);
    expect(owner.planning.header().slots.quickLinks.readStatus).toBe("unavailable");
    expect(owner.planning.acceptServerHeaderSlot(read, "quickLinks", links)).toBe(false);
    expect(owner.planning.header().data.quickLinks.data).toEqual([]);
  } finally { vi.useRealTimers(); }
});

test("a receipt delivered after its original transport timeout cannot win before the client watcher runs", () => {
  const read = { ...receipt, deadline: 60_000, timeoutAt: 1_500 };
  let now = 1_000;
  const owner = createPlanningState({ userId: session.userId, initialSession: session, initialServerHeaderRead: read, initialData: emptyPlanningShellState, adapter: {
    now: () => now, saveTask: async () => ({ task: {} }), readWorkspace: async () => null,
  } });
  now = 1_500;
  expect(owner.planning.acceptServerHeaderSlot(read, "quickLinks", links)).toBe(false);
  expect(owner.planning.header().data.quickLinks.data).toEqual([]);
});
