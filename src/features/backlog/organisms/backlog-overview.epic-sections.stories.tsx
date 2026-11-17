import { useEffect, useState, useSyncExternalStore } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fireEvent, userEvent, waitFor, within } from "storybook/test";
import { BacklogOverview } from "./backlog-overview";
import { createBrowserPlanningLifetime } from "@/features/planning/model/internal/browser-planning-lifetime";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { emptyPlanningHeaderData } from "@/lib/planning-header-data";
import { taskDetailStoryTask } from "@/features/tasks/molecules/task-detail-story-fixtures";
import type { BrowserApiClient, BrowserApiJsonResult } from "@/lib/browser-api-client";
import type { BacklogModel } from "../model/backlog-read-model";
import type { BacklogSelectionQuery } from "../model/backlog-selection";
import type { Task } from "@/lib/types";

let rejectHeldInitiatives=()=>{};
function EpicSectionsFixture(){
 const [counts,setCounts]=useState({level:0,orphanInitiatives:0,orphanDeliverables:0,legacy:0});
 const [bundle]=useState(()=>{
  const userId="epic-section-reader",deadline=Date.now()+300_000,profile={id:"epic-section-founder",name:"Synthetic founder",platformRole:"founder" as const,orgRole:"Founder",githubLogin:"",weeklyCapacity:40};
  const sections=["level","orphanInitiatives","orphanDeliverables"] as const;
  const rows=Object.fromEntries(sections.map(section=>[section,Array.from({length:21},(_,index)=>taskDetailStoryTask({id:`${section}-${index+1}`,title:section==="level"?`Epic ${index+1}`:section==="orphanInitiatives"?`Initiative ohne Epic ${index+1}`:`Deliverable ohne Initiative ${index+1}`,taskType:section==="level"?"epic":section==="orphanInitiatives"?"initiative":"deliverable",parentTaskId:"",status:section!=="level"&&index===20?"Erledigt":"Offen",description:"Epic search",order:index+1,updatedAt:"2026-11-01T12:00:00Z"}))]));
  const omitted:(keyof Task)[]=["description","note","strategy","raciAssignments","evidenceLinks","linkedPullRequests"];
  const compact=(task:Task)=>{const row={...task,detailAvailability:"summary" as const};omitted.forEach(field=>{delete row[field];});return row;};
  const empty:BacklogModel={revision:"epic-section-source",items:[],people:[],sprints:[],commitments:[],coverage:{items:"partial",people:"partial",sprints:"partial",commitments:"partial",strategies:"partial",raci:"partial",links:"partial"}};
  const receipt=(scopeRevision:string)=>({scopeRevision,sourceRevision:"epic-section-source",observedAt:"2026-11-01T12:00:00Z",validUntil:new Date(deadline).toISOString()});
  const response=(model:BacklogModel)=>({response:new Response(null),body:{model,readAuthority:{userId,deadline},readActor:{profileId:profile.id,platformRole:profile.platformRole}}});
  let initiativeAttempts=0;
  const client:BrowserApiClient={async requestJson<T>(input:Parameters<BrowserApiClient["requestJson"]>[0]){
   const url=new URL(String(input),"http://localhost:3000"),raw=url.searchParams.get("scope");
   if(url.pathname!=="/api/backlog-data")throw new Error("No hierarchy or complete fallback");
   if(!raw){setCounts(value=>({...value,legacy:value.legacy+1}));return{response:new Response(null,{status:503}),body:{error:"No legacy discovery"} as T};}
   const query=JSON.parse(raw);
   if(query.view==="backlog-support"&&query.area==="controls"){
    const controls={...receipt("controls"),coverage:"complete" as const,levelTotals:{epic:21,initiative:21,deliverable:21},statuses:{epic:["Offen"],initiative:["Offen","Erledigt"],deliverable:["Offen","Erledigt"]},assignees:[],epics:rows.level.map(row=>({value:row.id,label:row.title})),initiatives:rows.orphanInitiatives.map(row=>({value:row.id,label:row.title})),scopeCounts:{all:20,proposals:20,ready:0,unscheduled:20},orphanProgress:{orphanInitiatives:{total:21,completed:1,unfinished:20},orphanDeliverables:{total:21,completed:1,unfinished:20}}};
    return response({...empty,controls}) as BrowserApiJsonResult<T>;
   }
   if(query.view!=="backlog"||query.filters.level!=="epic")throw new Error("Unexpected Epic section scope");
   const selectionQuery=query as BacklogSelectionQuery,section=selectionQuery.section||"level";setCounts(value=>({...value,[section]:value[section]+1}));
   if(section==="orphanInitiatives"&&++initiativeAttempts===1)return new Promise<BrowserApiJsonResult<T>>(resolve=>{rejectHeldInitiatives=()=>resolve({response:new Response(null,{status:503}),body:{error:"Synthetic independent section failure"} as T});});
   const all=section==="level"&&selectionQuery.filters.query==="keine epics"?[]:rows[section],offset=selectionQuery.continuation?20:0,chosen=all.slice(offset,offset+selectionQuery.limit);
   return response({...empty,items:chosen.map(compact),taskOmittedFields:omitted,selection:{...receipt(`section-${section}-${selectionQuery.filters.query}`),query:selectionQuery,itemIds:chosen.map(row=>row.id),contextIds:[],rankById:Object.fromEntries(chosen.map(row=>[row.id,row.order])),total:all.length,coverage:offset+chosen.length===all.length?"complete":"partial",continuation:offset+chosen.length===all.length?null:`next-${section}`}}) as BrowserApiJsonResult<T>;
  },requestForm:async()=>{throw new Error("Unexpected form");},requestBlob:async()=>{throw new Error("Unexpected blob");}};
  const session={userId,revision:"epic-section-session",expiresAt:deadline/1000,user:{id:userId}},lifetime=createBrowserPlanningLifetime({current:async()=>session,subscribe:()=>()=>{}});
  const browser=lifetime.page({initialData:emptyPlanningShellState,initialWorkspace:"backlog",initialUserId:userId,initialHeaderData:emptyPlanningHeaderData,initialCurrentProfile:profile})!;browser.runtime.apiClient=client;return{browser,lifetime};
 });
 useEffect(()=>{const disconnect=bundle.lifetime.connect();return()=>{rejectHeldInitiatives();disconnect();bundle.browser.owner.internal.dispose();};},[bundle]);
 useSyncExternalStore(bundle.browser.owner.planning.subscribe,bundle.browser.owner.internal.getSnapshot,bundle.browser.owner.internal.getSnapshot);
 return <main>{Object.entries(counts).map(([section,count])=><output key={section} aria-label={`Abfragen ${section}`}>{count}</output>)}<BacklogOverview readMode="selected" planningState={bundle.browser.owner.planning} canManageBacklog={false} onOpenTask={()=>{}} onCreatePlanningItem={()=>{}} onProposeDeliverable={()=>{}}/></main>;
}
const meta={title:"Planning/Backlog/IndependentEpicSections",component:EpicSectionsFixture,parameters:{nextjs:{appDirectory:true,navigation:{pathname:"/backlog",query:{"backlog.level":"epic","backlog.query":"Epic search"}}}}} satisfies Meta<typeof EpicSectionsFixture>;
export default meta;type Story=StoryObj<typeof meta>;
export const IndependentEpicSectionsKeepRollupsAndRetryWhileFilteringOnlyThePrimary:Story={
 play:async({canvasElement})=>{
  const canvas=within(canvasElement);
  for(const section of ["level","orphanInitiatives","orphanDeliverables"])await waitFor(()=>expect(canvas.getByLabelText(`Abfragen ${section}`)).toHaveTextContent("1"));
  await expect(canvas.getByLabelText("Abfragen legacy")).toHaveTextContent("0");
  const primary=within(await canvas.findByRole("region",{name:"Epics"})),initiatives=within(await canvas.findByRole("region",{name:"Ohne Epic"})),deliverables=within(await canvas.findByRole("region",{name:"Ohne Initiative"}));
  const epic=await primary.findByRole("link",{name:"Epic 1"});await expect(epic).toHaveAttribute("href","/tasks/level-1");
  await expect(initiatives.getByRole("progressbar",{name:"1 von 21 Initiativen erledigt"})).toBeVisible();await expect(deliverables.getByRole("progressbar",{name:"1 von 21 Deliverables erledigt"})).toBeVisible();
  await expect(initiatives.queryByRole("link",{name:"Initiative ohne Epic 1"})).not.toBeInTheDocument();
  rejectHeldInitiatives();await expect(await initiatives.findByText("Initiativen ohne Epic konnten nicht geladen werden.")).toBeVisible();await expect(epic).toBeVisible();
  await userEvent.click(initiatives.getByRole("button",{name:"Initiativen ohne Epic erneut laden"}));await expect(await initiatives.findByRole("link",{name:"Initiative ohne Epic 1"})).toBeVisible();
  await userEvent.click(deliverables.getByRole("button",{name:"Weitere Deliverables laden"}));await expect(await deliverables.findByRole("link",{name:"Deliverable ohne Initiative 21"})).toHaveAttribute("href","/tasks/orphanDeliverables-21");
  await expect(canvas.getByLabelText("Abfragen level")).toHaveTextContent("1");await expect(canvas.getByLabelText("Abfragen orphanInitiatives")).toHaveTextContent("2");
  const search=canvas.getByRole("searchbox",{name:"Backlog durchsuchen"});await userEvent.click(search);fireEvent.change(search,{target:{value:"Keine Epics"}});
  await waitFor(()=>expect(canvas.getByLabelText("Abfragen level")).toHaveTextContent("2"));await expect(search).toHaveFocus();
  await expect(canvas.getByLabelText("Abfragen orphanInitiatives")).toHaveTextContent("2");await expect(canvas.getByLabelText("Abfragen orphanDeliverables")).toHaveTextContent("2");await expect(deliverables.getByRole("link",{name:"Deliverable ohne Initiative 21"})).toBeVisible();
  await expect(canvas.getByText((_,node)=>node?.tagName==="SPAN"&&node.textContent?.trim()==="0 von 0")).toBeVisible();
 },
};
