import { useEffect, useState, useSyncExternalStore } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { TaskStructureView } from "@/features/tasks/organisms/task-structure-view";
import { createBrowserPlanningLifetime } from "@/features/planning/model/internal/browser-planning-lifetime";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { emptyPlanningHeaderData } from "@/lib/planning-header-data";
import { DEFAULT_PLANNING_FILTERS } from "@/features/planning/model/planning-board-query";
import { taskDetailStoryTask } from "@/features/tasks/molecules/task-detail-story-fixtures";
import type { BrowserApiClient, BrowserApiJsonResult } from "@/lib/browser-api-client";
import type { Task } from "@/lib/types";

let rejectChildRead=()=>{},completeObsoleteRead=()=>{},childReadAborted=()=>false;
function StructureSelectionFixture(){
 const [ready,setReady]=useState(false),[open,setOpen]=useState(false),[expanded,setExpanded]=useState<Record<string,boolean>>({});
 const [counts,setCounts]=useState({roots:0,children:0,complete:0});
 const [bundle]=useState(()=>{
  const deadline=Date.now()+300_000,userId="structure-view-user",profile={id:"structure-view-founder",name:"Synthetic founder",platformRole:"founder" as const,orgRole:"Founder",githubLogin:"",weeklyCapacity:40};
  const epic=taskDetailStoryTask({id:"old-structure-epic",title:"Old completed Epic",taskType:"epic",status:"Erledigt",updatedAt:"2000-01-01T00:00:00Z"});
  const parents=Array.from({length:21},(_,index)=>taskDetailStoryTask({id:`structure-root-${index+1}`,title:`Current Initiative ${String(index+1).padStart(2,"0")}`,taskType:"initiative",parentTaskId:epic.id,status:index===20?"Erledigt":"Offen",approvalStatus:index%2?"proposed":"approved",description:`Current root description ${index+1}`,strategy:{goal:`Current goal ${index+1}`,successCriteria:"Current criteria",scopeConstraints:"Current constraints"},order:index+1,updatedAt:"2026-11-01T12:00:00Z"}));
  const children=Array.from({length:21},(_,index)=>taskDetailStoryTask({id:`structure-delivery-${index+1}`,title:index===20?"Completed offpage Structure child":`Current Structure child ${String(index+1).padStart(2,"0")}`,taskType:"deliverable",parentTaskId:parents[0].id,status:index===20?"Erledigt":"Offen",approvalStatus:"approved",order:index+1,updatedAt:"2026-11-01T12:00:00Z"}));
  const omitted:(keyof Task)[]=["description","problemStatement","intendedOutcome","scopeConstraints","acceptanceCriteria","evidenceRequired","definitionOfDone","note","strategy","raciAssignments","evidenceLinks","linkedPullRequests","reviewEvidenceExceptionNote","githubIssueSyncError","decisionNote","carryoverReason"];
  const compact=(task:Task,root:boolean)=>{const value={...task,detailAvailability:"summary" as const};omitted.filter(field=>!root||field!=="description"&&field!=="strategy").forEach(field=>{delete value[field];});return value;};
  const receipt=(scope:string)=>({sourceRevision:"structure-view-source",scopeRevision:scope,observedAt:"2026-11-01T12:00:00Z",validUntil:new Date(deadline).toISOString()});
  let childAttempts=0;
  const client:BrowserApiClient={async requestJson<T>(input:Parameters<BrowserApiClient["requestJson"]>[0],options?:Parameters<BrowserApiClient["requestJson"]>[1]){
   const url=new URL(String(input),"http://localhost:3000"),raw=url.searchParams.get("scope"),query=raw?JSON.parse(raw):null;
   if(url.pathname!=="/api/planning-board-data"||query?.view!=="structure"){setCounts(value=>({...value,complete:value.complete+1}));throw new Error("No complete or unrelated workspace fallback");}
   const roots=query.area==="roots",key=roots?"roots":"children";setCounts(value=>({...value,[key]:value[key]+1}));
   if(!roots&&++childAttempts===1)return new Promise<BrowserApiJsonResult<T>>(resolve=>{rejectChildRead=()=>resolve({response:new Response(null,{status:503}),body:{error:"Synthetic child read failure"} as T});});
   const reply=(late=false)=>{const all=roots?parents:late?[{...children[0],title:"Obsolete Structure child",updatedAt:"2026-11-01T11:59:59Z"}]:children,offset=query.continuation?20:0,chosen=all.slice(offset,offset+query.limit),context=roots?[epic]:[parents[0],epic];return{response:new Response(null),body:{model:{revision:"structure-view-source",items:[...chosen,...context].map(task=>compact(task,roots)),people:[profile],taskOmittedFields:omitted.filter(field=>!roots||field!=="description"&&field!=="strategy"),structure:{...receipt(roots?"roots":"children"),query,itemIds:chosen.map(task=>task.id),contextIds:context.map(task=>task.id),total:all.length,coverage:offset+chosen.length===all.length?"complete":"partial",continuation:offset+chosen.length===all.length?null:roots?"roots-next":"children-next"}},readAuthority:{userId,deadline},readActor:{profileId:profile.id,platformRole:profile.platformRole}}};};
   if(!roots&&childAttempts===2){childReadAborted=()=>options?.signal?.aborted===true;return new Promise<BrowserApiJsonResult<T>>(resolve=>{completeObsoleteRead=()=>resolve(reply(true) as BrowserApiJsonResult<T>);});}
   return reply() as BrowserApiJsonResult<T>;
  },requestForm:async()=>{throw new Error("Unexpected form");},requestBlob:async()=>{throw new Error("Unexpected blob");}};
  const session={userId,revision:"structure-view-session",expiresAt:deadline/1000,user:{id:userId}},sessionReady=Promise.resolve(session);
  const lifetime=createBrowserPlanningLifetime({current:()=>sessionReady,subscribe:()=>()=>{}}),browser=lifetime.page({initialData:{...emptyPlanningShellState,profiles:[profile]},initialWorkspace:"planning",initialUserId:userId,initialHeaderData:emptyPlanningHeaderData,initialCurrentProfile:profile})!;
  browser.runtime.apiClient=client;return{browser,lifetime,sessionReady};
 });
 useEffect(()=>{const disconnect=bundle.lifetime.connect();void bundle.sessionReady.then(()=>setReady(true));return()=>{rejectChildRead();completeObsoleteRead();disconnect();bundle.browser.owner.internal.dispose();};},[bundle]);
 useSyncExternalStore(bundle.browser.owner.planning.subscribe,bundle.browser.owner.internal.getSnapshot,bundle.browser.owner.internal.getSnapshot);
 return <main><button disabled={!ready} onClick={()=>setOpen(true)}>Struktur öffnen</button>{Object.entries(counts).map(([key,count])=><output key={key} aria-label={`Strukturabfragen ${key}`}>{count}</output>)}{open?<TaskStructureView {...{planningState:bundle.browser.owner.planning,filters:DEFAULT_PLANNING_FILTERS,readMode:"selected" as const}} initiatives={[]} visibleTasks={[]} relations={[]} allTasks={[]} blockers={[]} expandedInitiatives={expanded} assigneeProfileForTask={()=>undefined} onOpenTask={()=>{}} onToggleInitiative={id=>setExpanded(value=>({...value,[id]:!value[id]}))} onSetAllInitiativeCollapse={collapsed=>setExpanded({"structure-root-1":!collapsed})}/>:null}</main>;
}
const meta={title:"Tasks/Organisms/SelectedStructure",component:StructureSelectionFixture,parameters:{nextjs:{appDirectory:true,navigation:{pathname:"/planning"}}}} satisfies Meta<typeof StructureSelectionFixture>;
export default meta;type Story=StoryObj<typeof meta>;
export const SelectedRootsAndOpenedChildrenLoadIndependentlyWithoutACompleteFallback:Story={
 play:async({canvasElement})=>{
  const canvas=within(canvasElement),open=canvas.getByRole("button",{name:"Struktur öffnen"});await waitFor(()=>expect(open).toBeEnabled());
  await expect(canvas.getByLabelText("Strukturabfragen roots")).toHaveTextContent("0");await expect(canvas.getByLabelText("Strukturabfragen children")).toHaveTextContent("0");await userEvent.click(open);
  await waitFor(()=>expect(canvas.getByLabelText("Strukturabfragen roots")).toHaveTextContent("1"));
  const parent=await canvas.findByRole("button",{name:/Current Initiative 01/});await expect(parent).toHaveAttribute("aria-expanded","false");await expect(canvas.getByText("Current goal 1")).toBeVisible();
  await expect(canvas.getByLabelText("Strukturabfragen children")).toHaveTextContent("0");await expect(canvas.queryByRole("link",{name:"Current Structure child 01"})).not.toBeInTheDocument();
  await userEvent.click(parent);await waitFor(()=>expect(canvas.getByLabelText("Strukturabfragen children")).toHaveTextContent("1"));
  await expect(canvas.getByText("Aufgaben werden geladen.")).toBeVisible();rejectChildRead();await expect(await canvas.findByText("Aufgaben konnten nicht geladen werden.")).toBeVisible();
  await userEvent.click(canvas.getByRole("button",{name:"Aufgaben erneut laden"}));await waitFor(()=>expect(canvas.getByLabelText("Strukturabfragen children")).toHaveTextContent("2"));
  await userEvent.click(parent);await expect(childReadAborted()).toBe(true);completeObsoleteRead();await userEvent.click(parent);
  await expect(await canvas.findByRole("link",{name:"Current Structure child 01"})).toHaveAttribute("href","/tasks/structure-delivery-1");
  await expect(canvas.queryByRole("link",{name:"Obsolete Structure child"})).not.toBeInTheDocument();await expect(canvas.getByLabelText("Strukturabfragen children")).toHaveTextContent("3");
  await userEvent.click(canvas.getByRole("button",{name:"Weitere Deliverables laden"}));await expect(await canvas.findByRole("link",{name:"Completed offpage Structure child"})).toHaveAttribute("href","/tasks/structure-delivery-21");
  await expect(canvas.getByLabelText("Strukturabfragen roots")).toHaveTextContent("1");
  await userEvent.click(canvas.getByRole("button",{name:"Weitere Initiativen laden"}));await expect(await canvas.findByRole("button",{name:/Current Initiative 21/})).toHaveAttribute("aria-expanded","false");
  await expect(parent).toHaveAttribute("aria-expanded","true");await expect(canvas.getByLabelText("Strukturabfragen children")).toHaveTextContent("4");await expect(canvas.getByLabelText("Strukturabfragen complete")).toHaveTextContent("0");
 },
};
