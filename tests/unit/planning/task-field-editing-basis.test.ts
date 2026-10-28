import type { Task } from "@/lib/types";
import { expect, test } from "vitest";
import { createPlanningState } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { taskDetailStoryTask } from "@/features/tasks/molecules/task-detail-story-fixtures";
import type { TaskDetailModel } from "@/features/tasks/model/task-detail-read-model";
const full = taskDetailStoryTask({ id: "task", title: "Shown", problemStatement: "Original detailed problem", updatedAt: "r1" });
const summary = { ...full, title: "Current summary", problemStatement: "", detailAvailability: "summary" as const, updatedAt: "r2" };
function detail(): TaskDetailModel { return { revision: "read", project: emptyPlanningShellState.project, item: { ...full, title: summary.title, problemStatement: "Foreign detailed problem", updatedAt: "r2" }, ancestors: [], children: [], relatedItems: [], people: [], sprints: [], discussion: { comments: [], externalComments: [] }, blockers: [], relationships: [], activity: [], reviews: [] }; }
test("a newer summary cannot authorize retained detail values with its revision, even after a background full read", async () => {
  const writes: string[] = [];
  const { planning } = createPlanningState({ userId: "user", initialData: { ...emptyPlanningShellState, tasks: [full] }, adapter: { readWorkspace: async () => ({ data: { ...emptyPlanningShellState, tasks: [summary] }, taskOmittedFields: ["problemStatement"] }), readTaskDetail: async () => ({ model: detail() }), saveTask: async (basis, patch) => { writes.push(basis.updatedAt!); return { task: { ...patch, updatedAt: "r3" } }; } } });
  await planning.refreshWorkspace("planning");
  const shown = planning.taskDetail(full.id).task!;
  expect(shown.problemStatement).toBe(full.problemStatement);
  const editor = planning.beginTaskEdit(shown);
  await planning.loadTaskDetail(full.id);
  expect(await editor.save({ problemStatement: "Local edit of the retained problem" })).toMatchObject({ kind: "versionConflict" });
  expect(writes).toEqual([]);
  expect(editor.view()).toMatchObject({ submitted: { problemStatement: "Local edit of the retained problem" }, canResave: true, serverTask: { problemStatement: "Foreign detailed problem" } });
  expect(await editor.resave({ problemStatement: "Consciously compared input" })).toMatchObject({ ok: true });
  expect(writes).toEqual(["r2"]);
});
test("summary-covered fields remain editable and a full authorized empty field clears retained detail", async () => {
  let reads = 0;
  const writes: string[] = [];
  const { planning } = createPlanningState({ userId: "user", initialData: { ...emptyPlanningShellState, tasks: [full] }, adapter: { readWorkspace: async () => ({ data: { ...emptyPlanningShellState, tasks: [summary] }, taskOmittedFields: ["problemStatement"] }), readTaskDetail: async () => { reads++; return { model: { ...detail(), item: { ...detail().item, problemStatement: "", updatedAt: "r4" } } }; }, saveTask: async (basis, patch) => { writes.push(basis.updatedAt!); return { task: { ...patch, updatedAt: "r3" } }; } } });
  await planning.refreshWorkspace("planning");
  expect(await planning.beginTaskEdit(planning.taskDetail(full.id).task!).save({ title: "Permitted summary edit" })).toMatchObject({ ok: true });
  expect(writes).toEqual(["r2"]);
  expect(reads).toBe(0);
  await planning.loadTaskDetail(full.id);
  expect(planning.taskDetail(full.id).task?.problemStatement).toBe("");
});

test("an older full detail read cannot undo a confirmed own profile field or mapped omitted notification settings", async () => {
  const profile={id:"person",name:"Ada",platformRole:"founder" as const,orgRole:"Founder",githubLogin:"ada",weeklyCapacity:20,focus:"Before",notificationsEnabled:true};
  let finish!: (value: Awaited<ReturnType<NonNullable<import("@/features/planning/model/internal/planning-state-owner").PlanningStateAdapter["readTaskDetail"]>>>)=>void;
  const item={id:"detail",title:"Detail",updatedAt:"r1"} as Task;
  const initial={...emptyPlanningShellState,tasks:[item],profiles:[profile]};
  const owner=createPlanningState({userId:"account",initialData:initial,adapter:{saveTask:async()=>({task:{}}),readWorkspace:async()=>null,readTaskDetail:()=>new Promise(resolve=>{finish=resolve;}),saveOwnProfileSettings:async()=>({profile:{...profile,focus:"Confirmed"},notificationPreferences:[]})}});
  const reading=owner.planning.loadTaskDetail(item.id);
  await owner.planning.saveOwnProfileSettings(profile.id,{profilePatch:{focus:"Confirmed"}});
  finish({model:{revision:"detail",project:initial.project,item,ancestors:[],children:[],relatedItems:[],people:[{...profile,focus:"Before",notificationsEnabled:false}],sprints:[],discussion:{comments:[],externalComments:[]},blockers:[],relationships:[],activity:[],reviews:[]}});
  await reading;expect(owner.planning.profileSettings(profile.id).profile).toMatchObject({focus:"Confirmed",notificationsEnabled:true});
  expect(owner.planning.taskDetail(item.id).readStatus).toBe("stale");
});

test("a remounted confirmed stale snapshot cannot turn retained detail fields into a fresh editing basis", async () => {
 const first=createPlanningState({userId:"user",initialData:{...emptyPlanningShellState,tasks:[full]},adapter:{saveTask:async()=>({task:{}}),readWorkspace:async()=>({data:{...emptyPlanningShellState,tasks:[summary]},taskOmittedFields:["problemStatement"]})}});
 await first.planning.refreshWorkspace("planning");const cached=first.planning.protectedCache()!;let writes=0;
 const remounted=createPlanningState({userId:"user",initialData:{...emptyPlanningShellState,tasks:cached.tasks.map(task=>({...task}))},adapter:{saveTask:async()=>{writes++;return{task:{id:full.id,updatedAt:"r3"}};},readWorkspace:async()=>null,readTaskDetail:async()=>({model:detail()})}});
 expect(remounted.planning.taskDetail(full.id).task?.detailAvailability).toBe("stale");
 expect(await remounted.planning.beginTaskEdit(full.id).save({problemStatement:"Old retained draft"})).toMatchObject({kind:"versionConflict"});expect(writes).toBe(0);
});
