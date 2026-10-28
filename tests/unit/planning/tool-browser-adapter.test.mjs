import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";
const { emptyPlanningShellState } = await importTestModule("src/features/planning/model/planning-shell-state.ts");
const { emptyPlanningHeaderData, readyHeaderSlot } = await importTestModule("src/lib/planning-header-data.ts");
afterEach(() => vi.resetModules());
const tool = { id: "tool", name: "Original", category: "tool", kind: "Werkzeuge", description: "Useful tool description", url: "https://tools.example.test/", owner: "Team", status: "active", isCurated: true, previewImageUrl: "", previewImageSource: "none", sortOrder: 10, updatedAt: "r1" };
async function owner(client, headerData = emptyPlanningHeaderData) {
  const { createBrowserPlanningState } = await importTestModule("src/features/planning/model/internal/browser-planning-state.ts", { "@/lib/browser-api-client": { createBrowserApiClient: () => client } });
  const browser = createBrowserPlanningState({ initialUserId: "browser-tools", initialWorkspace: "tools", initialCurrentProfile: null, initialData: { ...emptyPlanningShellState, fmdTools: [tool] }, initialHeaderData: headerData });
  browser.runtime.session = { userId: "browser-tools", revision: "tool-session", expiresAt: 4102444800, user: { id: "browser-tools" } };
  return browser.owner;
}
test("the owned Tool browser adapter sends captured revision and preserves actual partial confirmation", async () => {
  const calls = [], state = await owner({ requestJson: async (path, options) => { calls.push({ path, options }); return { response: new Response(null, { status: 200 }), body: { tool: { ...tool, name: "Confirmed", updatedAt: "r2" }, warning: "Protokollierung konnte nicht bestätigt werden." } }; } });
  const result = await state.planning.updateTool("edit", tool, { ...tool, name: "Submitted" }); assert.equal(result.phase, "saved"); assert.ok(result.warning); assert.equal(calls[0].path, "/api/tools/tool"); assert.equal(calls[0].options.json.expectedUpdatedAt, "r1"); assert.equal(state.planning.tools().tools[0].name, "Confirmed");
});
test("the owned Tool browser adapter preserves conflict and credential codes separately", async () => {
  let code = "tool_version_conflict"; const state = await owner({ requestJson: async () => ({ response: new Response(null, { status: 409 }), body: { code, error: "Changed" } }) });
  assert.equal((await state.planning.updateTool("conflict", tool, tool)).phase, "conflict"); code = "session_superseded"; assert.equal((await state.planning.updateTool("ended", tool, tool)).phase, "session-ended"); assert.equal(state.planning.tools().tools.length, 0);
});
test("owned preview upload and verification use multipart then the confirmed protected path, without replay", async () => {
  let uploads = 0, reads = 0; const imageUrl = "/api/tools/preview-image?path=quicklinks%2F2099-01-01%2F123-preview.png";
  const state = await owner({ requestForm: async (path, form) => { uploads++; assert.equal(path, "/api/tools/preview-image"); assert.equal(form.get("file").name, "preview.png"); return { response: new Response(null, { status: 200 }), body: { imageUrl, source: "manual" } }; }, requestBlob: async path => { reads++; assert.equal(path, imageUrl); return { response: new Response(null, { status: 200 }), blob: new Blob() }; } });
  await state.planning.uploadToolPreview("upload", new File(["x"], "preview.png", { type: "image/png" })); assert.deepEqual(await state.planning.checkToolPreview("upload"), { phase: "uploaded", verification: "present" }); await state.planning.uploadToolPreview("upload", new File(["x"], "preview.png", { type: "image/png" })); assert.equal(uploads, 1); assert.equal(reads, 1); assert.equal(state.planning.tools().tools.length, 1);
});
test("owned Tools read preserves completeness and reuses already-returned quicklinks", async () => {
  const calls = [], current = { ...tool, name: "Read", updatedAt: "r2" }; const state = await owner({ requestJson: async path => { calls.push(path); return { response: new Response(null, { status: 200 }), body: { model: { revision: "opaque", tools: [current], people: [], coverage: "complete" }, headerData: { ...emptyPlanningHeaderData, quickLinks: readyHeaderSlot([current]) } } }; } }, { ...emptyPlanningHeaderData, quickLinks: readyHeaderSlot([]) });
  await state.planning.refreshTools(); assert.deepEqual(calls, ["/api/tools-data"]); assert.equal(state.planning.tools().completeness, "complete"); assert.equal(state.planning.tools().curatedCount, 1); assert.equal(state.planning.header().data.quickLinks.data[0].name, "Read");
});
