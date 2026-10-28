import { expect, test } from "vitest";
import { createPlanningState, type PlanningStateAdapter, type PlanningWorkspaceRead } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { emptyPlanningHeaderData, readyHeaderSlot } from "@/lib/planning-header-data";
import type { FmdTool, Task } from "@/lib/types";
import type { ToolConfirmation, ToolRead } from "@/features/tools/model/tool-state";
const tool: FmdTool = { id: "tool-1", name: "Original", category: "tool", kind: "Werkzeuge", description: "Useful tool description", url: "https://tools.example.test/", owner: "Team", status: "active", isCurated: true, previewImageUrl: "", previewImageSource: "none", sortOrder: 10, updatedAt: "r1" };
const draft = { ...tool, name: "Changed" };
function deferred<T>() { let resolve!: (value: T) => void; let reject!: (error: Error) => void; const promise = new Promise<T>((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; }
function fixture(adapter: Partial<PlanningStateAdapter> = {}) { return createPlanningState({ userId: "tool-user", initialWorkspace: "tools", initialData: { ...emptyPlanningShellState, fmdTools: [tool] }, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => null, ...adapter } }); }
test("confirmed tool changes reach Tools and invalidate only loaded Header quicklinks while rejecting older reads", async () => {
  const old = deferred<PlanningWorkspaceRead>(); let reads = 0;
  const { planning } = createPlanningState({ userId: "tool-user", initialWorkspace: "tools", initialData: { ...emptyPlanningShellState, fmdTools: [tool] }, initialHeaderData: { ...emptyPlanningHeaderData, quickLinks: readyHeaderSlot([]) }, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: () => old.promise, updateTool: async () => ({ tool: { ...tool, name: "Confirmed", updatedAt: "r2" } }), readHeader: async () => { reads++; return { ...emptyPlanningHeaderData, quickLinks: readyHeaderSlot([{ ...tool, name: "Confirmed" }]) }; } } });
  const reading = planning.refreshWorkspace("tools"); await planning.updateTool("edit", tool, draft);
  old.resolve({ data: { ...emptyPlanningShellState, fmdTools: [tool] }, toolCoverage: "complete" }); await reading;
  expect(planning.tools().tools[0].name).toBe("Confirmed"); expect(planning.header().data.quickLinks.data[0].name).toBe("Confirmed"); expect(reads).toBe(1); expect(planning.header().slots.calendarEvents.readStatus).toBe("not-loaded");
});
test("a rejected tool operation removes only its optimism and preserves another tool and task confirmation", async () => {
  const rejected = deferred<ToolConfirmation>(), task = { id: "task", updatedAt: "r1" } as Task;
  const { planning } = createPlanningState({ userId: "tool-user", initialWorkspace: "tools", initialData: { ...emptyPlanningShellState, fmdTools: [tool], tasks: [task] }, adapter: { readWorkspace: async () => null, saveTask: async () => ({ task: { ...task, title: "Confirmed task", updatedAt: "r2" } }), updateTool: () => rejected.promise, createTool: async () => ({ tool: { ...tool, id: "created", name: "Independent", updatedAt: "created" } }) } });
  const writing = planning.updateTool("bad-edit", tool, draft); await planning.createTool("other", { ...draft, name: "Independent" }); await planning.saveTask(task, { title: "Confirmed task" }); rejected.reject(Object.assign(new Error("Rejected"), { status: 422 }));
  expect(await writing).toMatchObject({ phase: "rejected" }); expect(planning.tools().tools.map(item => item.name)).toEqual(expect.arrayContaining(["Original", "Independent"])); expect(planning.taskDetail("task").task?.title).toBe("Confirmed task");
});
test("unknown create remains submitted after safe verification and is never replayed or confirmed by matching fields", async () => {
  let writes = 0; const { planning } = fixture({ createTool: async () => { writes++; throw new Error("Lost response"); }, readTools: async () => ({ tools: [{ ...tool, id: "possibly-created", name: "Changed" }], completeness: "complete" }) });
  expect(await planning.createTool("create", draft)).toMatchObject({ phase: "unconfirmed" }); await planning.checkToolOutcome("create"); await planning.createTool("create", draft);
  expect(writes).toBe(1); expect(planning.tools().operations[0]).toMatchObject({ phase: "unconfirmed", draft: { name: "Changed" } });
});
test("preview upload is confirmed independently of a rejected tool save and unknown uploads never replay", async () => {
  let uploads = 0; const image = { imageUrl: "/api/tools/preview-image?path=quicklinks%2F2099-01-01%2F123-image.png", source: "manual" as const };
  const { planning } = fixture({ uploadToolPreview: async () => { uploads++; if (uploads === 2) throw new Error("Lost upload response"); return image; }, createTool: async () => { throw Object.assign(new Error("Invalid tool"), { status: 422 }); } });
  const file = new File([new Uint8Array([1])], "preview.png", { type: "image/png" });
  expect(await planning.uploadToolPreview("upload", file)).toMatchObject({ phase: "uploaded", image }); await planning.createTool("create", { ...draft, previewImageUrl: image.imageUrl, previewImageSource: "manual" });
  expect(planning.tools().previews[0]).toMatchObject({ phase: "uploaded", image }); expect(planning.tools().tools).toHaveLength(1);
  await planning.uploadToolPreview("lost", file); expect(await planning.checkToolPreview("lost")).toEqual({ phase: "unconfirmed", verification: "no-reference" }); await planning.uploadToolPreview("lost", file); expect(uploads).toBe(2);
});
test("partial reads cannot invent a global curated count or remove omitted tools", async () => {
  let complete = false; const { planning } = fixture({ readTools: async () => ({ tools: [], completeness: complete ? "complete" : "partial" }) });
  expect(planning.tools().curatedCount).toBeNull(); await planning.refreshTools(); expect(planning.tools().tools).toHaveLength(1); expect(planning.tools().curatedCount).toBeNull();
  complete = true; await planning.refreshTools(); expect(planning.tools().tools).toEqual([]); expect(planning.tools().curatedCount).toBe(0);
});
test("a new complete removal prevents old overlapping reads and write confirmations from resurrecting a tool", async () => {
  const old = deferred<ToolRead>(), write = deferred<ToolConfirmation>(); let reads = 0;
  const { planning } = fixture({ updateTool: () => write.promise, readTools: () => ++reads === 1 ? old.promise : Promise.resolve({ tools: [], completeness: "complete" }) });
  const reading = planning.refreshTools(), writing = planning.updateTool("edit", tool, draft); await planning.refreshTools(); old.resolve({ tools: [tool], completeness: "complete" }); await reading; write.resolve({ tool: { ...tool, updatedAt: "r2" } }); await writing;
  expect(planning.tools().tools).toEqual([]); expect(planning.tools().readStatus).toBe("stale");
});
test("revision conflicts preserve inputs and never replace the captured original tool basis", async () => {
  let writes = 0; const { planning } = fixture({ updateTool: async () => { writes++; throw Object.assign(new Error("Version changed"), { status: 409, code: "tool_version_conflict" }); } });
  expect(await planning.updateTool("edit", tool, draft)).toMatchObject({ phase: "conflict" }); expect(planning.tools().operations[0].draft.name).toBe("Changed"); expect(writes).toBe(1); expect(planning.tools().tools[0].name).toBe("Original");
});
test("confirmed rows with uncertain audit do not replay creation or erase the returned identity", async () => {
  const { planning } = fixture({ createTool: async () => ({ tool: { ...tool, id: "created", updatedAt: "r2" }, warning: "Protokollierung konnte nicht bestätigt werden." }) });
  expect(await planning.createTool("create", draft)).toMatchObject({ phase: "saved", warning: expect.any(String) }); expect(planning.tools().tools.some(item => item.id === "created")).toBe(true);
});
test("a denied Tools scope withholds saved records, submitted drafts and previews against late responses", async () => {
  const old = deferred<ToolRead>(), upload = deferred<{ imageUrl: string; source: "manual" }>(); let reads = 0;
  const { planning } = fixture({ readTools: async () => { if (++reads === 1) return old.promise; throw Object.assign(new Error("Denied"), { status: 403 }); }, readWorkspace: async () => { throw Object.assign(new Error("Denied"), { status: 403 }); }, uploadToolPreview: () => upload.promise, createTool: async () => { throw new Error("Lost"); } });
  await planning.createTool("unknown", draft); const uploading = planning.uploadToolPreview("upload", new File(["x"], "preview.png", { type: "image/png" })); const reading = planning.refreshTools();
  await planning.refreshWorkspace("tools");
  old.resolve({ tools: [tool], completeness: "complete" }); await reading; upload.resolve({ imageUrl: "https://images.example.test/preview.png", source: "manual" }); await uploading;
  expect(planning.tools()).toMatchObject({ tools: [], operations: [], previews: [], readStatus: "forbidden", curatedCount: null });
});

test.each([null, "replacement"])("session replacement withholds late Tool and preview results (%s)", async replacement => {
  const write = deferred<ToolConfirmation>(), upload = deferred<{ imageUrl: string; source: "manual" }>(), read = deferred<ToolRead>(); let session!: (id: string | null) => void;
  const { planning } = fixture({ subscribeSession: listener => { session = listener; return () => {}; }, updateTool: () => write.promise, uploadToolPreview: () => upload.promise, readTools: () => read.promise });
  const writing = planning.updateTool("edit", tool, draft), uploading = planning.uploadToolPreview("upload", new File(["x"], "private.png", { type: "image/png" })), reading = planning.refreshTools(); session(replacement);
  write.resolve({ tool: { ...tool, updatedAt: "r2" } }); upload.resolve({ imageUrl: "/api/tools/preview-image?path=quicklinks%2F2099-01-01%2F123-file.png", source: "manual" }); read.resolve({ tools: [tool], completeness: "complete" }); await Promise.all([writing, uploading, reading]); expect(planning.tools()).toMatchObject({ tools: [], operations: [], previews: [], curatedCount: null });
});
test("non-curated and description-only confirmations do not load or reread unrelated Header quicklinks", async () => {
  let reads = 0;
  const { planning } = createPlanningState({ userId: "tool-user", initialWorkspace: "tools", initialData: { ...emptyPlanningShellState, fmdTools: [tool] }, initialHeaderData: { ...emptyPlanningHeaderData, quickLinks: readyHeaderSlot([]) }, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => null, updateTool: async () => ({ tool: { ...tool, description: "Changed description", updatedAt: "r2" } }), createTool: async () => ({ tool: { ...tool, id: "not-curated", isCurated: false, updatedAt: "created" } }), readHeader: async () => { reads++; return emptyPlanningHeaderData; } } });
  await planning.updateTool("description", tool, { ...draft, name: tool.name, description: "Changed description" }); await planning.createTool("other", { ...draft, isCurated: false }); expect(reads).toBe(0); expect(planning.header().slots.quickLinks.readStatus).toBe("current");
});
test("Tools read reuses its authoritative loaded quicklinks without another Header request", async () => {
  let reads = 0; const current = { ...tool, name: "Current", updatedAt: "r2" };
  const { planning } = createPlanningState({ userId: "tool-user", initialWorkspace: "tools", initialData: { ...emptyPlanningShellState, fmdTools: [tool] }, initialHeaderData: { ...emptyPlanningHeaderData, quickLinks: readyHeaderSlot([]) }, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => null, readTools: async () => ({ tools: [current], completeness: "complete", headerData: { ...emptyPlanningHeaderData, quickLinks: readyHeaderSlot([current]) } }), readHeader: async () => { reads++; return emptyPlanningHeaderData; } } });
  await planning.refreshTools(); expect(reads).toBe(0); expect(planning.header().data.quickLinks.data[0].name).toBe("Current"); expect(planning.tools().curatedCount).toBe(1);
});
