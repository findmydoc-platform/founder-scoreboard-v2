import { expect, test } from "vitest";
import { createPlanningState, type PlanningStateAdapter } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { taskDetailStoryTask } from "@/features/tasks/molecules/task-detail-story-fixtures";
import { emptyPlanningHeaderData, readyHeaderSlot } from "@/lib/planning-header-data";
import type { Task, TaskRelation } from "@/lib/types";
import type { TaskDetailModel } from "@/features/tasks/model/task-detail-read-model";
const source=taskDetailStoryTask({id:"source",updatedAt:"source-r1"}),target=taskDetailStoryTask({id:"target",updatedAt:"target-r1"});
const relation:TaskRelation={id:7,taskId:source.id,relatedTaskId:target.id,relationType:"blocked_by",note:"Original note",createdBy:"author",createdAt:"2026-10-28T00:00:00Z"};
const input={relationType:relation.relationType,relatedTaskId:target.id,note:relation.note};
function deferred<T>(){let resolve!:(value:T)=>void,reject!:(error:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return{promise,resolve,reject};}
function fixture(adapter:Partial<PlanningStateAdapter>={},relations:TaskRelation[]=[]){return createPlanningState({userId:"user",initialData:{...emptyPlanningShellState,tasks:[source,target,{...source,id:"other"}],taskRelations:relations},adapter:{readWorkspace:async()=>null,saveTask:async(_,patch)=>({task:{...patch,updatedAt:"saved-r2"}}),...adapter}});}
function detail(task:Task,relationships:TaskRelation[]=[]):TaskDetailModel{return{revision:"read",project:emptyPlanningShellState.project,item:{...task,updatedAt:`${task.id}-r2`,githubIssueSyncStatus:"not_synced"},ancestors:[],children:[],relatedItems:[],people:[],sprints:[],discussion:{comments:[],externalComments:[]},blockers:[],relationships,activity:[],reviews:[],coverage:{relationships:"complete"}};}
test("confirmed relationship accepts its actual identity and verifies each endpoint Task without inventing revisions",async()=>{
 const reads:string[]=[];const {planning}=fixture({addTaskRelationship:async(task,payload)=>{expect(task.updatedAt).toBe("source-r1");expect(payload).toEqual(input);return{relation};},readTaskDetail:async id=>{reads.push(id);return{model:detail(id===source.id?source:target,[relation])};}});expect(await planning.addTaskRelationship(source,input)).toMatchObject({ok:true});await planning.checkTaskRelationshipChange(planning.taskRelationshipChanges(source.id)[0].id);expect(planning.taskDetail(source.id).relationships).toEqual([relation]);expect(planning.protectedCache()?.tasks.find(task=>task.id===source.id)?.updatedAt).toBe("source-r2");expect(planning.protectedCache()?.tasks.find(task=>task.id===target.id)?.updatedAt).toBe("target-r2");expect(reads.sort()).toEqual(["source","target"]);
});

test("a denied endpoint cannot expose the other endpoint's unverified Task basis",async()=>{
 const fresh=deferred<{model:TaskDetailModel}>();const {planning}=fixture({addTaskRelationship:async()=>({relation}),readTaskDetail:async id=>{if(id===target.id)throw Object.assign(new Error("Denied"),{status:403});return fresh.promise;}});await planning.addTaskRelationship(source,input);await Promise.resolve();await Promise.resolve();expect(planning.protectedCache()?.tasks.find(task=>task.id===source.id)?.updatedAt).toBeUndefined();fresh.resolve({model:detail(source,[relation])});await planning.checkTaskSave(source.id);expect(planning.protectedCache()?.tasks.find(task=>task.id===source.id)?.updatedAt).toBe("source-r2");
});

test("confirmed removal retires a #548 creation receipt and cannot be restored by an older read",async()=>{
 const old=deferred<{model:TaskDetailModel}>();let reads=0;const {planning}=fixture({createTask:async()=>({task:target,relation}),removeTaskRelationship:async()=>({relationId:relation.id}),readTaskDetail:async id=>{if(++reads===1)return old.promise;return{model:detail(id===source.id?source:target,[])};}});await planning.createTask({creationRequestId:"created",title:"New task",description:"",taskType:"deliverable",parentTaskId:"",ownerId:"author"});const loading=planning.loadTaskDetail(source.id);await planning.removeTaskRelationship(source,relation);old.resolve({model:detail(source,[relation])});await loading;await planning.checkTaskRelationshipChange(planning.taskRelationshipChanges(source.id)[0].id);expect(planning.taskDetail(source.id).relationships).toEqual([]);expect(planning.taskDetail(target.id).relationships).toEqual([]);
});
test("a late lifecycle creation response cannot resurrect an already confirmed relationship removal",async()=>{
 const created={...target,id:"created"},edge={...relation,taskId:created.id,relatedTaskId:source.id};const creating=deferred<{task:Task;relation:TaskRelation}>();let removed=false;const {planning}=fixture({createTask:()=>creating.promise,removeTaskRelationship:async()=>{removed=true;return{relationId:edge.id};},readTaskDetail:async id=>({model:{...detail(id===source.id?source:created,removed?[]:[edge]),relatedItems:id===source.id?[created]:[]}})});const creation=planning.createTask({creationRequestId:"late",title:"Created",description:"",taskType:"deliverable",parentTaskId:"",ownerId:"author"});await planning.loadTaskDetail(source.id);await planning.removeTaskRelationship(planning.taskDetail(source.id).task!,edge);creating.resolve({task:created,relation:edge});await creation;expect(planning.taskDetail(source.id).relationships).toEqual([]);
});

test("a rejected optimistic removal restores only its own edge and preserves a concurrent Task save",async()=>{
 const response=deferred<{relationId:number}>(),saved=deferred<{task:{title:string;updatedAt:string}}>();const independent={...relation,id:8,taskId:"other",relatedTaskId:target.id};const {planning}=fixture({removeTaskRelationship:()=>response.promise,saveTask:()=>saved.promise},[relation,independent]);const saving=planning.saveTask(source,{title:"Concurrent title"}),removing=planning.removeTaskRelationship(source,relation);expect(planning.taskDetail(source.id).relationships).toEqual([]);saved.resolve({task:{title:"Concurrent title",updatedAt:"saved-r2"}});await saving;response.reject(Object.assign(new Error("Forbidden"),{status:403}));expect(await removing).toMatchObject({kind:"rejected"});expect(planning.taskDetail(source.id).relationships).toEqual([relation]);expect(planning.taskDetail("other").relationships).toEqual([independent]);expect(planning.taskDetail(source.id).task).toMatchObject({title:"Concurrent title",updatedAt:"saved-r2"});
});
test.each(["add","remove"] as const)("unknown %s retains input and GET checks never repeat its mutation",async kind=>{
 let writes=0,reads=0;const fail=async()=>{writes++;throw new Error("Lost");};const {planning}=fixture({addTaskRelationship:fail,removeTaskRelationship:fail,readTaskDetail:async id=>{reads++;return{model:detail(id===source.id?source:target,kind==="add"?[relation]:[])};}},kind==="remove"?[relation]:[]);expect(await(kind==="add"?planning.addTaskRelationship(source,input):planning.removeTaskRelationship(source,relation))).toMatchObject({kind:"unconfirmed"});expect(reads).toBe(0);const view=planning.taskRelationshipChanges(source.id)[0];await planning.refreshWorkspace("backlog");await Promise.all([planning.checkTaskRelationshipChange(view.id),planning.checkTaskRelationshipChange(view.id)]);expect(planning.taskRelationshipChanges(source.id)[0]).toMatchObject({phase:"unconfirmed",submitted:input});expect(await planning.addTaskRelationship(source,input)).toMatchObject({kind:"blocked"});expect(await planning.saveTask(source,{title:"Dependent"})).toMatchObject({kind:"unconfirmed"});expect(await planning.saveTask({...source,id:"other"},{title:"Independent"})).toMatchObject({ok:true});expect({writes,reads}).toEqual({writes:1,reads:2});
});
test("a stale shown source basis is rejected without advancing it to a newer accepted read",async()=>{
 let writes=0;const {planning}=fixture({addTaskRelationship:async()=>{writes++;return{relation};},readTaskDetail:async()=>({model:detail(source,[])})});await planning.loadTaskDetail(source.id);expect(await planning.addTaskRelationship(source,input)).toMatchObject({kind:"rejected",status:409});expect(writes).toBe(0);
});
test("partial relationship reads retain other scopes and complete absence tombstones exclude unseen old IDs",async()=>{
 const old=deferred<{data:typeof emptyPlanningShellState;coverage:{taskRelations:"partial"}}>();const {planning}=fixture({readWorkspace:()=>old.promise,readTaskDetail:async()=>({model:detail(source,[])})},[relation]);const reading=planning.refreshWorkspace("planning");await planning.loadTaskDetail(source.id);old.resolve({data:{...emptyPlanningShellState,tasks:[source,target],taskRelations:[{...relation,id:99}]},coverage:{taskRelations:"partial"}});await reading;expect(planning.taskDetail(source.id).relationships).toEqual([]);
});
test.each([null,"replacement"])("session %s rejects late relationship confirmation and clears submitted note",async account=>{
 const response=deferred<{relation:TaskRelation}>();const owner=fixture({addTaskRelationship:()=>response.promise});const adding=owner.planning.addTaskRelationship(source,input);owner.internal.sessionChanged(account);response.resolve({relation});expect(await adding).toMatchObject({kind:"ended"});expect(owner.planning.taskRelationshipChanges(source.id)).toEqual([]);expect(owner.planning.taskDetail(source.id).relationships).toEqual([]);
});

test("confirmed endpoint reads remain independent and retry only the endpoint still unavailable",async()=>{
 const reads:string[]=[];let unavailable=true;const {planning}=fixture({addTaskRelationship:async()=>({relation}),readTaskDetail:async id=>{reads.push(id);if(id===target.id&&unavailable)throw new Error("Target unavailable");return{model:detail(id===source.id?source:target,[relation])};}});await planning.addTaskRelationship(source,input);const id=planning.taskRelationshipChanges(source.id)[0].id;await planning.checkTaskRelationshipChange(id);expect(await planning.saveTask(planning.taskDetail(source.id).task!,{title:"Source independent of target read"})).toMatchObject({ok:true});expect(await planning.saveTask(target,{title:"Target waits"})).toMatchObject({kind:"unconfirmed"});unavailable=false;await planning.checkTaskRelationshipChange(id);expect(reads).toEqual(["source","target","target"]);expect(planning.taskDetail(source.id).task?.title).toBe("Source independent of target read");
});
test.each([["confirmed",false,0],["confirmed",true,1],["unknown",true,1],["rejected",true,0]] as const)("%s relationship add only invalidates loaded notification Header when note can contain mentions (%s)",async(mode,mention,expected)=>{
 let reads=0;const header={...emptyPlanningHeaderData,notifications:readyHeaderSlot({unreadCount:0,items:[]})};const {planning}=createPlanningState({userId:"user",initialData:{...emptyPlanningShellState,tasks:[source,target]},initialHeaderData:header,adapter:{readWorkspace:async()=>null,saveTask:async()=>({task:{}}),addTaskRelationship:async()=>{if(mode!=="confirmed")throw Object.assign(new Error("Failure"),mode==="rejected"?{status:403}:{});return{relation};},readHeader:async slots=>{expect(slots).toEqual(["notifications"]);reads++;return header;}}});await planning.addTaskRelationship(source,{...input,note:mention?"@author help":"No mention"});expect(reads).toBe(expected);expect(planning.header().slots.quickLinks.readStatus).toBe("not-loaded");
});


test("expiry clears submitted relationship metadata before a late confirmation", async () => {
 let now = 0;
 const response = deferred<{ relation: TaskRelation }>();
 const { planning } = createPlanningState({ userId: "user", initialSession: { userId: "user", revision: "session", expiresAt: 1, user: { id: "user" } }, initialData: { ...emptyPlanningShellState, tasks: [source, target] }, adapter: { now: () => now, readWorkspace: async () => null, saveTask: async () => ({ task: {} }), addTaskRelationship: () => response.promise } });
 const adding = planning.addTaskRelationship(source, input);
 now = 1000;
 response.resolve({ relation });
 expect(await adding).toMatchObject({ kind: "ended" });
 expect(planning.taskRelationshipChanges(source.id)).toEqual([]);
 expect(planning.protectedCache()).toBeNull();
});
