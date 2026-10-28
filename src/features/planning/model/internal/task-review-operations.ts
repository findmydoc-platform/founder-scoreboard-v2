import type { PlanningShellState, Task } from "@/lib/types";
import type { TaskReviewAdapter, TaskReviewOperation, TaskReviewReceipt, TaskReviewSubmission } from "@/features/reviews/model/planning-task-review";
import { applyPlanningItemApprovalPatch, applyOptimisticApprovalDecision, applyOptimisticDeliverableApprovalDecision } from "../approval-domain";
import type { TaskUpdateResult } from "@/features/tasks/hooks/task-mutation-command-types";
import type { PlanningReadStatus, PlanningTaskSaveCheck } from "../planning-state";
import { reviewDecisionTaskState } from "@/features/reviews/model/task-review-state";

type Dependencies = { adapter:TaskReviewAdapter; current():PlanningShellState; active():boolean; generation():number; changed():void; nextSequence():number; canRead(id:string):boolean; dependencyPending(task:Task):boolean; accept(receipt:TaskReviewReceipt,task:Task,started:number,command:TaskReviewSubmission):void; refresh(id:string,after:number):Promise<PlanningReadStatus>; invalidate():void };
export function createTaskReviewOperations(deps:Dependencies) {
 const operations=new Map<string,TaskReviewOperation>();
 const checks=new Map<string,Promise<PlanningTaskSaveCheck>>();
 const starts=new Map<string,number>();
 const authorityEpochs=new Map<string,number>();
 function affects(op:TaskReviewOperation,id:string) {
  if(op.phase!=="saving"&&op.phase!=="unconfirmed")return false;
  if(op.taskId===id)return true;
  if(op.kind!=="approval")return false;
  const seen=new Set<string>(); let task=deps.current().tasks.find(row=>row.id===id);
  while(task&&!seen.has(task.id)){if(task.parentTaskId===op.taskId)return true;seen.add(task.id);task=deps.current().tasks.find(row=>row.id===task!.parentTaskId);}
  return false;
 }
 const blockingOperation=(id:string,except?:string)=>[...operations.values()].find(op=>op.id!==except&&affects(op,id));
 const blocksTask=(id:string)=>Boolean(blockingOperation(id));
 const allowed=(id:string)=>deps.active()&&deps.canRead(id);
 function overlay(task:Task,command:TaskReviewSubmission):Partial<Task> {
  if(command.kind==="approval") { const next=task.taskType==="initiative"?applyOptimisticApprovalDecision(task,command.action,command.note):applyOptimisticDeliverableApprovalDecision(task,command.action,command.note); return {approvalStatus:next.approvalStatus,decisionNote:next.decisionNote,...(command.action==="return_to_draft"?{sprintId:next.sprintId,scoreRelevant:next.scoreRelevant}:{})}; }
  if(command.kind==="decision") return {...reviewDecisionTaskState(command.input.decision),reviewStatus:command.input.decision,scorePoints:command.input.points,reviewRequestedAt:""};
  if(command.kind==="withdraw") return {status:"In Arbeit",reviewStatus:"not_requested",scoreFinal:false,scorePoints:0,reviewRequestedAt:""};
  if(command.kind==="request") return {...command.input,status:"Review",reviewStatus:"requested",scoreFinal:false};
  return {status:"Review",reviewStatus:"requested",scoreFinal:false,scorePoints:0};
 }
 async function send(task:Task,command:TaskReviewSubmission):Promise<TaskUpdateResult> {
  if(!allowed(task.id))return {ok:false,kind:"sessionSuperseded",error:"Diese Aufgabe ist nicht verfügbar."};
  const operation:TaskReviewOperation={id:`review:${task.id}:${deps.nextSequence()}`,taskId:task.id,kind:command.kind,phase:"saving",submitted:structuredClone({task,command}),error:"",checking:false,readStatus:"not-loaded",serverTask:null};
  operations.set(operation.id,operation);
  const reject=(kind:"rejected"|"versionConflict"|"unconfirmed",error:string,status?:number):TaskUpdateResult=>{operation.phase=kind==="versionConflict"?"conflict":kind;operation.error=error;deps.changed();return {ok:false,kind,error,status};};
  if(blockingOperation(task.id,operation.id)||deps.dependencyPending(task)) {operation.phase="blocked";operation.error="Eine abhängige Änderung ist noch nicht bestätigt. Diese Entscheidung wurde nicht gesendet.";deps.changed();return {ok:false,kind:"unconfirmed",code:"predecessor_unconfirmed",error:operation.error};}
  const current=deps.current().tasks.find(row=>row.id===task.id);
  if(!current)return reject("rejected","Diese Aufgabe ist nicht verfügbar.",404);
  if(command.kind==="approval"?current.approvalRevision!==task.approvalRevision:!task.updatedAt||current.updatedAt!==task.updatedAt)return reject("versionConflict","Aufgabe wurde zwischenzeitlich geändert. Bitte den aktuellen Stand prüfen.",409);
  const generation=deps.generation(),authority=authorityEpochs.get(task.id)||0,started=deps.nextSequence(); starts.set(operation.id,started); deps.changed();
  try {
   const receipt=await (command.kind==="approval"?deps.adapter.decideTaskApproval?.(structuredClone(task),command.action,command.note):command.kind==="request"?deps.adapter.requestTaskReview?.(structuredClone(task),structuredClone(command.input)):command.kind==="decision"?deps.adapter.decideTaskReview?.(structuredClone(task),structuredClone(command.input)):command.kind==="withdraw"?deps.adapter.withdrawTaskReview?.(structuredClone(task),command.reason):deps.adapter.reopenTaskReview?.(structuredClone(task),structuredClone(command.input)));
   if(!allowed(task.id)||generation!==deps.generation()||authority!==(authorityEpochs.get(task.id)||0))return {ok:false,kind:"sessionSuperseded",error:"Die Sitzung oder Berechtigung wurde ersetzt."};
   if(!receipt?.task.updatedAt||receipt.task.id&&receipt.task.id!==task.id||command.kind==="approval"&&(!Number.isInteger(receipt.task.approvalRevision)||!receipt.task.approvalStatus)||command.kind==="decision"&&(!receipt.review||!Number.isInteger(receipt.review.id)||receipt.review.id<=0||receipt.review.taskId!==task.id||!receipt.review.createdAt))throw new Error("Die Entscheidung ist noch nicht vollständig bestätigt.");
   deps.accept(receipt,task,started,command);operation.phase="confirmed";
   for(const [id,previous] of operations)if(id!==operation.id&&previous.taskId===task.id&&previous.kind===command.kind&&["conflict","rejected","blocked","confirmed"].includes(previous.phase)){operations.delete(id);checks.delete(id);starts.delete(id);}
   deps.invalidate();deps.changed();return {ok:true,task:receipt.task};
  }catch(error){
   if(!allowed(task.id)||generation!==deps.generation()||authority!==(authorityEpochs.get(task.id)||0))return {ok:false,kind:"sessionSuperseded",error:"Die Sitzung oder Berechtigung wurde ersetzt."};
   const failure=error&&typeof error==="object"?error as {status?:number;kind?:string;code?:string}:{};
   const kind=failure.kind==="versionConflict"?"versionConflict":failure.status&&failure.status<500?"rejected":"unconfirmed";
   const result=reject(kind,error instanceof Error?error.message:"Entscheidung konnte nicht gespeichert werden.",failure.status);
   if(kind==="unconfirmed")deps.invalidate();
   if(kind==="versionConflict"&&command.kind!=="request")void check(operation.id);
   return result;
  }
 }
 async function check(id:string):Promise<PlanningTaskSaveCheck>{
  if(!deps.active())return {outcome:"session-ended",readStatus:"not-needed"};
  const op=operations.get(id);if(!op)return {outcome:"not-pending",readStatus:"not-needed"};
  if(!allowed(op.taskId))return {outcome:"session-ended",readStatus:"not-needed"};
  if(!["unconfirmed","conflict","blocked"].includes(op.phase))return {outcome:"not-pending",readStatus:"not-needed"};
  const current=deps.current().tasks.find(task=>task.id===op.taskId);
  if(op.phase==="blocked"&&current&&!blocksTask(op.taskId)&&!deps.dependencyPending(current))return {outcome:"not-pending",readStatus:"not-needed"};
  const existing=checks.get(id);if(existing)return existing;
  const generation=deps.generation();op.checking=true;deps.changed();
  const pending=(async():Promise<PlanningTaskSaveCheck>=>{const status=await deps.refresh(op.taskId,starts.get(id)||0);if(!deps.active()||generation!==deps.generation())return {outcome:"session-ended",readStatus:"not-needed"};op.checking=false;op.readStatus=status;op.serverTask=allowed(op.taskId)&&(status==="current"||status==="stale")?structuredClone(deps.current().tasks.find(task=>task.id===op.taskId)||null):null;deps.changed();return {outcome:"unconfirmed",readStatus:status};})();checks.set(id,pending);void pending.finally(()=>{if(checks.get(id)===pending)checks.delete(id);});return pending;
 }
 return {blocksTask,blockingOperation,check,deny(id:string){authorityEpochs.set(id,(authorityEpochs.get(id)||0)+1);for(const [key,op] of operations)if(op.taskId===id){operations.delete(key);checks.delete(key);starts.delete(key);}},clear(){operations.clear();checks.clear();starts.clear();authorityEpochs.clear();},views:(id?:string)=>[...operations.values()].filter(op=>(!id||op.taskId===id)&&allowed(op.taskId)).map(op=>structuredClone(op)),projectVisible(data:PlanningShellState){for(const op of operations.values())if((op.phase==="saving"||op.phase==="unconfirmed")&&op.submitted&&allowed(op.taskId)){const patch=overlay(op.submitted.task,op.submitted.command); data=op.kind==="approval"?applyPlanningItemApprovalPatch(data,{...patch,id:op.taskId,approvalStatus:patch.approvalStatus??null}):{...data,tasks:data.tasks.map(task=>task.id===op.taskId?{...task,...patch}:task)};}return data;},publicState:{decideTaskApproval:(task:Task,action:"approve"|"return_to_draft",note="")=>send(task,{kind:"approval",action,note}),requestTaskReview:(task:Task,input={})=>send(task,{kind:"request",input}),decideTaskReview:(task:Task,input:import("@/features/reviews/model/planning-task-review").TaskReviewDecisionInput)=>send(task,{kind:"decision",input}),withdrawTaskReview:(task:Task,reason:string)=>send(task,{kind:"withdraw",reason}),reopenTaskReview:(task:Task,input={})=>send(task,{kind:"reopen",input})}};
}
