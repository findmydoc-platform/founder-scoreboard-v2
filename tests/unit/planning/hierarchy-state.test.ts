import { useInitiativeCommands } from "@/features/projects/hooks/use-initiative-commands";
import type { InitiativeDraft } from "@/features/projects/model/hierarchy-state";
import { expect, test } from "vitest";
import { createPlanningState } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { taskDetailStoryTask } from "@/features/tasks/molecules/task-detail-story-fixtures";
const epic=taskDetailStoryTask({id:"epic",taskType:"epic",approvalStatus:null,updatedAt:"shown-r1"});
const draft={id:epic.id,expectedUpdatedAt:epic.updatedAt,creationRequestId:"editor",title:"Accepted milestone",description:"Goal",targetDate:"2026-12-01",status:"active" as const};
test("Epic editor saves the original shown version through the common Task owner",async()=>{
 let calls=0;const {planning}=createPlanningState({userId:"user",initialData:{...emptyPlanningShellState,tasks:[epic]},adapter:{readWorkspace:async()=>null,saveTask:async(basis,patch)=>{calls++;expect(basis.updatedAt).toBe("shown-r1");expect(patch).toMatchObject({title:draft.title,status:"In Arbeit",targetDate:draft.targetDate});return{task:{...patch,updatedAt:"accepted-r2"}};}}});
 const editor=planning.beginEpicEdit(draft);expect(await editor.save(draft)).toMatchObject({ok:true});expect(planning.taskDetail(epic.id).task).toMatchObject({title:draft.title,updatedAt:"accepted-r2"});expect(calls).toBe(1);
});

test("empty Epic deletion fences old reads and late child creation without reverting independent confirmed work",async()=>{
 let finish!:(value:import("@/features/planning/model/planning-task-lifecycle").PlanningTaskCreationConfirmation)=>void; let finishRead!:(value:import("@/features/planning/model/internal/planning-state-owner").PlanningWorkspaceRead|null)=>void;
 const other=taskDetailStoryTask({id:"other",title:"Independent",updatedAt:"other-r1"});
 const {planning}=createPlanningState({userId:"user",initialData:{...emptyPlanningShellState,tasks:[epic,other]},adapter:{readWorkspace:()=>new Promise(resolve=>{finishRead=resolve;}),removeTask:async(task,action)=>{expect(task.updatedAt).toBe("shown-r1");expect(action).toBe("delete_epic");return{affectedTaskIds:[task.id]};},createTask:()=>new Promise(resolve=>{finish=resolve;}),saveTask:async()=>({task:{title:"Confirmed independent",updatedAt:"other-r2"}})}});
 const oldRead=planning.refreshWorkspace("projects");
 const creation=planning.createTask({creationRequestId:"late-child",taskType:"initiative",parentTaskId:epic.id,title:"Late child",description:"Goal",ownerId:""});
 expect(await planning.deleteEmptyEpic(epic)).toMatchObject({ok:true});
 await planning.beginTaskEdit(other).save({title:"Confirmed independent"});
 finish({task:taskDetailStoryTask({id:"late",taskType:"initiative",parentTaskId:epic.id,updatedAt:"late-r1"})});
 expect(await creation).toMatchObject({ok:false});
 finishRead({data:{...emptyPlanningShellState,tasks:[epic,other]},taskCoverage:"complete"});await oldRead;
 expect(planning.taskDetail(epic.id).task).toBeNull();
 expect(planning.taskDetail("late").task).toBeNull();
 expect(planning.taskDetail(other.id).task?.title).toBe("Confirmed independent");
});

const initiative=taskDetailStoryTask({id:"initiative",taskType:"initiative",parentTaskId:epic.id,updatedAt:"original/source"});
const initiativeDraft={id:initiative.id,expectedUpdatedAt:initiative.updatedAt,creationRequestId:"initiative-form",title:"Changed initiative",parentTaskId:epic.id,ownerId:"owner",accountableProfileId:"owner",responsibleProfileIds:["owner"],consultedProfileIds:[],informedProfileIds:[],priority:"P2",status:"planned" as const,targetDate:"",goal:"Confirmed goal",successCriteria:"Observable outcome",scopeConstraints:"Bounded scope",approveNow:false};
test("unchanged Initiative parent is omitted from the ordinary strategic save",async()=>{
 const {planning}=createPlanningState({userId:"user",initialData:{...emptyPlanningShellState,tasks:[epic,initiative]},adapter:{readWorkspace:async()=>null,saveTask:async(basis,patch)=>{expect(basis.updatedAt).toBe("original/source");expect(patch).not.toHaveProperty("parentTaskId");return{task:{...patch,updatedAt:"content/accepted"}};}}});
 expect(await planning.beginInitiativeEdit(initiativeDraft).save(initiativeDraft)).toMatchObject({ok:true});
});
test.each([false,true])("confirmed reparent survives later content failure (unknown=%s) and uses only its actual predecessor",async unknown=>{
 const requests:{basis:unknown;patch:unknown}[]=[];
 const {planning}=createPlanningState({userId:"user",initialData:{...emptyPlanningShellState,tasks:[epic,initiative]},adapter:{readWorkspace:async()=>null,saveTask:async(basis,patch)=>{requests.push({basis,patch});if(requests.length===1){expect(patch).toEqual({parentTaskId:"other-epic"});expect(basis.updatedAt).toBe("original/source");return{task:{id:initiative.id,parentTaskId:"other-epic",updatedAt:"actual/reparent"}};}expect(basis.updatedAt).toBe("actual/reparent");expect(patch).not.toHaveProperty("parentTaskId");throw Object.assign(new Error("Content failed"),unknown?{}:{status:400});}}});
 const editor=planning.beginInitiativeEdit(initiativeDraft);
 expect(await editor.save({...initiativeDraft,parentTaskId:"other-epic"})).toMatchObject({ok:false,kind:unknown?"unconfirmed":"rejected"});
 expect(planning.taskDetail(initiative.id).task).toMatchObject({parentTaskId:"other-epic",updatedAt:"actual/reparent",title:unknown?"Changed initiative":initiative.title});
 expect(editor.view()).toMatchObject({ parentConfirmed: true, error: "Content failed" });
 expect(requests).toHaveLength(2);
 if(unknown){await editor.checkOutcome();expect(await editor.save(initiativeDraft)).toMatchObject({ok:false});expect(requests).toHaveLength(2);}
});
test("unknown reparent retains entire submitted Initiative intent across navigation and never dispatches content",async()=>{
 let writes=0,reads=0;
 const {planning}=createPlanningState({userId:"user",initialData:{...emptyPlanningShellState,tasks:[epic,initiative]},adapter:{readWorkspace:async()=>{reads++;return null;},saveTask:async()=>{writes++;throw new Error("Connection lost");}}});
 const editor=planning.beginInitiativeEdit(initiativeDraft);
 expect(await editor.save({...initiativeDraft,parentTaskId:"other-epic"})).toMatchObject({ok:false,kind:"unconfirmed"});
 await planning.refreshWorkspace("planning");await planning.refreshWorkspace("projects");
 expect(planning.hierarchyEdits()).toEqual(expect.arrayContaining([expect.objectContaining({taskId:initiative.id,submitted:expect.objectContaining({parentTaskId:"other-epic",title:"Changed initiative",strategy:{goal:"Confirmed goal",successCriteria:"Observable outcome",scopeConstraints:"Bounded scope"}})})]));
 await editor.checkOutcome();expect(writes).toBe(1);
 expect(await editor.save(initiativeDraft)).toMatchObject({ok:false});expect(writes).toBe(1);expect(reads).toBeGreaterThan(0);
});

test("Initiative approval propagates only derived direct-child context without inventing child revisions",async()=>{
 const child=taskDetailStoryTask({id:"deliverable",taskType:"deliverable",parentTaskId:initiative.id,parentApprovalStatus:"proposed",updatedAt:"child/original"});
 const sub=taskDetailStoryTask({id:"sub",taskType:"sub_issue",parentTaskId:child.id,parentApprovalStatus:"draft",updatedAt:"sub/original"});
 const {planning}=createPlanningState({userId:"user",initialData:{...emptyPlanningShellState,tasks:[initiative,child,sub]},adapter:{saveTask:async()=>{throw new Error("Unexpected save");},readWorkspace:async()=>null,decideTaskApproval:async basis=>{expect(basis.approvalRevision).toBe(initiative.approvalRevision);return{task:{id:initiative.id,approvalStatus:"approved",approvalRevision:initiative.approvalRevision+1,updatedAt:"approval/actual"}};}}});
 expect(await planning.decideInitiativeApproval(initiative,"approve")).toMatchObject({ok:true});
 expect(planning.taskDetail(child.id).task).toMatchObject({parentApprovalStatus:"approved",updatedAt:"child/original"});
 expect(planning.taskDetail(sub.id).task).toMatchObject({parentApprovalStatus:"draft",updatedAt:"sub/original"});
});

test("a delayed direct-child creation cannot restore the old Initiative approval context",async()=>{
 let finish!:(receipt:import("@/features/planning/model/planning-task-lifecycle").PlanningTaskCreationConfirmation)=>void;
 const {planning}=createPlanningState({userId:"user",initialData:{...emptyPlanningShellState,tasks:[initiative]},adapter:{readWorkspace:async()=>null,saveTask:async()=>{throw new Error("Unexpected save");},createTask:()=>new Promise(resolve=>{finish=resolve;}),decideTaskApproval:async()=>({task:{id:initiative.id,approvalStatus:"approved",approvalRevision:initiative.approvalRevision+1,updatedAt:"root/approved"}})}});
 const pending=planning.createTask({creationRequestId:"late-creation",taskType:"deliverable",parentTaskId:initiative.id,title:"Child",description:"Goal",ownerId:""});
 await planning.decideInitiativeApproval(initiative,"approve");
 finish({task:taskDetailStoryTask({id:"late-child",taskType:"deliverable",parentTaskId:initiative.id,parentApprovalStatus:"proposed",updatedAt:"actual/child"})});await pending;
 expect(planning.taskDetail("late-child").task).toMatchObject({parentApprovalStatus:"approved",updatedAt:"actual/child"});
});

test("opening a summary Initiative loads required detail fields while keeping the original displayed version",async()=>{
 const shown={...initiative,detailAvailability:"summary" as const,strategy:undefined,raciAssignments:[]};
 const actual={...initiative,updatedAt:"detail/newer",strategy:{goal:"Read full goal",successCriteria:"Full criteria",scopeConstraints:"Full scope"},raciAssignments:[{profileId:"accountable",role:"accountable" as const,sortOrder:0},{profileId:"responsible",role:"responsible" as const,sortOrder:0}]};
 let reads=0,writes=0;const opened:{draft:Partial<InitiativeDraft>|null}={draft:null};
 const {planning}=createPlanningState({userId:"user",initialData:{...emptyPlanningShellState,tasks:[epic,shown]},adapter:{readWorkspace:async()=>null,saveTask:async()=>{writes++;return{task:{updatedAt:"unexpected"}};},readTaskDetail:async()=>{reads++;return{model:{revision:"detail",project:emptyPlanningShellState.project,item:actual,ancestors:[epic],children:[],relatedItems:[],people:[],sprints:[],discussion:{comments:[],externalComments:[]},blockers:[],relationships:[],activity:[],reviews:[]}};}}});
 const commands=useInitiativeCommands({planningState:planning,currentProfile:null,setSaveError:()=>{},setInitiativeDialogDefaults:value=>{opened.draft=typeof value==="function"?value(opened.draft):value;}});
 await commands.editInitiative(shown);
 expect(opened.draft).toMatchObject({expectedUpdatedAt:"original/source",goal:"Read full goal",accountableProfileId:"accountable",responsibleProfileIds:["responsible"]});
 if(!opened.draft)throw new Error("Expected Initiative form to open");
 const editor=planning.beginInitiativeEdit({...initiativeDraft,...opened.draft});
 expect(await editor.save({...initiativeDraft,...opened.draft})).toMatchObject({ok:false,kind:"versionConflict"});
 expect(writes).toBe(0);expect(reads).toBe(2);
});
test("failed required Initiative detail read leaves the form closed and session replacement clears submitted hierarchy intent",async()=>{
 let defaults:Partial<InitiativeDraft>|null=null;const errors:string[]=[];
 const {planning,internal}=createPlanningState({userId:"user",initialData:{...emptyPlanningShellState,tasks:[initiative]},adapter:{readWorkspace:async()=>null,readTaskDetail:async()=>{throw Object.assign(new Error("Denied"),{status:403});},saveTask:async()=>{throw new Error("Lost reply");}}});
 const commands=useInitiativeCommands({planningState:planning,currentProfile:null,setSaveError:value=>{if(typeof value==="string")errors.push(value);},setInitiativeDialogDefaults:value=>{defaults=typeof value==="function"?value(defaults):value;}});
 await commands.editInitiative({...initiative,detailAvailability:"summary"});
 expect(defaults).toBeNull();expect(errors.at(-1)).toContain("nicht vollständig");
 internal.sessionChanged("replacement");expect(planning.hierarchyEdits()).toEqual([]);
 expect(await planning.beginInitiativeEdit(initiativeDraft).save(initiativeDraft)).toMatchObject({ok:false});
});
