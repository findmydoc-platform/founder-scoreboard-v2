import assert from "node:assert/strict";
import { test } from "vitest";
import { useReviewCommands } from "@/features/reviews/hooks/use-review-commands";
import { createPlanningState } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { taskDetailStoryTask } from "@/features/tasks/molecules/task-detail-story-fixtures";

const createReviewCommands=useReviewCommands;
const task=taskDetailStoryTask({id:"task",status:"Review",reviewStatus:"requested",updatedAt:"2026-10-28T10:00:00Z",githubIssueNumber:12,githubIssueUrl:"https://github.com/example/project/issues/12"});
const checklist={acceptanceCriteriaMet:true,evidenceProvided:true,communicationClear:true,blockerHandled:true};
function fixture(sync=()=>{}){
 const errors=[];
 const owner=createPlanningState({userId:"user",initialData:{...emptyPlanningShellState,tasks:[task]},adapter:{readWorkspace:async()=>null,saveTask:async()=>({task:{}}),decideTaskReview:async()=>({task:{id:task.id,status:"Erledigt",reviewStatus:"accepted",scoreFinal:true,updatedAt:"2026-10-28T10:01:00Z"},review:{id:1,taskId:task.id,decision:"accepted",points:10,checklist,createdAt:"2026-10-28T10:01:00Z"}})}});
 return {owner,errors,commands:createReviewCommands({planningState:owner.planning,githubInstallationAvailable:true,setSaveError:value=>errors.push(value),startTransition:callback=>{void callback();},syncTaskToGitHub:sync})};
}
test("a confirmed common Review completes without asking for another submit",async()=>{
 const current=fixture();assert.equal(await current.commands.reviewTask(task,"accepted",10,checklist,""),true);assert.equal(current.owner.planning.taskDetail(task.id).task.reviewStatus,"accepted");assert.deepEqual(current.errors,[""]);
});
test("a separate GitHub follow-up failure cannot undo or fail the confirmed Review",async()=>{
 const current=fixture(()=>{throw new Error("GitHub unavailable");});assert.equal(await current.commands.reviewTask(task,"accepted",10,checklist,""),true);assert.equal(current.owner.planning.taskDetail(task.id).task.reviewStatus,"accepted");assert.equal(current.owner.planning.taskDetail(task.id).reviews[0].id,1);assert.deepEqual(current.errors,["","GitHub unavailable"]);
});
