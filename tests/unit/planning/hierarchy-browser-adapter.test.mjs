import assert from "node:assert/strict";
import { afterEach, test, vi } from "vitest";
import { importTestModule } from "../../helpers/vitest-module.mjs";
const { emptyPlanningShellState } = await importTestModule("src/features/planning/model/planning-shell-state.ts");
const { emptyPlanningHeaderData } = await importTestModule("src/lib/planning-header-data.ts");
const { taskDetailStoryTask } = await importTestModule("src/features/tasks/molecules/task-detail-story-fixtures.ts");
afterEach(() => vi.resetModules());
const task = taskDetailStoryTask({ id: "initiative", taskType: "initiative", updatedAt: "opaque-original", title: "Known initiative", strategy: { goal: "Known goal", successCriteria: "Known criteria", scopeConstraints: "Known scope" }, raciAssignments: [{ profileId: "owner", role: "accountable", sortOrder: 0 }], evidenceLink: "https://example.test/evidence", evidenceLinks: ["https://example.test/evidence"], intendedOutcome: "Loaded detail", note: "Loaded note" });
async function owner(client) {
 const { createBrowserPlanningState } = await importTestModule("src/features/planning/model/internal/browser-planning-state.ts", { "@/lib/browser-api-client": { createBrowserApiClient: () => client } });
 const browser = createBrowserPlanningState({ initialUserId: "user", initialWorkspace: "projects", initialCurrentProfile: null, initialData: { ...emptyPlanningShellState, tasks: [task, { ...task, id: "outside" }] }, initialHeaderData: emptyPlanningHeaderData });
 browser.runtime.session = { userId: "user", revision: "hierarchy-session", expiresAt: 4102444800, user: { id: "user" } };
 return browser.owner;
}
test("capped hierarchy summaries preserve outside membership and known detail/aux fields; exact empty removes only its covered membership", async () => {
 let complete = false; const calls = [];
 const state = await owner({ requestJson: async path => { calls.push(path); return { response: new Response(null), body: { model: { revision: "summary", project: emptyPlanningShellState.project, items: complete ? [] : [{ ...task, strategy: undefined, raciAssignments: [], evidenceLink: "", evidenceLinks: [], intendedOutcome: "", note: "", detailAvailability: "summary" }], relationships: [], people: [], sprints: [], preferences: [], coverage: Object.fromEntries(["items", "people", "strategies", "raci", "links", "sprints", "relationships", "preferences"].map(key => [key, complete ? "complete" : "partial"])) } } }; } });
 assert.equal(state.planning.hierarchy().completeness, "partial");
 await state.planning.refreshWorkspace("projects");
 assert.equal(state.planning.hierarchy().tasks.length, 2);
 assert.deepEqual(state.planning.taskDetail(task.id).task.strategy, task.strategy);
 assert.deepEqual(state.planning.taskDetail(task.id).task.raciAssignments, task.raciAssignments);
 assert.equal(state.planning.taskDetail(task.id).task.intendedOutcome, "Loaded detail");
 assert.equal(state.planning.taskDetail(task.id).task.note, "Loaded note");
 assert.equal(state.planning.taskDetail(task.id).task.evidenceLink, task.evidenceLink);
 complete = true; await state.planning.refreshWorkspace("projects");
 assert.equal(state.planning.hierarchy().completeness, "complete"); assert.deepEqual(state.planning.hierarchy().tasks, []);
 assert.equal(state.planning.taskDetail(task.id).task.title, "Known initiative");
 assert.deepEqual(calls, ["/api/strategic-planning-data", "/api/strategic-planning-data"]);
});
test("owned empty-Epic deletion sends the original opaque basis and accepts only the actual root receipt", async () => {
 const calls=[];const state=await owner({requestJson:async(path,options)=>{calls.push({path,options});return{response:new Response(null),body:{task:{id:task.id,taskType:"epic"}}};}});
 assert.equal((await state.planning.deleteEmptyEpic({...task,taskType:"epic"})).ok,true);
 assert.equal(calls[0].path,"/api/tasks/initiative");const {expectedSession,...payload}=calls[0].options;
 assert.deepEqual(payload,{method:"DELETE",json:{expectedUpdatedAt:"opaque-original"}});
 assert.equal(expectedSession.userId,"user");assert.equal(expectedSession.revision,"hierarchy-session");assert.equal(expectedSession.isCurrent(),true);
 assert.equal(state.planning.taskDetail(task.id).task,null);assert.equal(calls.length,1);
});
