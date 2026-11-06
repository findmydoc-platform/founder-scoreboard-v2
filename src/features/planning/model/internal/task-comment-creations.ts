import type { PlanningShellState, Task, TaskComment } from "@/lib/types";
import type { PlanningReadStatus, PlanningTaskSaveCheck } from "../planning-state";
import type { TaskCommentCreationAdapter, TaskCommentCapture, TaskCommentCreationResult, TaskCommentCreationView } from "@/features/tasks/model/task-comment-creation";
import { taskCommentSubmissionStorage } from "./task-comment-submission-storage";
const deliveryStates = ["not_applicable", "pending", "waiting_for_issue", "waiting_for_author_connection", "processing", "retry_scheduled", "delivered", "failed"];
export function createTaskCommentCreations(options: {
 actor: string; initial: readonly TaskComment[]; adapter: TaskCommentCreationAdapter; active(): boolean; generation(): number; changed(): void; nextSequence(): number;
 canRead(taskId: string): boolean; removing(taskId: string): boolean; detailStatus(taskId: string): PlanningReadStatus; endSession(): void; invalidateNotifications(): void;
 refresh(taskId: string, after: number): Promise<PlanningReadStatus>;
}) {
 const recovery = taskCommentSubmissionStorage(options.adapter.commentSubmissionStorage, options.actor);
 type Operation = { view: TaskCommentCreationView; after: number; submittedAt: string; authorized: boolean; restored: boolean };
 const operations = new Map<string, Operation>();
 for (const row of recovery.load()) operations.set(row.id, {view:{...row,phase:"unconfirmed",comment:null,notice:null,error:"",checkStatus:"not-checked"},after:0,submittedAt:row.submittedAt,authorized:false,restored:true});
 let lastSubmittedTime = Math.max(0, ...options.initial.map(row => Date.parse(row.submittedAt || row.createdAt) || 0), ...[...operations.values()].map(row => Date.parse(row.submittedAt)));
 const checks = new Map<string, Promise<PlanningTaskSaveCheck>>();
 const receipts = new Map(options.initial.map(comment => [comment.id, { taskId: comment.taskId, comment: comment as TaskComment | null, stamp: 0 }]));
 const scopes = new Map<string, { completeness: "complete" | "partial"; readStatus: PlanningReadStatus; stamp: number }>();
 const authorities = new Map<string, number>(), denied = new Set<string>(), reads = new Map<string, { after: number; promise: Promise<PlanningReadStatus> }>();
 const current = (id: string) => options.active() && !denied.has(id) && options.canRead(id);
 function readStatus(id: string): PlanningReadStatus { return current(id) ? scopes.get(id)?.readStatus || options.detailStatus(id) : "forbidden"; }
 function acceptRead(rows: readonly TaskComment[], started: number, complete: boolean, taskId?: string) {
  if (taskId) denied.delete(taskId);
  for (const row of rows) lastSubmittedTime = Math.max(lastSubmittedTime, Date.parse(row.submittedAt || row.createdAt) || 0);
  const incoming = new Map(rows.map(row => [row.id,row]));
  for (const [id, receipt] of receipts) {
   if (receipt.stamp > started || taskId && receipt.taskId !== taskId) continue;
   const row = incoming.get(id); if (row) receipts.set(id,{ taskId: row.taskId, comment: row, stamp: started });
   else if (complete) receipts.set(id,{ ...receipt, comment: null, stamp: started });
  }
  for (const row of rows) if (!denied.has(row.taskId) && !receipts.has(row.id)) receipts.set(row.id,{ taskId: row.taskId, comment: row, stamp: started });
  const ids = taskId ? [taskId] : [...new Set([...scopes.keys(), ...rows.map(row => row.taskId), ...(complete ? [...receipts.values()].map(row=>row.taskId) : [])])];
  for (const id of ids) { const previous = scopes.get(id); if ((previous?.stamp || 0) > started) continue; const stale = [...receipts.values()].some(receipt=>receipt.taskId===id&&receipt.stamp>started); scopes.set(id,{ stamp: started, completeness: complete && !stale ? "complete" : "partial", readStatus: stale ? "stale" : "current" }); }
 }
 const attempts = new Map<string, Promise<TaskCommentCreationResult>>();
 function create(task: Task, submitted: string): TaskCommentCapture {
  const reject = (result: Extract<TaskCommentCreationResult, {ok:false}>): TaskCommentCapture => ({accepted:false,error:result.error,completion:Promise.resolve(result)});
  if (!current(task.id)) return reject({ ok:false,kind:"ended",error:"Diese Diskussion ist in der Sitzung nicht verfügbar." });
  if (options.removing(task.id)) return reject({ok:false,kind:"blocked",error:"Die Aufgabe wird entfernt. Es wurde kein Kommentar gesendet."});
  if (submitted.trim().length<2) return reject({ok:false,kind:"rejected",error:"Kommentar ist erforderlich.",status:400});
  if (!options.adapter.createTaskComment) return reject({ok:false,kind:"rejected",error:"Kommentieren ist nicht verfügbar."});
  const id=crypto.randomUUID();
  lastSubmittedTime = Math.max(Date.now(), lastSubmittedTime + 1);
  const submittedAt=new Date(lastSubmittedTime).toISOString();
  const operation={view:{id,taskId:task.id,submitted,submittedAt,phase:"saving",comment:null,notice:null,error:"",checkStatus:"not-checked"} as TaskCommentCreationView,after:0,submittedAt,authorized:true,restored:false};
  try { recovery.capture({id,taskId:task.id,submitted,submittedAt}); } catch {
   return reject({ok:false,kind:"rejected",error:"Der Kommentar konnte nicht für die Wiederherstellung gesichert werden. Es wurde nichts gesendet."});
  }
  operations.set(id,operation); options.changed();
  return {accepted:true, completion:send(operation)};
 }
 function send(operation: Operation): Promise<TaskCommentCreationResult> {
  const {id, taskId, submitted}=operation.view;
  const generation=options.generation(), authority=authorities.get(taskId)||0;
  const valid=()=>current(taskId)&&generation===options.generation()&&authority===(authorities.get(taskId)||0);
  const completion = (async (): Promise<TaskCommentCreationResult> => {
  try {
   const receipt=await options.adapter.createTaskComment!(taskId,submitted,{id,submittedAt:operation.submittedAt}); if(!valid())return{ok:false,kind:"ended",error:"Die Sitzung oder der Zugriff wurde beendet."}; const row=receipt.comment;
   if(!row||row.taskId!==taskId||!Number.isSafeInteger(row.id)||row.id<=0||![row.profileId,row.comment,row.createdAt,row.githubCommentUrl].every(value=>typeof value==="string")||!deliveryStates.includes(row.githubDeliveryStatus))throw new Error("Ob der Kommentar gespeichert wurde, ist noch unklar.");
   const stamp=options.nextSequence(); receipts.set(row.id,{taskId,comment:structuredClone(row),stamp});
   const notice=receipt.notice&&typeof receipt.notice.message==="string"&&typeof receipt.notice.code==="string"&&receipt.notice.level==="info"?structuredClone(receipt.notice):null;
   operation.view={...operation.view,phase:"confirmed",comment:structuredClone(row),notice}; recovery.remove(id); const scope=scopes.get(taskId); if(!scope||scope.readStatus!=="loading")scopes.set(taskId,{completeness:scope?.completeness||"partial",readStatus:"current",stamp:scope?.stamp||0});
   options.invalidateNotifications();options.changed();return{ok:true,comment:row,notice};
  } catch(error) {
   if(!valid())return{ok:false,kind:"ended",error:"Die Sitzung oder der Zugriff wurde beendet."}; const failure=error as{status?:number;code?:string;message?:string};
   if(failure.code==="session_superseded"){options.endSession();return{ok:false,kind:"ended",error:"Die Sitzung wurde ersetzt."};}
   const phase=failure.status&&failure.status<500?"rejected":"unconfirmed";operation.view={...operation.view,phase,error:failure.message||"Der Kommentar ist noch nicht bestätigt."};
   if(phase==="rejected")recovery.remove(id);
   if(phase==="unconfirmed"){operation.after=options.nextSequence();scopes.set(taskId,{completeness:"partial",readStatus:"stale",stamp:scopes.get(taskId)?.stamp||0});options.invalidateNotifications();}
   options.changed();return{ok:false,kind:phase,error:operation.view.error,status:failure.status};
  }
  })();
  attempts.set(id,completion);
  void completion.finally(()=>{if(attempts.get(id)===completion)attempts.delete(id);});
  return completion;
 }
 function retry(id: string): TaskCommentCapture {
  const operation=operations.get(id);
  if (operation && current(operation.view.taskId)) {
   const pending=attempts.get(id);
   if(pending)return{accepted:true,completion:pending};
   const taskId=operation.view.taskId;
   if(operation.view.phase==="rejected" && !options.removing(taskId) && options.adapter.createTaskComment) {
    try {recovery.capture({id,taskId,submitted:operation.view.submitted,submittedAt:operation.submittedAt});} catch {
     operation.view={...operation.view,error:"Der Kommentar konnte nicht für die Wiederherstellung gesichert werden. Es wurde nichts gesendet."};options.changed();
     return{accepted:false,error:operation.view.error,completion:Promise.resolve({ok:false,kind:"rejected",error:operation.view.error})};
    }
    operation.view={...operation.view,phase:"saving",error:"",checkStatus:"not-checked"};options.changed();
    return{accepted:true,completion:send(operation)};
   }
  }
  const error="Dieser Kommentar kann derzeit nicht erneut gesendet werden.";
  return{accepted:false,error,completion:Promise.resolve({ok:false,kind:"blocked",error})};
 }
 async function check(id:string):Promise<PlanningTaskSaveCheck>{
  if(!options.active())return{outcome:"session-ended",readStatus:"not-needed"};const operation=operations.get(id);if(!operation||!current(operation.view.taskId)||operation.view.phase!=="unconfirmed")return{outcome:"not-pending",readStatus:"not-needed"};
  const generation=options.generation(),authority=authorities.get(operation.view.taskId)||0;operation.view={...operation.view,checkStatus:"checking"};options.changed();
  if(options.adapter.checkTaskCommentCreation){
   const pending=checks.get(id);if(pending)return pending;
   const checking=(async():Promise<PlanningTaskSaveCheck>=>{
    try{
     const result=await options.adapter.checkTaskCommentCreation!(operation.view.taskId,{id,submittedAt:operation.submittedAt});
     if(!options.active()||generation!==options.generation())return{outcome:"session-ended",readStatus:"not-needed"};
     if(!current(operation.view.taskId)||authority!==(authorities.get(operation.view.taskId)||0))return{outcome:"unconfirmed",readStatus:"forbidden"};
     operation.authorized=true;
     if(result.outcome==="confirmed"){
      const row=result.comment;
      if(row.submissionId!==id||row.taskId!==operation.view.taskId||row.comment!==operation.view.submitted.trim()||row.submittedAt!==operation.submittedAt||!Number.isSafeInteger(row.id)||row.id<=0||!deliveryStates.includes(row.githubDeliveryStatus))throw new Error("Die Kommentarbestätigung ist unvollständig.");
      receipts.set(row.id,{taskId:row.taskId,comment:structuredClone(row),stamp:options.nextSequence()});
      operation.view={...operation.view,phase:"confirmed",comment:structuredClone(row),error:"",checkStatus:"checked"};recovery.remove(id);options.changed();
      return{outcome:"confirmed",readStatus:"current"};
     }
     operation.view={...operation.view,checkStatus:"checked"};options.changed();return{outcome:"unconfirmed",readStatus:"current"};
    }catch(error){
     if(!options.active()||generation!==options.generation())return{outcome:"session-ended",readStatus:"not-needed"};
     const failure=error as{status?:number;code?:string};
     if(failure.code==="session_superseded"||failure.status===401){options.endSession();return{outcome:"session-ended",readStatus:"not-needed"};}
     if(failure.status===403||failure.status===404){denied.add(operation.view.taskId);authorities.set(operation.view.taskId,authority+1);for(const[key,item]of operations)if(item.view.taskId===operation.view.taskId){operations.delete(key);recovery.remove(key);}options.changed();return{outcome:"unconfirmed",readStatus:"forbidden"};}
     operation.view={...operation.view,checkStatus:"unavailable"};options.changed();return{outcome:"unconfirmed",readStatus:"unavailable"};
    }
   })();checks.set(id,checking);try{return await checking;}finally{if(checks.get(id)===checking)checks.delete(id);}
  }
  let read=reads.get(operation.view.taskId);if(!read||read.after<operation.after){read={after:operation.after,promise:options.refresh(operation.view.taskId,operation.after)};reads.set(operation.view.taskId,read);const captured=read;void read.promise.finally(()=>{if(reads.get(operation.view.taskId)===captured)reads.delete(operation.view.taskId);}).catch(()=>undefined);}
  const status=await read.promise;if(!options.active()||generation!==options.generation())return{outcome:"session-ended",readStatus:"not-needed"};if(!current(operation.view.taskId)||authority!==(authorities.get(operation.view.taskId)||0))return{outcome:"unconfirmed",readStatus:"forbidden"};
  operation.view={...operation.view,checkStatus:status==="current"?"checked":"unavailable"};options.changed();return{outcome:"unconfirmed",readStatus:status};
 }
 function restore() {
  for(const operation of operations.values()) if(operation.restored && current(operation.view.taskId) && ["not-checked","unavailable"].includes(operation.view.checkStatus) && options.adapter.checkTaskCommentCreation) void check(operation.view.id);
 }
 return {create,retry,check,restore,acceptRead,readStatus,readVersion:(id:string)=>scopes.get(id)?.stamp||0,
  views:(taskId?:string)=>options.active()?[...operations.values()].filter(item=>(!taskId||item.view.taskId===taskId)&&item.authorized&&current(item.view.taskId)).map(item=>structuredClone(item.view)):[],
  view(taskId:string,data:PlanningShellState){const pending=[...operations.values()].some(item=>item.view.taskId===taskId&&["saving","unconfirmed"].includes(item.view.phase));return{comments:current(taskId)?data.taskComments.filter(row=>row.taskId===taskId):[],completeness:pending?"partial" as const:scopes.get(taskId)?.completeness||"partial" as const,readStatus:readStatus(taskId)};},
  beginRead(id:string){scopes.set(id,{completeness:scopes.get(id)?.completeness||"partial",readStatus:"loading",stamp:scopes.get(id)?.stamp||0});},
  failed(id:string,status:"forbidden"|"unavailable"){scopes.set(id,{completeness:"partial",readStatus:status,stamp:scopes.get(id)?.stamp||0});if(status==="forbidden"){denied.add(id);authorities.set(id,(authorities.get(id)||0)+1);for(const[key,item]of operations)if(item.view.taskId===id){operations.delete(key);recovery.remove(key);}}},
  projectConfirmed(data:PlanningShellState):PlanningShellState{const known=new Set(data.taskComments.map(row=>row.id));return{...data,taskComments:[...data.taskComments.filter(row=>!denied.has(row.taskId)&&(!receipts.has(row.id)||receipts.get(row.id)!.comment)).map(row=>receipts.get(row.id)?.comment||row),...[...receipts.values()].filter(receipt=>receipt.comment&&!denied.has(receipt.taskId)&&!known.has(receipt.comment.id)).map(receipt=>receipt.comment!)]};},
  clear(){recovery.clear();operations.clear();receipts.clear();scopes.clear();authorities.clear();denied.clear();reads.clear();checks.clear();attempts.clear();},
 };
}
