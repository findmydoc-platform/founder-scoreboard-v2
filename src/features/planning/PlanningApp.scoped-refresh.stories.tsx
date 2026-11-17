import { act, useEffect, useState, useSyncExternalStore } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fireEvent, userEvent, waitFor, within } from "storybook/test";
import { vi } from "vitest";
import { PlanningApp } from "./PlanningApp";
import { PlanningStateProvider } from "./organisms/planning-state-provider";
import { usePlanningBusinessState } from "./hooks/use-planning-business-state";
import { emptyPlanningShellState } from "./model/planning-shell-state";
import { normalizePlanningBoardQuery, planningBoardQueryKey, type PlanningBoardColumn } from "./model/planning-board-query";
import { planningWorkspaceHydration } from "./model/planning-workspace-hydration";
import { productUpdates } from "@/features/product-updates/model/product-update-registry";
import { taskDetailStoryTask } from "@/features/tasks/molecules/task-detail-story-fixtures";
import { itemPageProfile, itemPageUser, itemPageHeaderData, mockItemPageBrowser } from "../../../tests/helpers/task-detail-page-browser-fixture";
import { taskStatuses } from "@/lib/status";
import type { Task, TaskStatus } from "@/lib/types";
import type { PlanningStructureQuery } from "./model/planning-structure-query";

type Scenario = "backlog" | "structure-only" | "structure-expired";
const roots: PlanningStructureQuery = { view: "structure", area: "roots", limit: 20 };
const parent = taskDetailStoryTask({ id: "observed-parent", title: "Observed parent", taskType: "initiative", updatedAt: "2026-11-01T12:00:00Z" });
const item = taskDetailStoryTask({ id: "observed-deliverable", title: "Observed Deliverable", parentTaskId: parent.id, approvalStatus: "approved", ownerId: itemPageProfile.id, assigneeId: itemPageProfile.id, assignee: itemPageProfile.name, updatedAt: parent.updatedAt });
const omitted: (keyof Task)[] = ["description","note","strategy","problemStatement","intendedOutcome","scopeConstraints","acceptanceCriteria","evidenceRequired","definitionOfDone","raciAssignments","evidenceLinks","linkedPullRequests","reviewEvidenceExceptionNote","githubIssueSyncError","decisionNote","carryoverReason"];
const compact = (task: Task, root = false) => { const row={...task,detailAvailability:"summary" as const};for(const field of omitted)if(!root||field!=="description"&&field!=="strategy")Reflect.deleteProperty(row,field);return row; };

let clock: { now: number; advance(milliseconds: number): void };
let scenario = { version: "1", failSource: false, memberDeadline: "" };
function ReceiptProbe({ mode }: { mode: Scenario }) {
  const state = usePlanningBusinessState();
  const snapshot = () => {
    if (!state) return "not-loaded:none";
    const selected = mode === "backlog" ? state.backlog() : state.structure(roots);
    const until = mode === "backlog" ? state.backlog().model.selection?.validUntil : state.structure(roots).selection?.validUntil;
    return `${selected.readStatus}:${until && until === scenario.memberDeadline ? "original" : "none"}`;
  };
  const value = useSyncExternalStore(state?.subscribe || (() => () => {}), snapshot, snapshot);
  return <output aria-label="Current receipt evidence">{value}</output>;
}
function ScopedRefreshFlow({ mode = "backlog" }: { mode?: Scenario }) {
  const [ready,setReady]=useState(false),[counts,setCounts]=useState({source:0,membership:0,controls:0,sprints:0,hidden:0});
  const [initial]=useState(()=>{
    const session={userId:itemPageUser.id,user:itemPageUser,revision:"item-page-session",expiresAt:Math.floor(Date.now()/1000)+3600};
    const query=normalizePlanningBoardQuery({view:"board"}),columns=Object.fromEntries([...taskStatuses,"Pausiert"].map(status=>[status,{total:status==="Offen"?1:0,loaded:status==="Offen"?1:0,availability:"ready" as const,completeness:"complete" as const,continuation:null}])) as Record<TaskStatus,PlanningBoardColumn>;
    const model={revision:"observed-row",scopeRevision:"1",query,queryRevision:"observed-row",project:emptyPlanningShellState.project,items:[parent,item],people:[itemPageProfile],sprints:[],relationships:[],blockers:[],preferences:[],coverage:{items:"partial",people:"complete",sprints:"complete",preferences:"complete",strategies:"partial",raci:"partial",links:"partial",relationships:"complete",blockers:"complete"} as const,
      board:{query,queryKey:planningBoardQueryKey(query),revision:"observed-row",observedAt:new Date(Date.now()).toISOString(),cardIds:[item.id],columns,metrics:{total:1,open:1,done:0,blocked:0},levelTotals:{epic:0,initiative:1,deliverable:1},childProgressById:{},viewerOpenSubIssueIdsByDeliverableId:{},workspaceRevision:{activeTaskCount:2,latestUpdatedAt:"observed-row"}}};
    return {session,model,read:planningWorkspaceHydration("planning",model,session,{userId:itemPageUser.id,deadline:Date.now()+600_000})};
  });
  useEffect(()=>{
    let active=true,restore:(()=>void)|undefined;
    const key=`founderops.product-updates.seen.${itemPageProfile.id}`,previous=localStorage.getItem(key);
    localStorage.setItem(key,JSON.stringify(productUpdates.map(update=>update.id)));
    void mockItemPageBrowser({respond:input=>{
      const url=new URL(String(input),"http://localhost:3000");
      if(url.pathname==="/api/planning-source-version"){
        setCounts(value=>({...value,source:value.source+1}));
        return scenario.failSource?Response.json({error:"Source unavailable"},{status:503}):Response.json({version:scenario.version});
      }
      if(url.pathname!=="/api/backlog-data"&&url.pathname!=="/api/planning-board-data")return undefined;
      const raw=url.searchParams.get("scope"),query=raw?JSON.parse(raw):null;
      const selectedBacklog=url.pathname==="/api/backlog-data"&&query?.view==="backlog";
      const support=url.pathname==="/api/backlog-data"&&query?.view==="backlog-support";
      const structure=url.pathname==="/api/planning-board-data"&&query?.view==="structure";
      if(!selectedBacklog&&!support&&!structure){setCounts(value=>({...value,hidden:value.hidden+1}));return Response.json({error:"Unselected workspace"},{status:503});}
      const deadline=Date.now()+(mode==="structure-expired"?30_000:180_000),receipt={sourceRevision:scenario.version,scopeRevision:query.area||"members",observedAt:new Date(Date.now()).toISOString(),validUntil:new Date(deadline).toISOString()};
      const frame={readAuthority:{userId:itemPageUser.id,deadline},readActor:{profileId:itemPageProfile.id,platformRole:itemPageProfile.platformRole}};
      const coverage={items:"partial",people:"partial",sprints:"partial",commitments:"partial",strategies:"partial",raci:"partial",links:"partial"} as const;
      const base={revision:scenario.version,items:[],people:[],sprints:[],commitments:[],coverage};
      if(selectedBacklog){
        setCounts(value=>({...value,membership:value.membership+1}));scenario.memberDeadline=receipt.validUntil;
        return Response.json({...frame,model:{...base,items:[compact(parent),compact(item)],people:[itemPageProfile],taskOmittedFields:omitted,selection:{...receipt,query,itemIds:[item.id],contextIds:[parent.id],rankById:{[item.id]:1},total:1,coverage:"complete",continuation:null}}});
      }
      if(support&&query.area==="sprints"){
        setCounts(value=>({...value,sprints:value.sprints+1}));return Response.json({...frame,model:{...base,sprintBasis:{...receipt,day:query.day,coverage:"complete",buckets:[]}}});
      }
      if(support){
        setCounts(value=>({...value,controls:value.controls+1}));return Response.json({...frame,model:{...base,controls:{...receipt,coverage:"complete",levelTotals:{epic:0,initiative:1,deliverable:1},statuses:{epic:[],initiative:["Offen"],deliverable:["Offen"]},assignees:[{value:itemPageProfile.id,label:itemPageProfile.name}],epics:[],initiatives:[{value:parent.id,label:parent.title}],scopeCounts:{all:1,proposals:0,ready:1,unscheduled:1},orphanProgress:{orphanInitiatives:{total:0,completed:0,unfinished:0},orphanDeliverables:{total:0,completed:0,unfinished:0}}}}});
      }
      if(query.area==="controls"){
        setCounts(value=>({...value,controls:value.controls+1}));return Response.json({...frame,model:{revision:scenario.version,controls:{...receipt,coverage:"complete",people:[{id:itemPageProfile.id,name:itemPageProfile.name}],sprints:[],initiatives:[{id:parent.id,title:parent.title}],workstreams:[]}}});
      }
      setCounts(value=>({...value,membership:value.membership+1}));scenario.memberDeadline=receipt.validUntil;
      return Response.json({...frame,model:{revision:scenario.version,items:[compact(parent,true)],people:[itemPageProfile],taskOmittedFields:omitted.filter(field=>field!=="description"&&field!=="strategy"),structure:{...receipt,query,itemIds:[parent.id],contextIds:[],total:1,coverage:"complete",continuation:null}}});
    }}).then(cleanup=>{if(!active)cleanup();else{restore=cleanup;setReady(true);}});
    return()=>{active=false;restore?.();if(previous===null)localStorage.removeItem(key);else localStorage.setItem(key,previous);};
  },[mode]);
  return <>{Object.entries(counts).map(([key,count])=><output key={key} aria-label={`Scoped ${key} reads`}>{count}</output>)}{ready?<PlanningStateProvider><PlanningApp initialWorkspace={mode==="backlog"?"backlog":"planning"} initialWorkspaceRead={mode==="structure-expired"?initial.read:undefined} initialData={{...emptyPlanningShellState,profiles:[itemPageProfile],...(mode==="structure-expired"?{tasks:initial.model.items}:{})}} initialHeaderData={itemPageHeaderData} initialAuthUser={itemPageUser} initialCurrentProfile={itemPageProfile} initialProtectedDataLoaded authRequired source="supabase"><ReceiptProbe mode={mode}/></PlanningApp></PlanningStateProvider>:null}</>;
}
const meta={title:"Planning/Visible scoped source refresh",component:ScopedRefreshFlow,parameters:{layout:"fullscreen",nextjs:{appDirectory:true,navigation:{pathname:"/backlog"}}},beforeEach:()=>{
  const originalInterval=window.setInterval,originalClearInterval=window.clearInterval,originalTimeout=window.setTimeout,originalClearTimeout=window.clearTimeout;
  const visibility=Object.getOwnPropertyDescriptor(document,"visibilityState");
  const timers=new Map<number,{callback:()=>void;at:number;interval:boolean}>();let nextId=-1;
  clock={now:Date.now(),advance(milliseconds){clock.now+=milliseconds;for(const [id,timer]of [...timers])if(timer.at<=clock.now){if(timer.interval)timer.at=clock.now+60_000;else timers.delete(id);timer.callback();}}};
  scenario={version:"1",failSource:false,memberDeadline:""};
  const now=vi.spyOn(Date,"now").mockImplementation(()=>clock.now);
  window.setInterval=((handler:TimerHandler,delay?:number,...args:unknown[])=>{if(delay!==60_000||typeof handler!=="function")return originalInterval(handler,delay,...args);const id=nextId--;timers.set(id,{callback:()=>handler(...args),at:clock.now+delay,interval:true});return id;}) as typeof window.setInterval;
  window.clearInterval=((id?:number)=>{if(id!==undefined&&timers.delete(id))return;originalClearInterval(id);}) as typeof window.clearInterval;
  window.setTimeout=((handler:TimerHandler,delay?:number,...args:unknown[])=>{if(delay!==500||typeof handler!=="function")return originalTimeout(handler,delay,...args);const id=nextId--;timers.set(id,{callback:()=>handler(...args),at:clock.now+delay,interval:false});return id;}) as typeof window.setTimeout;
  window.clearTimeout=((id?:number)=>{if(id!==undefined&&timers.delete(id))return;originalClearTimeout(id);}) as typeof window.clearTimeout;
  Object.defineProperty(document,"visibilityState",{configurable:true,value:"visible"});
  return()=>{window.setInterval=originalInterval;window.clearInterval=originalClearInterval;window.setTimeout=originalTimeout;window.clearTimeout=originalClearTimeout;now.mockRestore();timers.clear();if(visibility)Object.defineProperty(document,"visibilityState",visibility);else Reflect.deleteProperty(document,"visibilityState");};
}} satisfies Meta<typeof ScopedRefreshFlow>;
export default meta;type Story=StoryObj<typeof meta>;
const advance=async(milliseconds:number)=>{await act(async()=>clock.advance(milliseconds));};
const visibility=(value:"visible"|"hidden")=>{Object.defineProperty(document,"visibilityState",{configurable:true,value});fireEvent(document,new Event("visibilitychange"));};
export const ActiveBacklogChecksSourceAndRefreshesOnlyNeededScopesWithoutRenewingReceipts:Story={
 args:{mode:"backlog"},
 play:async({canvasElement})=>{
  const canvas=within(canvasElement),reads=(key:string,count:number)=>waitFor(()=>expect(canvas.getByLabelText(`Scoped ${key} reads`)).toHaveTextContent(String(count)));
  await reads("membership",1);await reads("controls",1);await reads("sprints",1);
  await advance(59_999);await reads("source",0);await advance(1);await reads("source",1);await reads("membership",1);
  scenario.version="2";await advance(60_000);await reads("source",2);
  await waitFor(()=>expect(canvas.getByLabelText("Current receipt evidence")).toHaveTextContent("stale:none"));
  await advance(499);await reads("membership",1);await reads("controls",1);await reads("sprints",1);
  await advance(1);await reads("membership",2);await reads("controls",2);await reads("sprints",2);
  await expect(canvas.getByLabelText("Current receipt evidence")).toHaveTextContent("current:original");
  scenario.failSource=true;await advance(60_000);await reads("source",3);await reads("membership",2);
  await expect(canvas.getByLabelText("Current receipt evidence")).toHaveTextContent("current:original");
  visibility("hidden");await advance(60_000);fireEvent(window,new Event("online"));await reads("source",3);
  visibility("visible");await reads("source",4);scenario.failSource=false;fireEvent(window,new Event("online"));await reads("source",5);await reads("membership",2);
  await expect(canvas.getByLabelText("Current receipt evidence")).toHaveTextContent("current:original");await reads("hidden",0);
 },
};
export const CurrentStructureOnlyReceiptUsesALightweightCheckInsteadOfReloadingContent:Story={
 args:{mode:"structure-only"},parameters:{nextjs:{appDirectory:true,navigation:{pathname:"/planning"}}},
 play:async({canvasElement})=>{
  const canvas=within(canvasElement);await userEvent.click(await canvas.findByRole("button",{name:"Struktur"}));
  await waitFor(()=>expect(canvas.getByLabelText("Scoped membership reads")).toHaveTextContent("1"));await waitFor(()=>expect(canvas.getByLabelText("Scoped controls reads")).toHaveTextContent("1"));
  await advance(60_000);await waitFor(()=>expect(canvas.getByLabelText("Scoped source reads")).toHaveTextContent("1"));
  await expect(canvas.getByLabelText("Scoped membership reads")).toHaveTextContent("1");await expect(canvas.getByLabelText("Scoped controls reads")).toHaveTextContent("1");
 },
};
export const ExpiredStructureReceiptCannotBorrowTheOlderBoardAuthorityWindow:Story={
 args:{mode:"structure-expired"},parameters:{nextjs:{appDirectory:true,navigation:{pathname:"/planning"}}},
 play:async({canvasElement})=>{
  const canvas=within(canvasElement);await userEvent.click(await canvas.findByRole("button",{name:"Struktur"}));
  await waitFor(()=>expect(canvas.getByLabelText("Scoped membership reads")).toHaveTextContent("1"));await waitFor(()=>expect(canvas.getByLabelText("Scoped controls reads")).toHaveTextContent("1"));
  await advance(60_000);await waitFor(()=>expect(canvas.getByLabelText("Scoped membership reads")).toHaveTextContent("2"));
  await expect(canvas.getByLabelText("Scoped controls reads")).toHaveTextContent("2");await expect(canvas.getByLabelText("Scoped source reads")).toHaveTextContent("0");
  await expect(canvas.getByLabelText("Current receipt evidence")).toHaveTextContent("current:original");await expect(canvas.getByLabelText("Scoped hidden reads")).toHaveTextContent("0");
 },
};
