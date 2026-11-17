import { expect, test } from "vitest";
import { createPlanningState, type PlanningWorkspaceRead } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { normalizeBacklogSelection, completeBacklogParentMembership, type BacklogSelection, type BacklogParentProgress, type BacklogSelectionQuery } from "@/features/backlog/model/backlog-selection";
import { DEFAULT_BACKLOG_FILTERS } from "@/features/backlog/model/backlog-view-model";
import { taskDetailStoryTask } from "@/features/tasks/molecules/task-detail-story-fixtures";
import type { Task } from "@/lib/types";

const actor = { id: "selected-backlog-reader", name: "Synthetic reader", platformRole: "founder" as const, orgRole: "Founder", githubLogin: "", weeklyCapacity: 40 };
const selected = taskDetailStoryTask({ id: "selected-backlog-child", title: "Selected child", parentTaskId: "selected-backlog-parent", updatedAt: "2026-11-01T12:00:00Z", note: "Existing canonical note", evidenceLinks: ["https://evidence.example.test/known"] });
const parent = taskDetailStoryTask({ id: "selected-backlog-parent", title: "Required context", taskType: "initiative", parentTaskId: "", updatedAt: "2026-11-01T12:00:00Z" });
const query = normalizeBacklogSelection({ view: "backlog", filters: { ...DEFAULT_BACKLOG_FILTERS, query: "selected" }, limit: 20 })!;
type SelectedRead = PlanningWorkspaceRead & { backlogSelection: BacklogSelection; readActor: { profileId: string; platformRole: typeof actor.platformRole } };
type PagedPort = { loadBacklogSelection(query: BacklogSelectionQuery, options?: { append?: boolean }): Promise<boolean> };
type SelectedPort = { loadBacklogSelection?(query: BacklogSelectionQuery, options?: { immediate?: boolean; signal?: AbortSignal }): Promise<boolean> };
function deferred<T>() { let resolve!: (value:T)=>void; const promise=new Promise<T>(done=>{resolve=done;});return{promise,resolve}; }
function response():SelectedRead {
  const deadline=Date.now()+60_000,omitted:(keyof Task)[]=["description","note","strategy","raciAssignments","evidenceLinks"];
  const row={...selected,detailAvailability:"summary" as const};omitted.forEach(field=>{delete row[field];});
  return {data:{...emptyPlanningShellState,tasks:[row,parent]},readAuthority:{userId:"selected-backlog-user",deadline},readActor:{profileId:actor.id,platformRole:actor.platformRole},
    coverage:{tasks:"partial",profiles:"partial",sprints:"partial",sprintCommitments:"partial"},taskCoverage:"partial",taskOmittedFields:omitted,
    backlogCoverage:{items:"partial",people:"partial",sprints:"partial",commitments:"partial",strategies:"partial",raci:"partial",links:"partial"},
    backlogSelection:{parentProgressById:{[parent.id]:{total:1009,completed:1,unfinished:1008,percentage:0}},query,itemIds:[selected.id],contextIds:[parent.id],rankById:{[selected.id]:1008},total:1,coverage:"complete",continuation:null,
      sourceRevision:"selected-backlog-source",scopeRevision:"selected-backlog-scope",observedAt:new Date().toISOString(),validUntil:new Date(deadline).toISOString()}};
}

test("selected Backlog coalesces compatible reads and keeps scoped membership, context, rank and partial field evidence distinct",async()=>{
  const held=deferred<SelectedRead>(),reads:BacklogSelectionQuery[]=[];
  const adapter={saveTask:async()=>({task:selected}),readWorkspace:async()=>{throw new Error("Selected Backlog cannot fall back to a workspace read");},
    readBacklogSelection:async(scope:BacklogSelectionQuery)=>{reads.push(scope);return held.promise;}};
  const {planning,internal}=createPlanningState({userId:"selected-backlog-user",initialWorkspace:"planning",initialCurrentProfile:actor,
    initialSession:{userId:"selected-backlog-user",user:{id:"selected-backlog-user"},revision:"selected-backlog-session",expiresAt:(Date.now()+60_000)/1000},
    initialData:{...emptyPlanningShellState,tasks:[selected]},adapter});
  try {
    const port=planning as typeof planning & SelectedPort;
    const first=port.loadBacklogSelection?.(query,{immediate:true});
    const second=port.loadBacklogSelection?.(query,{immediate:true});
    expect(reads).toEqual([query]);
    held.resolve(response());expect(await first).toBe(true);expect(await second).toBe(true);
    expect(planning.backlog()).toMatchObject({readStatus:"current",model:{selection:{itemIds:[selected.id],contextIds:[parent.id],rankById:{[selected.id]:1008},total:1,coverage:"complete"},coverage:{items:"partial",people:"partial",sprints:"partial",commitments:"partial"}}});
    expect(planning.taskDetail(selected.id).task).toMatchObject({note:selected.note,evidenceLinks:selected.evidenceLinks});
    await port.loadBacklogSelection?.(query,{immediate:true});expect(reads).toHaveLength(1);
  }finally{internal.dispose();}
});

function selectedOwner(read: (query: BacklogSelectionQuery, options?: { signal?: AbortSignal }) => Promise<SelectedRead | null>, now = () => Date.now()) {
  const session = { userId: "selected-backlog-user", user: { id: "selected-backlog-user" }, revision: "selected-backlog-session", expiresAt: (Date.now() + 3_600_000) / 1000 };
  const owner = createPlanningState({ userId: session.userId, initialWorkspace: "planning", initialCurrentProfile: actor, initialSession: session,
    initialData: { ...emptyPlanningShellState, tasks: [selected] }, adapter: { now, saveTask: async () => ({ task: selected }),
      readWorkspace: async () => { throw new Error("No workspace fallback"); }, readBacklogSelection: read } });
  return { ...owner, session };
}

test("selected Backlog expires its original receipt without certifying retained membership as current", async () => {
  let now = Date.now();
  const frame = response();
  const owner = selectedOwner(async () => frame, () => now);
  try {
    expect(await owner.planning.loadBacklogSelection(query)).toBe(true);
    now = frame.readAuthority!.deadline + 1;
    expect(owner.planning.backlog()).toMatchObject({ readStatus: "stale", model: { coverage: { items: "partial" } } });
    expect(owner.planning.backlog().model.selection).toBeUndefined();
    expect(owner.planning.taskDetail(selected.id).task?.note).toBe(selected.note);
  } finally { owner.internal.dispose(); }
});

test("selected Backlog rejects another mapped actor and a late response from the replaced session", async () => {
  const held = deferred<SelectedRead>(); let dispatch = 0;
  const owner = selectedOwner(async () => ++dispatch === 1 ? { ...response(), readActor: { profileId: "other-mapped-reader", platformRole: "founder" } } : held.promise);
  try {
    expect(await owner.planning.loadBacklogSelection(query)).toBe(false);
    expect(owner.planning.backlog().model.selection).toBeUndefined();
    const pending = owner.planning.loadBacklogSelection(query);
    owner.internal.bindSession({ ...owner.session, revision: "replacement-session" });
    held.resolve(response());
    expect(await pending).toBe(false);
    expect(owner.planning.backlog().model.selection).toBeUndefined();
  } finally { owner.internal.dispose(); }
});

test("selected Backlog shares its transport until the final consumer releases and rejects its late rows", async () => {
  const held = deferred<SelectedRead>(); let signal: AbortSignal | undefined; let dispatches = 0;
  const owner = selectedOwner(async (_query, options) => { dispatches++; signal = options?.signal; return held.promise; });
  const firstConsumer = new AbortController(), lastConsumer = new AbortController();
  try {
    const first = owner.planning.loadBacklogSelection(query, { signal: firstConsumer.signal });
    const last = owner.planning.loadBacklogSelection(query, { signal: lastConsumer.signal });
    expect(dispatches).toBe(1);
    firstConsumer.abort(); expect(signal?.aborted).toBe(false);
    lastConsumer.abort(); expect(signal?.aborted).toBe(true);
    expect(await first).toBe(false); expect(await last).toBe(false);
    held.resolve(response()); await Promise.resolve();
    expect(owner.planning.backlog().model.selection).toBeUndefined();
    expect(owner.planning.backlog().readStatus).not.toBe("loading");
    expect(owner.planning.taskDetail(parent.id).task).toBeNull();
  } finally { owner.internal.dispose(); }
});

test("known source replacement invalidates selected Backlog membership and rejects an in-flight old-source response", async () => {
  const held = deferred<SelectedRead>(); let source = "selected-backlog-source";
  const data = { ...emptyPlanningShellState, tasks: [selected], profiles: [actor] };
  const owner = createPlanningState({ userId: "selected-backlog-user", initialData: data, initialCurrentProfile: actor,
    initialSession: { userId: "selected-backlog-user", user: { id: "selected-backlog-user" }, revision: "selected-backlog-session", expiresAt: (Date.now() + 3_600_000) / 1000 },
    adapter: { saveTask: async () => ({ task: selected }), readWorkspace: async () => ({ data, scopeRevision: "selected-backlog-source", taskCoverage: "partial" }),
      readPlanningSourceVersion: async () => source, readBacklogSelection: async () => held.promise } });
  try {
    await owner.planning.refreshWorkspace("planning");
    const pending = owner.planning.loadBacklogSelection(query);
    source = "replacement-backlog-source";
    expect(await owner.planning.checkPlanningSource()).toBe("changed");
    held.resolve(response()); expect(await pending).toBe(false);
    expect(owner.planning.backlog().model.selection).toBeUndefined();
    expect(owner.planning.backlog().readStatus).not.toBe("current");
  } finally { owner.internal.dispose(); }
});


test("selected Backlog appends only the next page of the same receipt while retaining the first membership and deadline", async () => {
  const first=response();first.backlogSelection={...first.backlogSelection,total:2,coverage:"partial",continuation:"selected-next"};
  const nextQuery={...query,continuation:"selected-next"},other={...selected,id:"selected-next-child",title:"Next selected child"};
  const second:SelectedRead={...first,data:{...first.data,tasks:[other,parent]},backlogSelection:{...first.backlogSelection,query:nextQuery,itemIds:[other.id],rankById:{[other.id]:1009},coverage:"complete",continuation:null}};
  const owner=selectedOwner(async scope=>scope.continuation?second:first);
  try {
    expect(await owner.planning.loadBacklogSelection(query)).toBe(true);
    expect(await (owner.planning as typeof owner.planning & PagedPort).loadBacklogSelection(nextQuery,{append:true})).toBe(true);
    expect(owner.planning.backlog().model.selection).toMatchObject({itemIds:[selected.id,other.id],contextIds:[parent.id],parentProgressById:first.backlogSelection.parentProgressById,rankById:{[selected.id]:1008,[other.id]:1009},total:2,coverage:"complete",continuation:null,validUntil:first.backlogSelection.validUntil});
  } finally { owner.internal.dispose(); }
});

test("selected Backlog rejects a continuation from a replaced source before publishing its fields", async () => {
  const first=response();first.backlogSelection={...first.backlogSelection,total:2,coverage:"partial",continuation:"selected-next"};
  const nextQuery={...query,continuation:"selected-next"},other={...selected,id:"wrong-source-child",title:"Unaccepted next child"};
  const second:SelectedRead={...first,data:{...first.data,tasks:[other,parent]},backlogSelection:{...first.backlogSelection,query:nextQuery,itemIds:[other.id],rankById:{[other.id]:1009},sourceRevision:"replaced-source",coverage:"complete",continuation:null}};
  const owner=selectedOwner(async scope=>scope.continuation?second:first);
  try {
    expect(await owner.planning.loadBacklogSelection(query)).toBe(true);
    expect(await (owner.planning as typeof owner.planning & PagedPort).loadBacklogSelection(nextQuery,{append:true})).toBe(false);
    expect(owner.planning.taskDetail(other.id).task).toBeNull();
    expect(owner.planning.taskDetail(selected.id).task?.note).toBe(selected.note);
  } finally { owner.internal.dispose(); }
});


test("selected Backlog keeps append and standalone publication intents separate for the same cursor", async () => {
  const first=response();first.backlogSelection={...first.backlogSelection,total:2,coverage:"partial",continuation:"selected-next"};
  const nextQuery={...query,continuation:"selected-next"},other={...selected,id:"standalone-next-child"};
  const second:SelectedRead={...first,data:{...first.data,tasks:[other,parent]},backlogSelection:{...first.backlogSelection,query:nextQuery,itemIds:[other.id],rankById:{[other.id]:1009},coverage:"complete",continuation:null}};
  const appended=deferred<SelectedRead>(),standalone=deferred<SelectedRead>();let calls=0;
  const signals:Array<AbortSignal|undefined>=[];
  const owner=selectedOwner(async(_scope,options)=>{signals.push(options?.signal);return ++calls===1?first:calls===2?appended.promise:standalone.promise;});
  try {
    expect(await owner.planning.loadBacklogSelection(query)).toBe(true);
    const append=(owner.planning as typeof owner.planning & PagedPort).loadBacklogSelection(nextQuery,{append:true});
    const replace=owner.planning.loadBacklogSelection(nextQuery);
    expect(calls).toBe(3);expect(signals[1]?.aborted).toBe(true);
    standalone.resolve(second);expect(await replace).toBe(true);
    appended.resolve(second);expect(await append).toBe(false);
    expect(owner.planning.backlog().model.selection?.itemIds).toEqual([other.id]);
  } finally { appended.resolve(second);standalone.resolve(second);owner.internal.dispose(); }
});

test("a typed stale Backlog continuation discards its cursor and refreshes exactly the selected first-page query", async () => {
  const queries: BacklogSelectionQuery[] = [];
  const first = response(); first.backlogSelection = { ...first.backlogSelection, total: 2, coverage: "partial", continuation: "obsolete-page" };
  const state = selectedOwner(async input => {
    queries.push(input);
    if (input.continuation) throw Object.assign(new Error("Changed source"), { status: 409, code: "stale_continuation" });
    return { ...first, backlogSelection: { ...first.backlogSelection, query: input } };
  });
  try {
    expect(await state.planning.loadBacklogSelection(query)).toBe(true);
    expect(await state.planning.loadBacklogSelection({ ...query, continuation: "obsolete-page" }, { append: true })).toBe(false);
    expect(state.planning.backlog().readStatus).toBe("stale");
    expect(state.planning.backlog().model.selection).toBeUndefined();
    expect(await state.planning.refreshWorkspace("backlog")).toBe(true);
    expect(queries).toEqual([query, { ...query, continuation: "obsolete-page" }, query]);
  } finally { state.internal.dispose(); }
});

test("an opaque Backlog page conflict does not invalidate its current receipt or replay the request", async () => {
  let count = 0;
  const first = response(); first.backlogSelection = { ...first.backlogSelection, total: 2, coverage: "partial", continuation: "retained-page" };
  const state = selectedOwner(async () => { if (++count > 1) throw Object.assign(new Error("Opaque conflict"), { status: 409 }); return first; });
  try {
    expect(await state.planning.loadBacklogSelection(query)).toBe(true);
    expect(await state.planning.loadBacklogSelection({ ...query, continuation: "retained-page" }, { append: true })).toBe(false);
    expect(state.planning.backlog().readStatus).toBe("current");
    expect(state.planning.backlog().model.selection?.continuation).toBe("retained-page");
    expect(count).toBe(2);
  } finally { state.internal.dispose(); }
});

test("selected Parent progress cannot certify unrelated context or inconsistent counts", async()=>{
  const invalid:Record<string,BacklogParentProgress>[]=[{unrelated:{total:1,completed:0,unfinished:1,percentage:0}},{[parent.id]:{total:1,completed:2,unfinished:0,percentage:100}}];
  for(const progress of invalid){
    const read=response();read.backlogSelection={...read.backlogSelection,parentProgressById:progress};
    const owner=selectedOwner(async()=>read),previous=owner.planning.taskDetail(selected.id).task;
    try{expect(await owner.planning.loadBacklogSelection(query)).toBe(false);expect(owner.planning.backlog().model.selection).toBeUndefined();expect(owner.planning.taskDetail(selected.id).task).toEqual(previous);expect(owner.planning.taskDetail(parent.id).task).toBeNull();}
    finally{owner.internal.dispose();}
  }
});

test("small Parent membership needs exact authorized selected identities and a current matching rollup",()=>{
  const first=response().backlogSelection;
  const row={...selected},second={...selected,id:"other-confirmed-child"};
  const complete:BacklogSelection={...first,query:{...query,filters:{...DEFAULT_BACKLOG_FILTERS}},itemIds:[row.id,second.id],total:2,parentProgressById:{[parent.id]:{total:3,completed:1,unfinished:2,percentage:33}}};
  const records=new Map([row,second,parent].map(task=>[task.id,task]));const lookedUp:string[]=[];
  const lookup=(id:string)=>{lookedUp.push(id);return records.get(id);};
  expect(completeBacklogParentMembership(complete,lookup)).toEqual([parent.id]);expect(new Set(lookedUp)).toEqual(new Set([row.id,second.id,parent.id]));
  expect(completeBacklogParentMembership({...complete,itemIds:[row.id]},id=>records.get(id))).toEqual([]);
  expect(completeBacklogParentMembership({...complete,query},id=>records.get(id))).toEqual([]);
  expect(completeBacklogParentMembership({...complete,itemIds:[row.id,row.id]},id=>records.get(id))).toEqual([]);
  expect(completeBacklogParentMembership(complete,id=>id===second.id?{...second,parentTaskId:"different-parent"}:records.get(id))).toEqual([]);
  expect(completeBacklogParentMembership(complete,id=>id===second.id?{...second,status:"Unknown status"}:records.get(id))).toEqual([]);
  expect(completeBacklogParentMembership(complete,id=>records.get(id),id=>id===second.id)).toEqual([]);
  expect(completeBacklogParentMembership(undefined,id=>records.get(id))).toEqual([]);
});

test("small Parent membership proof expires with its original selected receipt",async()=>{
  let now=Date.now();const frame=response(),unfiltered={...query,filters:{...DEFAULT_BACKLOG_FILTERS}};
  frame.backlogSelection={...frame.backlogSelection,query:unfiltered,parentProgressById:{[parent.id]:{total:2,completed:1,unfinished:1,percentage:50}}};
  const owner=selectedOwner(async()=>frame,()=>now);
  try{expect(await owner.planning.loadBacklogSelection(unfiltered)).toBe(true);expect(owner.planning.backlog().parentMembershipCompleteIds).toEqual([parent.id]);now=frame.readAuthority!.deadline;expect(owner.planning.backlog().parentMembershipCompleteIds).toEqual([]);expect(owner.planning.backlog().model.selection).toBeUndefined();}
  finally{owner.internal.dispose();}
});
