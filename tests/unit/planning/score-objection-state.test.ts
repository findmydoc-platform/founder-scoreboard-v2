import { expect, test } from "vitest";
import { createPlanningState } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { mapScoreObjection, mapFounderSprintScore } from "@/lib/planning-sprint-mappers";
import { taskDetailStoryTask } from "@/features/tasks/molecules/task-detail-story-fixtures";
const row={id:1,sprint_id:"sprint",profile_id:"founder",founder_sprint_score_id:2,status:"open" as const,comment:"Shown objection",resolution_comment:"",reviewed_by:null,reviewed_at:null,resolved_delivery_points:null,resolved_form_points:null,resolved_weekly_points:null,second_reviewer_profile_id:null,second_review_decision:null,second_reviewed_at:null,created_at:"2026-10-27T12:00:00Z"};
const objection=mapScoreObjection(row);
const score=mapFounderSprintScore({id:2,sprint_id:"sprint",profile_id:"founder",delivery_points:8,form_points:2,weekly_points:2,total_points:12,fulfilled:true,away_neutral:false,finalized_at:"2026-10-27T12:00:00Z",finalized_by:"ceo",reason_summary:"Shown score"});
const task=taskDetailStoryTask({id:"independent",updatedAt:"task/shown"});
const initial={...emptyPlanningShellState,tasks:[task],scoreObjections:[objection],founderSprintScores:[score]};
function deferred<T>(){let resolve!:(value:T)=>void;let reject!:(error:unknown)=>void;const promise=new Promise<T>((yes,no)=>{resolve=yes;reject=no;});return {promise,resolve,reject};}
test("an actual objection and score receipt updates only its identities and survives older reads and whole-shell rollback",async()=>{
 const result=deferred<{objection:typeof objection;score:typeof score}>();const old=deferred<{data:typeof initial}>();
 const owner=createPlanningState({userId:"user",initialWorkspace:"sprint",initialData:initial,adapter:{saveTask:async(_,patch)=>({task:{...patch,updatedAt:"task/saved"}}),readWorkspace:()=>old.promise,processScoreObjection:()=>result.promise}});
 const read=owner.planning.refreshWorkspace("sprint");const editor=owner.planning.beginScoreObjectionReview(objection,score);const save=editor.submit({action:"resolve",status:"accepted",resolutionComment:"Verified",deliveryPoints:10,formPoints:3,weeklyPoints:4});
 await owner.planning.saveTask(task,{title:"Independent saved task"});
 const savedObjection=mapScoreObjection({...row,status:"accepted",resolution_comment:"Verified",reviewed_by:"ceo",reviewed_at:"2026-10-28T12:00:00Z",resolved_delivery_points:10,resolved_form_points:3,resolved_weekly_points:4});
 const savedScore={...score,deliveryPoints:10,formPoints:3,weeklyPoints:4,totalPoints:17,finalizedAt:"2026-10-28T12:00:00Z"};result.resolve({objection:savedObjection,score:savedScore});await expect(save).resolves.toMatchObject({ok:true});old.resolve({data:initial});await read;owner.internal.applyLegacyProjection(initial);
 expect(owner.planning.sprintWorkspace().model.objections).toEqual([savedObjection]);expect(owner.planning.sprintWorkspace().model.scores).toEqual([savedScore]);expect(owner.planning.workspace("sprint").tasks[0]).toMatchObject({title:"Independent saved task",updatedAt:"task/saved"});
});

test("a lost objection decision keeps submitted fields across navigation and checks without replay while independent edits survive",async()=>{
 let writes=0,reads=0;const owner=createPlanningState({userId:"user",initialWorkspace:"sprint",initialData:initial,adapter:{saveTask:async(_,patch)=>({task:{...patch,updatedAt:"task/saved"}}),readWorkspace:async()=>{reads++;return {data:initial,coverage:{scoreObjections:"complete",founderSprintScores:"complete"}};},processScoreObjection:async()=>{writes++;throw new Error("Lost response");}}});
 const editor=owner.planning.beginScoreObjectionReview(objection,score);await expect(editor.submit({action:"resolve",status:"dismissed",resolutionComment:"Kept decision"})).resolves.toMatchObject({ok:false,kind:"unconfirmed"});editor.close();
 expect(owner.planning.scoreObjectionOperations("sprint")[0]).toMatchObject({phase:"unconfirmed",submitted:{resolutionComment:"Kept decision"}});
 await owner.planning.saveTask(task,{title:"Independent"});await expect(editor.checkOutcome()).resolves.toMatchObject({outcome:"unconfirmed"});expect({writes,reads}).toEqual({writes:1,reads:1});expect(owner.planning.workspace("sprint").tasks[0].title).toBe("Independent");
});

test("the decision editor retains the original nullable objection and actual score basis until explicit comparison and resubmission",async()=>{
 const foreign=mapScoreObjection({...row,second_reviewer_profile_id:"reviewer"});const calls:unknown[]=[];
 const {planning}=createPlanningState({userId:"user",initialData:initial,adapter:{saveTask:async()=>({task:{}}),readWorkspace:async()=>({data:{...initial,scoreObjections:[foreign]},coverage:{scoreObjections:"complete",founderSprintScores:"complete"}}),processScoreObjection:async(basis,shownScore,input)=>{calls.push({basis,shownScore,input});return {objection:{...basis,secondReviewerProfileId:"other"},score:null};}}});
 const editor=planning.beginScoreObjectionReview(objection,score);await planning.refreshWorkspace("sprint");await expect(editor.submit({action:"assign_second_review",secondReviewerProfileId:"other"})).resolves.toMatchObject({ok:false,kind:"versionConflict"});expect(calls).toEqual([]);
 await expect(editor.refreshConflict()).resolves.toBe(true);expect(editor.view().serverObjection).toEqual(foreign);await expect(editor.resubmit({action:"assign_second_review",secondReviewerProfileId:"other"})).resolves.toMatchObject({ok:true});expect(calls).toHaveLength(1);expect(calls[0]).toMatchObject({basis:{secondReviewerProfileId:"reviewer"},shownScore:score});
});


test("released decision contexts reject late session results and pause only their dependent score pair",async()=>{
 const delayed=deferred<{objection:typeof objection}>();let writes=0;
 const other=mapScoreObjection({...row,id:3,profile_id:"other"});
 const owner=createPlanningState({userId:"user",initialWorkspace:"sprint",initialData:{...initial,scoreObjections:[objection,other]},adapter:{readWorkspace:async()=>({data:initial}),saveTask:async()=>({task:{}}),processScoreObjection:async()=>{writes++;if(writes===1)return delayed.promise;return {objection:other};}}});
 const first=owner.planning.beginScoreObjectionReview(objection,score);const saving=first.submit({action:"resolve",status:"dismissed",resolutionComment:"Retained"});first.close();
 const dependent=owner.planning.beginScoreObjectionReview(objection,score);await expect(dependent.submit({action:"resolve",status:"dismissed",resolutionComment:"Queued elsewhere"})).resolves.toMatchObject({ok:false,kind:"unconfirmed"});expect(writes).toBe(1);
 await expect(owner.planning.beginScoreObjectionReview(other,null).submit({action:"resolve",status:"dismissed",resolutionComment:"Independent"})).resolves.toMatchObject({ok:true});
 owner.internal.endSession();delayed.resolve({objection:{...objection,status:"dismissed"}});await expect(saving).resolves.toMatchObject({ok:false,kind:"sessionSuperseded"});expect(first.view()).toMatchObject({phase:"ended",submitted:null});expect(owner.planning.scoreObjectionOperations("sprint")).toEqual([]);
});


test("an unknown new objection retains the exact comment after release and never creates again during checks",async()=>{
 let writes=0,reads=0;const owner=createPlanningState({userId:"user",initialWorkspace:"sprint",initialData:initial,adapter:{saveTask:async()=>({task:{}}),createScoreObjection:async()=>{writes++;throw new Error("Response lost");},readWorkspace:async()=>{reads++;return {data:initial,coverage:{scoreObjections:"complete",founderSprintScores:"complete"}};}}});
 const editor=owner.planning.beginScoreObjectionCreation("sprint","founder");await expect(editor.submit("Exact retained comment")).resolves.toMatchObject({ok:false,kind:"unconfirmed"});editor.close();
 const retained=owner.planning.scoreObjectionOperations("sprint").find(view=>view.objectionId===null)!;expect(retained).toMatchObject({phase:"unconfirmed",submitted:{comment:"Exact retained comment"}});
 const resumed=owner.planning.resumeScoreObjectionCreation(retained.id)!;await Promise.all([resumed.checkOutcome(),resumed.checkOutcome()]);await expect(resumed.submit("Exact retained comment")).resolves.toMatchObject({ok:false,kind:"unconfirmed"});expect({writes,reads}).toEqual({writes:1,reads:1});expect(owner.planning.sprintWorkspace().model.objections).toEqual([objection]);
});


test("repeated public submissions and read-only checks never turn an unknown decision into a retry",async()=>{
 let writes=0;const owner=createPlanningState({userId:"user",initialData:initial,adapter:{saveTask:async()=>({task:{}}),processScoreObjection:async()=>{writes++;throw new Error("Unknown");},readWorkspace:async()=>({data:initial,coverage:{scoreObjections:"complete",founderSprintScores:"complete"}})}});
 const editor=owner.planning.beginScoreObjectionReview(objection,score);const input={action:"resolve" as const,status:"dismissed" as const,resolutionComment:"Kept"};await editor.submit(input);await editor.submit(input);await editor.submit(input);await editor.checkOutcome();await editor.submit(input);expect(writes).toBe(1);expect(editor.view()).toMatchObject({phase:"unconfirmed",submitted:input});
});


test("a partial read which omits the objection or accepted-score basis cannot authorize a conscious resubmission",async()=>{
 const owner=createPlanningState({userId:"user",initialData:initial,adapter:{saveTask:async()=>({task:{}}),processScoreObjection:async()=>{throw Object.assign(new Error("Changed"),{status:409,code:"score_objection_basis_conflict"});},readWorkspace:async()=>({data:{...emptyPlanningShellState,scoreObjections:[],founderSprintScores:[]},coverage:{scoreObjections:"partial",founderSprintScores:"partial"}})}});
 const editor=owner.planning.beginScoreObjectionReview(objection,score);await editor.submit({action:"resolve",status:"accepted",resolutionComment:"Kept",deliveryPoints:10});await expect(editor.refreshConflict()).resolves.toBe(false);expect(editor.view()).toMatchObject({canResave:false,serverObjection:null});
});


test("an accepted objection without an actual score receipt invalidates that score without inventing a total or touching independent work",async()=>{
 const owner=createPlanningState({userId:"user",initialData:initial,adapter:{saveTask:async()=>({task:{}}),processScoreObjection:async()=>({objection:mapScoreObjection({...row,status:"accepted"})}),readWorkspace:async()=>({data:initial,coverage:{scoreObjections:"complete",founderSprintScores:"complete"}})}});
 await owner.planning.refreshWorkspace("sprint");expect(owner.planning.sprintWorkspace().model.coverage.scores).toBe("complete");
 await owner.planning.beginScoreObjectionReview(objection,score).submit({action:"resolve",status:"accepted",resolutionComment:"Verified",deliveryPoints:12,formPoints:4,weeklyPoints:4});
 expect(owner.planning.sprintWorkspace().model.objections[0].status).toBe("accepted");expect(owner.planning.sprintWorkspace().model.scores).toEqual([]);expect(owner.planning.scoreObjectionScore("sprint","founder").score).toEqual(score);expect(owner.planning.sprintWorkspace().model.coverage.scores).toBe("partial");expect(owner.planning.scoreObjectionScore("sprint","founder").complete).toBe(false);
});


test("only confirmations in the same decision context advance a queued decision basis",async()=>{
 const pending=deferred<{objection:typeof objection}>(),calls:typeof objection[]=[];const firstReceipt=mapScoreObjection({...row,second_reviewer_profile_id:"reviewer"});
 const owner=createPlanningState({userId:"user",initialData:initial,adapter:{saveTask:async()=>({task:{}}),readWorkspace:async()=>({data:initial}),processScoreObjection:async basis=>{calls.push(basis);if(calls.length===1)return pending.promise;return {objection:mapScoreObjection({...row,second_reviewer_profile_id:"other"})};}}});
 const editor=owner.planning.beginScoreObjectionReview(objection,score);const first=editor.submit({action:"assign_second_review",secondReviewerProfileId:"reviewer"});const second=editor.submit({action:"assign_second_review",secondReviewerProfileId:"other"});editor.close();pending.resolve({objection:firstReceipt});await Promise.all([first,second]);expect(calls).toEqual([objection,firstReceipt]);
});

test.each([409,403])("a known domain rejection %s affects neither independent confirmations nor the original draft and is not a version conflict",async status=>{
 const owner=createPlanningState({userId:"user",initialWorkspace:"sprint",initialData:initial,adapter:{saveTask:async(_,patch)=>({task:{...patch,updatedAt:"independent/saved"}}),readWorkspace:async()=>({data:initial}),processScoreObjection:async()=>{throw Object.assign(new Error("Policy rejected"),{status});}}});
 const editor=owner.planning.beginScoreObjectionReview(objection,score);await owner.planning.saveTask(task,{title:"Independent"});await expect(editor.submit({action:"resolve",status:"dismissed",resolutionComment:"Kept"})).resolves.toMatchObject({ok:false,kind:"rejected"});expect(editor.view()).toMatchObject({phase:"rejected",submitted:{resolutionComment:"Kept"}});expect(owner.planning.sprintWorkspace().model.objections).toEqual([objection]);expect(owner.planning.workspace("sprint").tasks[0].title).toBe("Independent");
});


test("a denied Sprint read hides retained comparison records and rejects later decision dispatch without clearing independent task state",async()=>{
 let denied=false,writes=0;const owner=createPlanningState({userId:"user",initialWorkspace:"sprint",initialData:initial,adapter:{saveTask:async(_,patch)=>({task:{...patch,updatedAt:"independent/saved"}}),readWorkspace:async()=>{if(denied)throw Object.assign(new Error("Forbidden"),{status:403});return {data:initial,coverage:{scoreObjections:"complete",founderSprintScores:"complete"}};},processScoreObjection:async()=>{writes++;throw Object.assign(new Error("Changed"),{status:409,code:"score_objection_basis_conflict"});}}});
 const editor=owner.planning.beginScoreObjectionReview(objection,score);await editor.submit({action:"resolve",status:"dismissed",resolutionComment:"Original"});await editor.refreshConflict();expect(editor.view().serverObjection).toEqual(objection);
 await owner.planning.saveTask(task,{title:"Independent"});denied=true;await owner.planning.refreshWorkspace("sprint");expect(editor.view()).toMatchObject({serverObjection:null,serverScore:null,canResave:false});await editor.resubmit({action:"resolve",status:"dismissed",resolutionComment:"Original"});expect(writes).toBe(1);expect(owner.planning.taskDetail(task.id).task?.title).toBe("Independent");
});


test("a delayed creation receipt cannot replace a later returned objection, and independent task confirmation survives",async()=>{
 const created=mapScoreObjection({...row,id:9,comment:"Created"}),foreign=mapScoreObjection({...row,id:9,comment:"Later server evidence"});const receipt=deferred<{objection:typeof objection}>();
 const owner=createPlanningState({userId:"user",initialWorkspace:"sprint",initialData:initial,adapter:{saveTask:async(_,patch)=>({task:{...patch,updatedAt:"task/independent"}}),createScoreObjection:()=>receipt.promise,readWorkspace:async()=>({data:{...initial,scoreObjections:[objection,foreign]},coverage:{scoreObjections:"complete"}})}});
 const saving=owner.planning.beginScoreObjectionCreation("sprint","founder").submit("Created");await owner.planning.refreshWorkspace("sprint");await owner.planning.saveTask(task,{title:"Independent"});receipt.resolve({objection:created});await expect(saving).resolves.toMatchObject({ok:true});expect(owner.planning.sprintWorkspace().model.objections.find(item=>item.id===9)).toEqual(foreign);expect(owner.planning.workspace("sprint").tasks[0].title).toBe("Independent");owner.internal.applyLegacyProjection(initial);expect(owner.planning.sprintWorkspace().model.objections.find(item=>item.id===9)).toEqual(foreign);
});


test("an actual Sprint lock with only score counts invalidates pre-lock scores until actual bounded score rows return",async()=>{
 const sprint={id:"sprint",name:"Sprint",status:"review" as const,startDate:"2000-01-01",endDate:"2000-01-14",reviewDueAt:"2000-01-16T23:59:00Z",scoreLocked:false,updatedAt:"sprint/shown"};let unavailable=true;
 const owner=createPlanningState({userId:"user",initialWorkspace:"sprint",initialData:{...initial,sprints:[sprint]},adapter:{saveTask:async()=>({task:{}}),readWorkspace:async()=>{if(unavailable)throw Object.assign(new Error("Unavailable"),{status:503});return {data:{...initial,sprints:[{...sprint,status:"closed",scoreLocked:true}]},coverage:{sprints:"complete",founderSprintScores:"complete"}};},lockSprint:async()=>({sprint:{id:"sprint",status:"closed",scoreLocked:true},scoring:{scores:1}})}});
 await owner.planning.beginSprintLock(sprint,[]).lock({firstSprintNumber:1,anchorStartDate:"2099-01-01",rhythmWeeks:2,horizonWeeks:1,targetSprintNumber:2});expect(owner.planning.sprintWorkspace().model.scores).toEqual([]);expect(owner.planning.scoreObjectionScore("sprint","founder").complete).toBe(false);unavailable=false;await owner.planning.refreshWorkspace("sprint");expect(owner.planning.scoreObjectionScore("sprint","founder")).toEqual({score,complete:true});
});
