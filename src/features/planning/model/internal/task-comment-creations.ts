import type { PlanningShellState, Task, TaskComment } from "@/lib/types";
import type { PlanningReadStatus, PlanningTaskSaveCheck } from "../planning-state";
import type { TaskCommentCreationAdapter, TaskCommentCreationResult, TaskCommentCreationView } from "@/features/tasks/model/task-comment-creation";
const deliveryStates = ["not_applicable", "pending", "waiting_for_issue", "waiting_for_author_connection", "processing", "retry_scheduled", "delivered", "failed"];
export function createTaskCommentCreations(options: {
 initial: readonly TaskComment[]; adapter: TaskCommentCreationAdapter; active(): boolean; generation(): number; changed(): void; nextSequence(): number;
 canRead(taskId: string): boolean; removing(task: Task): boolean; detailStatus(taskId: string): PlanningReadStatus; endSession(): void; invalidateNotifications(): void;
 refresh(taskId: string, after: number): Promise<PlanningReadStatus>;
}) {
 const operations = new Map<string, { view: TaskCommentCreationView; after: number }>();
 const receipts = new Map(options.initial.map(comment => [comment.id, { taskId: comment.taskId, comment: comment as TaskComment | null, stamp: 0 }]));
 const scopes = new Map<string, { completeness: "complete" | "partial"; readStatus: PlanningReadStatus; stamp: number }>();
 const authorities = new Map<string, number>(), denied = new Set<string>(), reads = new Map<string, { after: number; promise: Promise<PlanningReadStatus> }>();
 let nextId = 0;
 const current = (id: string) => options.active() && !denied.has(id) && options.canRead(id);
 function readStatus(id: string): PlanningReadStatus { return current(id) ? scopes.get(id)?.readStatus || options.detailStatus(id) : "forbidden"; }
 function acceptRead(rows: readonly TaskComment[], started: number, complete: boolean, taskId?: string) {
  if (taskId) denied.delete(taskId);
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
 async function create(task: Task, submitted: string): Promise<TaskCommentCreationResult> {
  if (!current(task.id)) return { ok:false,kind:"ended",error:"Diese Diskussion ist in der Sitzung nicht verfügbar." };
  if (options.removing(task) || [...operations.values()].some(item=>item.view.taskId===task.id&&(item.view.phase==="unconfirmed" || item.view.phase==="saving"&&item.view.submitted===submitted))) return {ok:false,kind:"blocked",error:"Eine Kommentarbestätigung ist noch offen. Es wurde kein weiterer Kommentar gesendet."};
  if (submitted.trim().length<2) return {ok:false,kind:"rejected",error:"Kommentar ist erforderlich.",status:400};
  if (!options.adapter.createTaskComment) return {ok:false,kind:"rejected",error:"Kommentieren ist nicht verfügbar."};
  const generation=options.generation(), authority=authorities.get(task.id)||0, id=`comment:${++nextId}`;
  const operation={view:{id,taskId:task.id,submitted,phase:"saving",comment:null,notice:null,error:"",checkStatus:"not-checked"} as TaskCommentCreationView,after:0}; operations.set(id,operation); options.changed();
  const valid=()=>current(task.id)&&generation===options.generation()&&authority===(authorities.get(task.id)||0);
  try {
   const receipt=await options.adapter.createTaskComment(task.id,submitted); if(!valid())return{ok:false,kind:"ended",error:"Die Sitzung oder der Zugriff wurde beendet."}; const row=receipt.comment;
   if(!row||row.taskId!==task.id||!Number.isSafeInteger(row.id)||row.id<=0||![row.profileId,row.comment,row.createdAt,row.githubCommentUrl].every(value=>typeof value==="string")||!deliveryStates.includes(row.githubDeliveryStatus))throw new Error("Ob der Kommentar gespeichert wurde, ist noch unklar.");
   const stamp=options.nextSequence(); receipts.set(row.id,{taskId:task.id,comment:structuredClone(row),stamp});
   const notice=receipt.notice&&typeof receipt.notice.message==="string"&&typeof receipt.notice.code==="string"&&receipt.notice.level==="info"?structuredClone(receipt.notice):null;
   operation.view={...operation.view,phase:"confirmed",comment:structuredClone(row),notice}; const scope=scopes.get(task.id); if(!scope||scope.readStatus!=="loading")scopes.set(task.id,{completeness:scope?.completeness||"partial",readStatus:"current",stamp:scope?.stamp||0});
   options.invalidateNotifications();options.changed();return{ok:true,comment:row,notice};
  } catch(error) {
   if(!valid())return{ok:false,kind:"ended",error:"Die Sitzung oder der Zugriff wurde beendet."}; const failure=error as{status?:number;code?:string;message?:string};
   if(failure.code==="session_superseded"){options.endSession();return{ok:false,kind:"ended",error:"Die Sitzung wurde ersetzt."};}
   const phase=failure.status&&failure.status<500?"rejected":"unconfirmed";operation.view={...operation.view,phase,error:failure.message||"Der Kommentar ist noch nicht bestätigt."};
   if(phase==="unconfirmed"){operation.after=options.nextSequence();scopes.set(task.id,{completeness:"partial",readStatus:"stale",stamp:scopes.get(task.id)?.stamp||0});options.invalidateNotifications();}
   options.changed();return{ok:false,kind:phase,error:operation.view.error,status:failure.status};
  }
 }
 async function check(id:string):Promise<PlanningTaskSaveCheck>{
  if(!options.active())return{outcome:"session-ended",readStatus:"not-needed"};const operation=operations.get(id);if(!operation||!current(operation.view.taskId)||operation.view.phase!=="unconfirmed")return{outcome:"not-pending",readStatus:"not-needed"};
  const generation=options.generation(),authority=authorities.get(operation.view.taskId)||0;operation.view={...operation.view,checkStatus:"checking"};options.changed();
  let read=reads.get(operation.view.taskId);if(!read||read.after<operation.after){read={after:operation.after,promise:options.refresh(operation.view.taskId,operation.after)};reads.set(operation.view.taskId,read);const captured=read;void read.promise.finally(()=>{if(reads.get(operation.view.taskId)===captured)reads.delete(operation.view.taskId);}).catch(()=>undefined);}
  const status=await read.promise;if(!options.active()||generation!==options.generation())return{outcome:"session-ended",readStatus:"not-needed"};if(!current(operation.view.taskId)||authority!==(authorities.get(operation.view.taskId)||0))return{outcome:"unconfirmed",readStatus:"forbidden"};
  operation.view={...operation.view,checkStatus:status==="current"?"checked":"unavailable"};options.changed();return{outcome:"unconfirmed",readStatus:status};
 }
 return {create,check,acceptRead,readStatus,readVersion:(id:string)=>scopes.get(id)?.stamp||0,
  views:(taskId?:string)=>options.active()?[...operations.values()].filter(item=>(!taskId||item.view.taskId===taskId)&&current(item.view.taskId)).map(item=>structuredClone(item.view)):[],
  view(taskId:string,data:PlanningShellState){const pending=[...operations.values()].some(item=>item.view.taskId===taskId&&["saving","unconfirmed"].includes(item.view.phase));return{comments:current(taskId)?data.taskComments.filter(row=>row.taskId===taskId):[],completeness:pending?"partial" as const:scopes.get(taskId)?.completeness||"partial" as const,readStatus:readStatus(taskId)};},
  beginRead(id:string){scopes.set(id,{completeness:scopes.get(id)?.completeness||"partial",readStatus:"loading",stamp:scopes.get(id)?.stamp||0});},
  failed(id:string,status:"forbidden"|"unavailable"){scopes.set(id,{completeness:"partial",readStatus:status,stamp:scopes.get(id)?.stamp||0});if(status==="forbidden"){denied.add(id);authorities.set(id,(authorities.get(id)||0)+1);for(const[key,item]of operations)if(item.view.taskId===id)operations.delete(key);}},
  projectConfirmed(data:PlanningShellState):PlanningShellState{const known=new Set(data.taskComments.map(row=>row.id));return{...data,taskComments:[...data.taskComments.filter(row=>!denied.has(row.taskId)&&(!receipts.has(row.id)||receipts.get(row.id)!.comment)).map(row=>receipts.get(row.id)?.comment||row),...[...receipts.values()].filter(receipt=>receipt.comment&&!denied.has(receipt.taskId)&&!known.has(receipt.comment.id)).map(receipt=>receipt.comment!)]};},
  clear(){operations.clear();receipts.clear();scopes.clear();authorities.clear();denied.clear();reads.clear();},
 };
}
