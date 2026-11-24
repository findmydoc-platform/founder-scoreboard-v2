import { expect, test } from "vitest";
import { createPlanningState, type PlanningStateAdapter } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { taskDetailStoryTask } from "@/features/tasks/molecules/task-detail-story-fixtures";
import type { TaskDetailModel } from "@/features/tasks/model/task-detail-read-model";
import type { Task, TaskReview } from "@/lib/types";
const task = taskDetailStoryTask({ id: "task", title: "Original", status: "Review", reviewStatus: "requested", approvalRevision: 3, updatedAt: "2026-10-28T10:00:00Z" });
function deferred<T>() { let resolve!: (value:T)=>void; let reject!: (error:unknown)=>void; const promise = new Promise<T>((yes,no)=>{resolve=yes;reject=no;}); return {promise,resolve,reject}; }
function fixture(adapter: Partial<PlanningStateAdapter> = {}) { return createPlanningState({ userId: "user", initialData: {...emptyPlanningShellState,tasks:[task]}, adapter:{ saveTask:async(_,patch)=>({task:{...patch,updatedAt:"2026-10-28T10:02:00Z"}}),readWorkspace:async()=>null,...adapter} }); }
test("approval publishes its actual revision and related child status while pending display stays out of cache", async()=>{
 const response=deferred<{task:Partial<Task>}>(); const child={...task,id:"child",taskType:"sub_issue" as const,parentTaskId:task.id,parentApprovalStatus:"proposed" as const};
 const owner=createPlanningState({userId:"user",initialData:{...emptyPlanningShellState,tasks:[{...task,approvalStatus:"proposed"},child]},adapter:{saveTask:async()=>({task:{}}),readWorkspace:async()=>null,decideTaskApproval:()=>response.promise}});
 const writing=owner.planning.decideTaskApproval({...task,approvalStatus:"proposed"},"approve");
 expect(owner.planning.board().tasks[0].approvalStatus).toBe("approved"); expect(owner.planning.protectedCache()?.tasks[0].approvalStatus).toBe("proposed");
 response.resolve({task:{id:task.id,approvalStatus:"approved",approvalRevision:4,updatedAt:"2026-10-28T10:01:00Z"}});
 expect(await writing).toMatchObject({ok:true}); expect(owner.planning.protectedCache()?.tasks[0]).toMatchObject({approvalRevision:4,approvalStatus:"approved"}); expect(owner.planning.board().tasks[1].parentApprovalStatus).toBe("approved");
});

const input={decision:"accepted" as const,points:10,checklist:{acceptanceCriteriaMet:true,evidenceProvided:true,communicationClear:true,blockerHandled:true},comment:"Accepted with evidence"};
const review:TaskReview={id:7,taskId:task.id,sprintId:"",reviewerProfileId:"reviewer",decision:"accepted",points:10,checklist:input.checklist,comment:input.comment,createdAt:"2026-10-28T10:01:00Z"};
function detail(patch:Partial<Task>={},reviews:TaskReview[]=[]):TaskDetailModel{return {revision:"detail",project:emptyPlanningShellState.project,item:{...task,...patch},ancestors:[],children:[],relatedItems:[],people:[],sprints:[],discussion:{comments:[],externalComments:[]},blockers:[],relationships:[],activity:[],reviews,coverage:{timeline:"complete"}};}
test("a held Review receipt publishes actual Task, Review and activity once and rejects an older detail response",async()=>{
 const held=deferred<{model:TaskDetailModel}>();let captured:Task|undefined;
 const activity={id:8,taskId:task.id,action:"review_accepted",actorProfileId:"reviewer",message:"Actual review",beforeData:null,afterData:null,createdAt:review.createdAt};
 const {planning}=fixture({readTaskDetail:()=>held.promise,decideTaskReview:async basis=>{captured=basis;return {task:{id:task.id,status:"Erledigt",reviewStatus:"accepted",updatedAt:review.createdAt,scoreFinal:true},review,activities:[activity]};}});
 const reading=planning.loadTaskDetail(task.id);expect(await planning.decideTaskReview(task,input)).toMatchObject({ok:true}); expect(captured?.updatedAt).toBe(task.updatedAt);
 held.resolve({model:detail()});await reading;expect(planning.taskDetail(task.id).task).toMatchObject({status:"Erledigt",scoreFinal:true});expect(planning.taskDetail(task.id).reviews).toEqual([review]);expect(planning.taskDetail(task.id).activities).toEqual([activity]);
});
test("unknown Review retains submitted input and a matching read never proves or repeats the decision",async()=>{
 let writes=0,reads=0;const {planning}=fixture({decideTaskReview:async()=>{writes++;throw new Error("Lost confirmation");},readTaskDetail:async()=>{reads++;return {model:detail({status:"Erledigt",reviewStatus:"accepted",updatedAt:review.createdAt},[review])};}});
 expect(await planning.decideTaskReview(task,input)).toMatchObject({ok:false,kind:"unconfirmed"}); const op=planning.taskReviewOperations(task.id)[0];expect(op).toMatchObject({phase:"unconfirmed",submitted:{task:{updatedAt:task.updatedAt},command:{kind:"decision",input}}});expect(reads).toBe(0);
 await Promise.all([planning.checkTaskReview(op.id),planning.checkTaskReview(op.id)]);expect(planning.taskReviewOperations(task.id)[0]).toMatchObject({phase:"unconfirmed",readStatus:"current"});expect(await planning.saveTask(task,{title:"Dependent"})).toMatchObject({kind:"unconfirmed"});expect(await planning.decideTaskReview(task,input)).toMatchObject({code:"predecessor_unconfirmed"});expect({writes,reads}).toEqual({writes:1,reads:1});
});

test("a rejected old Review never rolls back a newer confirmed task field",async()=>{
 const held=deferred<{task:Partial<Task>}>();const {planning}=fixture({decideTaskReview:()=>held.promise,readTaskDetail:async()=>({model:detail({title:"New confirmed title",updatedAt:"2026-10-28T10:02:00Z"})})});
 const writing=planning.decideTaskReview(task,input);await planning.loadTaskDetail(task.id);
 held.reject(Object.assign(new Error("Review no longer active"),{status:409}));expect(await writing).toMatchObject({ok:false,kind:"rejected"});expect(planning.board().tasks[0]).toMatchObject({title:"New confirmed title",status:"Review"});
});
test.each([400,403,409])("known Review policy HTTP%s remains rejection, not revision conflict or unknown",async status=>{
 let reads=0;const {planning}=fixture({decideTaskReview:async()=>{throw Object.assign(new Error("Protected by policy"),{status});},readTaskDetail:async()=>{reads++;return {model:detail()};}});
 expect(await planning.decideTaskReview(task,input)).toMatchObject({kind:"rejected",status});expect(planning.taskReviewOperations(task.id)[0].phase).toBe("rejected");expect(planning.board().tasks[0].status).toBe("Review");expect(reads).toBe(0);
});
test("a real revision conflict keeps submitted input, loads current basis and needs a new deliberate decision",async()=>{
 let reads=0,writes=0;const changed={...task,updatedAt:"2026-10-28T10:03:00Z"};const {planning}=fixture({decideTaskReview:async basis=>{writes++;if(writes===1)throw Object.assign(new Error("Changed"),{status:409,kind:"versionConflict"});expect(basis.updatedAt).toBe(changed.updatedAt);return {task:{...changed,reviewStatus:"accepted",updatedAt:review.createdAt},review};},readTaskDetail:async()=>{reads++;return {model:detail(changed)};}});
 expect(await planning.decideTaskReview(task,input)).toMatchObject({kind:"versionConflict"});const operation=planning.taskReviewOperations(task.id)[0];await planning.checkTaskReview(operation.id);expect(planning.taskReviewOperations(task.id)[0]).toMatchObject({phase:"conflict",submitted:{task:{updatedAt:task.updatedAt}}});expect(writes).toBe(1);expect(reads).toBe(1);expect(await planning.decideTaskReview(changed,input)).toMatchObject({ok:true});expect(planning.taskReviewOperations(task.id).map(op=>op.phase)).toEqual(["confirmed"]);
});
test.each(["request","withdraw","reopen"] as const)("%s accepts the actual partial task receipt without replacing unrelated fields",async kind=>{
 let sent:Task|undefined;const write=async(basis:Task)=>{sent=basis;return {task:{id:task.id,status:kind==="withdraw"?"In Arbeit":"Review",updatedAt:review.createdAt}};};const {planning}=fixture({requestTaskReview:write,withdrawTaskReview:write,reopenTaskReview:write});
 const result=kind==="request"?await planning.requestTaskReview(task,{reviewOwnerProfileId:"reviewer"}):kind==="withdraw"?await planning.withdrawTaskReview(task,"More evidence needed"):await planning.reopenTaskReview(task,{evidenceLink:"https://example.com/proof"});expect(result).toMatchObject({ok:true});expect(sent?.updatedAt).toBe(task.updatedAt);expect(planning.protectedCache()?.tasks[0]).toMatchObject({title:task.title,updatedAt:review.createdAt});
});
test.each([null,"replacement"])("session replacement %s discards held Review receipts and inputs",async account=>{
 const held=deferred<{task:Partial<Task>;review:TaskReview}>();const owner=fixture({decideTaskReview:()=>held.promise});const writing=owner.planning.decideTaskReview(task,input);owner.internal.sessionChanged(account);held.resolve({task:{...task,updatedAt:review.createdAt},review});expect(await writing).toMatchObject({kind:"sessionSuperseded"});expect(owner.planning.taskReviewOperations()).toEqual([]);expect(owner.planning.protectedCache()).toBeNull();
});
test("task denial hides retained Review input and late receipts",async()=>{
 const held=deferred<{task:Partial<Task>;review:TaskReview}>();const {planning}=fixture({decideTaskReview:()=>held.promise,readTaskDetail:async()=>{throw Object.assign(new Error("Denied"),{status:403});}});const writing=planning.decideTaskReview(task,input);await planning.loadTaskDetail(task.id);held.resolve({task:{...task,updatedAt:review.createdAt},review});expect(await writing).toMatchObject({kind:"sessionSuperseded"});expect(planning.taskReviewOperations()).toEqual([]);expect(planning.taskDetail(task.id).task).toBeNull();expect(planning.protectedCache()?.tasks).toEqual([]);
});
test("unknown approval pauses dependent child edits and creation while independent tasks remain writable",async()=>{
 const parent={...task,approvalStatus:"proposed" as const};const child={...task,id:"child",parentTaskId:task.id,taskType:"sub_issue" as const};const other={...task,id:"other"};let writes=0;
 const {planning}=createPlanningState({userId:"user",initialData:{...emptyPlanningShellState,tasks:[parent,child,other]},adapter:{readWorkspace:async()=>null,saveTask:async(_,patch)=>{writes++;return {task:{...patch,updatedAt:review.createdAt}};},decideTaskApproval:async()=>{throw new Error("Lost");},createTask:async()=>{throw new Error("Must not send");}}});
 await planning.decideTaskApproval(parent,"approve");expect(await planning.saveTask(child,{title:"Dependent"})).toMatchObject({kind:"unconfirmed"});expect(await planning.createTask({creationRequestId:"new",taskType:"sub_issue",parentTaskId:parent.id,ownerId:"owner",title:"Dependent child",description:""})).toMatchObject({kind:"unconfirmed"});expect(await planning.saveTask(other,{title:"Independent"})).toMatchObject({ok:true});expect(writes).toBe(1);
});

test("approval-derived child state survives a pre-decision detail read",async()=>{
 const held=deferred<{model:TaskDetailModel}>();const parent={...task,approvalStatus:"proposed" as const};const child={...task,id:"child",parentTaskId:task.id,taskType:"sub_issue" as const,parentApprovalStatus:"proposed" as const};
 const {planning}=createPlanningState({userId:"user",initialData:{...emptyPlanningShellState,tasks:[parent,child]},adapter:{saveTask:async()=>({task:{}}),readWorkspace:async()=>null,readTaskDetail:()=>held.promise,decideTaskApproval:async()=>({task:{id:task.id,approvalRevision:4,approvalStatus:"approved",updatedAt:review.createdAt}})}});
 const reading=planning.loadTaskDetail(task.id);await planning.decideTaskApproval(parent,"approve");held.resolve({model:{...detail(parent),children:[child]}});await reading;expect(planning.taskDetail(child.id).task?.parentApprovalStatus).toBe("approved");
});

test("recovery from task denial cannot admit an earlier held decision response",async()=>{
 const held=deferred<{task:Partial<Task>;review:TaskReview}>();let reads=0;const {planning}=fixture({decideTaskReview:()=>held.promise,readTaskDetail:async()=>{if(++reads===1)throw Object.assign(new Error("Denied"),{status:403});return {model:detail({title:"Authorized fresh stand",updatedAt:"2026-10-28T10:05:00Z"})};}});
 const writing=planning.decideTaskReview(task,input);await planning.loadTaskDetail(task.id);await planning.loadTaskDetail(task.id);held.resolve({task:{...task,title:"Held earlier receipt",updatedAt:review.createdAt},review});expect(await writing).toMatchObject({kind:"sessionSuperseded"});expect(planning.taskDetail(task.id).task?.title).toBe("Authorized fresh stand");expect(planning.taskDetail(task.id).reviews).toEqual([]);
});

test("a child dependency check follows its unresolved parent approval without inventing a child operation",async()=>{
 const child={...task,id:"child",parentTaskId:task.id,taskType:"sub_issue" as const};let reads=0;
 const {planning}=createPlanningState({userId:"user",initialData:{...emptyPlanningShellState,tasks:[task,child]},adapter:{saveTask:async()=>({task:{}}),readWorkspace:async()=>null,decideTaskApproval:async()=>{throw new Error("Lost");},readTaskDetail:async id=>{expect(id).toBe(task.id);reads++;return {model:{...detail(),children:[child]}};}}});
 await planning.decideTaskApproval(task,"approve");expect(await planning.checkTaskSave(child.id)).toMatchObject({outcome:"unconfirmed",readStatus:"current"});expect(reads).toBe(1);expect(planning.taskReviewOperations(child.id)).toEqual([]);
});

test("an approval refreshes an already loaded timeline without undoing its confirmed decision when that read fails",async()=>{
 let reads=0;const {planning}=fixture({readTaskDetail:async()=>{if(++reads>1)throw new Error("Timeline unavailable");return {model:detail()};},decideTaskApproval:async()=>({task:{id:task.id,approvalStatus:"draft",approvalRevision:4,updatedAt:review.createdAt}})});
 await planning.loadTaskDetail(task.id);expect(await planning.decideTaskApproval(task,"return_to_draft","Need scope revision")).toMatchObject({ok:true});await Promise.resolve();expect(reads).toBe(2);expect(planning.taskDetail(task.id).task).toMatchObject({approvalStatus:"draft",approvalRevision:4});expect(planning.taskReviewOperations(task.id)[0].phase).toBe("confirmed");
});

test("a successful HTTP-style response without the real approval revision remains unconfirmed",async()=>{
 const {planning}=fixture({decideTaskApproval:async()=>({task:{id:task.id,updatedAt:review.createdAt}})});expect(await planning.decideTaskApproval(task,"approve")).toMatchObject({kind:"unconfirmed"});expect(planning.protectedCache()?.tasks[0].approvalRevision).toBe(3);expect(planning.taskReviewOperations(task.id)[0].phase).toBe("unconfirmed");
});

test("an unavailable unknown check does not present a previously cached Task as newly verified server data",async()=>{
 const {planning}=fixture({decideTaskReview:async()=>{throw new Error("Lost");},readTaskDetail:async()=>{throw new Error("Read unavailable");}});await planning.decideTaskReview(task,input);const id=planning.taskReviewOperations(task.id)[0].id;await planning.checkTaskReview(id);expect(planning.taskReviewOperations(task.id)[0]).toMatchObject({phase:"unconfirmed",readStatus:"unavailable",serverTask:null});
});

test("an opened Deliverable cannot submit a Review while its decision basis is unknown", async () => {
  let writes = 0;
  const { planning } = fixture({
    readTaskReviewBasis: () => new Promise(() => {}),
    decideTaskReview: async () => {
      writes++;
      return { task: { id: task.id, updatedAt: review.createdAt }, review };
    },
  });

  await expect(planning.decideTaskReview(task, input)).resolves.toMatchObject({ ok: false });
  expect(writes).toBe(0);
  expect(planning.taskDetail(task.id).task?.reviewStatus).toBe("requested");
});

const basisTime = Date.parse("2026-10-28T10:00:30Z");
function reviewBasis(overrides: Partial<import("@/features/reviews/model/deliverable-review-basis").DeliverableReviewBasis> = {}) {
  return {
    taskId: task.id, taskUpdatedAt: task.updatedAt!, sourceRevision: "review-source-1",
    evaluatedAt: new Date(basisTime).toISOString(), validUntil: new Date(basisTime + 60_000).toISOString(),
    readAuthority: { userId: "user", deadline: basisTime + 60_000 },
    readActor: { profileId: "reviewer", platformRole: "ceo" as const },
    evidence: { status: "present" as const, hasException: false, links: [{ taskId: task.id, title: "Original", url: "https://example.com/review-evidence", kind: "evidence" as const }], exceptionNote: null }, sprintLock: { sprintId: null, locked: false },
    decision: { status: "allowed" as const, token: "verified-review-token" }, ...overrides,
  };
}
function scopedReviewOwner(adapter: Partial<PlanningStateAdapter>) {
  const profile = { id: "reviewer", name: "Review Owner", platformRole: "ceo" as const, orgRole: "CEO", githubLogin: "", weeklyCapacity: 40 };
  return createPlanningState({
    userId: "user", initialSession: { userId: "user", user: { id: "user" }, revision: "session-1", expiresAt: (basisTime + 120_000) / 1000 },
    initialCurrentProfile: profile, initialData: { ...emptyPlanningShellState, tasks: [task] },
    adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => null, now: () => basisTime, ...adapter },
  });
}

test("the opened Deliverable can submit from a scoped basis without opening unrelated Reviews", async () => {
  const reads: string[] = [], writes: string[] = [];
  const owner = scopedReviewOwner({
    readTaskReviewBasis: async id => { reads.push(id); return reviewBasis(); },
    readWorkspace: async () => { throw new Error("Unrelated Review collection unavailable"); },
    decideTaskReview: async (_, __, token) => {
      if (token) writes.push(token);
      return { task: { id: task.id, reviewStatus: "accepted", updatedAt: review.createdAt }, review };
    },
  });

  try {
    await expect(owner.planning.loadTaskReviewBasis(task.id)).resolves.toBe(true);
    expect(owner.planning.taskReviewBasis(task.id)).toEqual({
      readStatus: "current", evidence: { status: "present", hasException: false, links: [{ taskId: task.id, title: "Original", url: "https://example.com/review-evidence", kind: "evidence" }], exceptionNote: null }, sprintLock: { sprintId: null, locked: false },
    });
    await expect(owner.planning.decideTaskReview(task, input)).resolves.toMatchObject({ ok: true });
    expect(reads).toEqual([task.id]);
    expect(writes).toEqual(["verified-review-token"]);
    expect(owner.planning.taskReviewBasis(task.id)?.readStatus).toBe("stale");
    expect(JSON.stringify(owner.planning.protectedCache())).not.toContain(writes[0]);
  } finally { owner.internal.dispose(); }
});

test("the original Review deadline expires even while the session and source remain unchanged", async () => {
  let now = basisTime;
  const owner = scopedReviewOwner({
    now: () => now,
    readTaskReviewBasis: async () => reviewBasis({ readAuthority: { userId: "user", deadline: basisTime + 1 } }),
    decideTaskReview: async () => { throw new Error("Expired basis must not be sent"); },
  });
  try {
    await expect(owner.planning.loadTaskReviewBasis(task.id)).resolves.toBe(true);
    now += 1;
    await expect(owner.planning.decideTaskReview(task, input)).resolves.toMatchObject({ code: "review_basis_required" });
    expect(owner.planning.taskReviewBasis(task.id)).toEqual({ readStatus: "stale" });
  } finally { owner.internal.dispose(); }
});

test("a denied Review basis leaves the independent Deliverable detail readable", async () => {
  const owner = scopedReviewOwner({ readTaskReviewBasis: async () => { throw Object.assign(new Error("Review denied"), { status: 403 }); } });
  try {
    await expect(owner.planning.loadTaskReviewBasis(task.id)).resolves.toBe(false);
    expect(owner.planning.taskReviewBasis(task.id)).toEqual({ readStatus: "forbidden" });
    expect(owner.planning.taskDetail(task.id).task?.title).toBe("Original");
    await expect(owner.planning.decideTaskReview(task, input)).resolves.toMatchObject({ code: "review_basis_required" });
  } finally { owner.internal.dispose(); }
});

test("a Review result started before a confirmed evidence edit cannot authorize the decision", async () => {
  const basis = deferred<ReturnType<typeof reviewBasis>>();
  const reached = deferred<void>();
  const owner = scopedReviewOwner({
    readTaskReviewBasis: () => { reached.resolve(); return basis.promise; },
    saveTask: async (_, patch) => ({ task: { ...patch, id: task.id, updatedAt: review.createdAt } }),
  });
  try {
    const loading = owner.planning.loadTaskReviewBasis(task.id);
    await reached.promise;
    await expect(owner.planning.saveTask(task, { evidenceLinks: ["https://example.com/updated-evidence"] })).resolves.toMatchObject({ ok: true });
    basis.resolve(reviewBasis());
    await expect(loading).resolves.toBe(false);
    expect(owner.planning.taskReviewBasis(task.id)).toEqual({ readStatus: "stale" });
    expect(owner.planning.taskDetail(task.id).task?.evidenceLinks).toEqual(["https://example.com/updated-evidence"]);
  } finally { owner.internal.dispose(); }
});

test("a held Review basis from a replaced session cannot republish protected decision data", async () => {
  const basis = deferred<ReturnType<typeof reviewBasis>>();
  const reached = deferred<void>();
  const owner = scopedReviewOwner({ readTaskReviewBasis: () => { reached.resolve(); return basis.promise; } });
  try {
    const loading = owner.planning.loadTaskReviewBasis(task.id);
    await reached.promise;
    owner.internal.bindSession({ userId: "user", user: { id: "user" }, revision: "session-2", expiresAt: (basisTime + 120_000) / 1000 });
    basis.resolve(reviewBasis());
    await expect(loading).resolves.toBe(false);
    expect(owner.planning.taskReviewBasis(task.id)).toEqual({ readStatus: "not-loaded" });
  } finally { owner.internal.dispose(); }
});

test("the Owner rejects a Review receipt for a different Actor with the same browser session", async () => {
  const owner = scopedReviewOwner({
    readTaskReviewBasis: async () => reviewBasis({ readActor: { profileId: "different-reviewer", platformRole: "ceo" } }),
  });
  try {
    await expect(owner.planning.loadTaskReviewBasis(task.id)).resolves.toBe(false);
    expect(owner.planning.taskReviewBasis(task.id)).toEqual({ readStatus: "unavailable" });
    await expect(owner.planning.decideTaskReview(task, input)).resolves.toMatchObject({ code: "review_basis_required" });
  } finally { owner.internal.dispose(); }
});

test("a server-side stale Review reply invalidates the button basis and keeps the submitted decision explicit", async () => {
  let writes = 0;
  const owner = scopedReviewOwner({
    readTaskReviewBasis: async () => reviewBasis(),
    decideTaskReview: async () => {
      writes++;
      throw Object.assign(new Error("Review source changed"), { status: 409, code: "stale_review_basis" });
    },
  });
  try {
    await expect(owner.planning.loadTaskReviewBasis(task.id)).resolves.toBe(true);
    await expect(owner.planning.decideTaskReview(task, input)).resolves.toMatchObject({ kind: "rejected", status: 409 });
    expect(owner.planning.taskReviewOperations(task.id)[0]).toMatchObject({ phase: "rejected", submitted: { command: { kind: "decision", input } } });
    expect(owner.planning.taskReviewBasis(task.id)).toEqual({ readStatus: "stale" });
    await expect(owner.planning.decideTaskReview(task, input)).resolves.toMatchObject({ code: "review_basis_required" });
    expect(writes).toBe(1);
  } finally { owner.internal.dispose(); }
});
