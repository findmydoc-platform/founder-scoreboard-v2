import { useEffect, useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { PlanningApp } from "./PlanningApp";
import { PlanningStateProvider } from "./organisms/planning-state-provider";
import { emptyPlanningShellState } from "./model/planning-shell-state";
import { normalizePlanningBoardQuery, planningBoardQueryKey, type PlanningBoardColumn } from "./model/planning-board-query";
import { normalizePlanningGanttQuery, planningGanttQueryKey } from "./model/planning-gantt-query";
import { planningWorkspaceHydration } from "./model/planning-workspace-hydration";
import type { PlanningWorkspaceModel } from "@/features/planning-items/model/planning-workspace-model";
import type { TaskStatus } from "@/lib/types";
import { taskStatuses } from "@/lib/status";
import { taskDetailStoryTask } from "@/features/tasks/molecules/task-detail-story-fixtures";
import { productUpdates } from "@/features/product-updates/model/product-update-registry";
import { itemPageProfile, itemPageUser, itemPageHeaderData, mockItemPageBrowser } from "../../../tests/helpers/task-detail-page-browser-fixture";

const sourceRevision="1",updatedAt="2026-11-01T12:00:00Z";
const parent=taskDetailStoryTask({id:"gantt-parent",title:"Gantt parent context",taskType:"initiative",updatedAt});
const sprint={id:"gantt-sprint",name:"Gantt Sprint",startDate:"2026-11-16",endDate:"2026-11-20",reviewDueAt:"",scoreLocked:false,status:"planning" as const};
const active=taskDetailStoryTask({id:"gantt-active",title:"Active Gantt work",parentTaskId:parent.id,sprintId:sprint.id,assigneeId:itemPageProfile.id,ownerId:itemPageProfile.id,updatedAt});
const completed=Array.from({length:25},(_,index)=>taskDetailStoryTask({id:`gantt-done-${index+1}`,title:`Completed Gantt work ${index+1}`,status:"Erledigt",parentTaskId:parent.id,sprintId:sprint.id,order:index+1,updatedAt}));
const all=[active,...completed],initialCards=[active,...completed.slice(0,20)];
// The toolbar also counts non-deliverables that the Gantt timeline does not render.
const workspaceToolbarCount=all.length+5;
const session={userId:itemPageUser.id,user:itemPageUser,revision:"item-page-session",expiresAt:Math.floor(Date.now()/1000)+3600};
const revision={activeTaskCount:all.length+1,latestUpdatedAt:updatedAt};

function boardModel():PlanningWorkspaceModel {
  const query=normalizePlanningBoardQuery({view:"board"});
  const columns=Object.fromEntries([...taskStatuses,"Pausiert"].map(status=>[status,{
    total:status==="Offen"?1:status==="Erledigt"?25:0,loaded:initialCards.filter(task=>task.status===status).length,
    availability:"ready",completeness:status==="Erledigt"?"partial":"complete",continuation:status==="Erledigt"?"remaining-done":null,
  } satisfies PlanningBoardColumn])) as Record<TaskStatus,PlanningBoardColumn>;
  return {project:emptyPlanningShellState.project,revision:sourceRevision,scopeRevision:sourceRevision,queryRevision:sourceRevision,query,
    items:[parent,...initialCards],people:[itemPageProfile],sprints:[sprint],relationships:[],preferences:[],
    coverage:{items:"partial",people:"complete",sprints:"complete",relationships:"partial",preferences:"complete",strategies:"partial",raci:"partial",links:"partial",blockers:"partial"},
    board:{query,queryKey:planningBoardQueryKey(query),revision:sourceRevision,observedAt:updatedAt,validUntil:null,cardIds:initialCards.map(task=>task.id),columns,
      childProgressById:Object.fromEntries(initialCards.map(task=>[task.id,{total:0,completed:0,unfinished:0,percentage:0}])),
      attentionById:Object.fromEntries(initialCards.map(task=>[task.id,[]])),viewerOpenSubIssueIdsByDeliverableId:{},metrics:{total:26,open:1,done:25,blocked:0},workspaceRevision:revision},
  };
}

const offpageInitiative={id:"gantt-offpage-initiative",title:"Initiative außerhalb der Gantt-Auswahl"};
const offpageWorkstream="Bereich außerhalb der Gantt-Auswahl";

function SelectedGanttFlow({toolbar = false}: {toolbar?: boolean}) {
  const [ready,setReady]=useState(false),[counts,setCounts]=useState({gantt:0,complete:0,controls:0});
  const [release,setRelease]=useState<(()=>void)|null>(null);
  const [basis]=useState(()=>({model:boardModel(),deadline:Date.now()+60_000,observedAt:new Date().toISOString()}));
  useEffect(()=>{
    let mounted=true,restore:(()=>void)|undefined,releaseHeld:(()=>void)|undefined,attempts=0;
    const seenKey=`founderops.product-updates.seen.${itemPageProfile.id}`,previous=localStorage.getItem(seenKey);
    localStorage.setItem(seenKey,JSON.stringify(productUpdates.map(update=>update.id)));
    void mockItemPageBrowser({respond:input=>{
      const url=new URL(String(input),"http://localhost:3000");
      if(url.pathname==="/api/auth/session")return Response.json({session});
      if(url.pathname==="/api/planning-source-version")return Response.json({version:sourceRevision});
      if(url.pathname==="/api/planning-revision")return Response.json({revision});
      if(url.pathname!=="/api/planning-board-data")return undefined;
      const raw=JSON.parse(url.searchParams.get("scope")||"{}");
      const authority={userId:itemPageUser.id,deadline:basis.deadline};
      if(raw.view==="structure"&&raw.area==="controls") {
        setCounts(value=>({...value,controls:value.controls+1}));
        const initiatives=[{id:parent.id,title:parent.title}];
        if(toolbar)initiatives.push(offpageInitiative);
        return Response.json({readAuthority:authority,readActor:{profileId:itemPageProfile.id,platformRole:itemPageProfile.platformRole},model:{revision:sourceRevision,controls:{
          people:[{id:itemPageProfile.id,name:itemPageProfile.name}],sprints:[{id:sprint.id,name:sprint.name}],initiatives,
          workstreams:toolbar?[offpageWorkstream]:[],coverage:"complete",sourceRevision,scopeRevision:"gantt-controls",observedAt:basis.observedAt,validUntil:new Date(basis.deadline).toISOString(),
        }}});
      }
      if(raw.view==="complete") {
        setCounts(value=>({...value,complete:value.complete+1}));
        return Response.json({error:"Gantt must not enumerate the complete workspace"},{status:503});
      }
      if(raw.view!=="gantt")return Response.json({model:basis.model,readAuthority:authority,currentProfile:itemPageProfile});
      const query=normalizePlanningGanttQuery(raw);
      if(!query)return Response.json({error:"Invalid Gantt fixture query"},{status:400});
      setCounts(value=>({...value,gantt:value.gantt+1}));
      if(!toolbar&&++attempts===1)return new Promise<Response>(resolve=>{
        const releaseFailure=()=>{resolve(Response.json({error:"Selected Gantt unavailable"},{status:503}));if(mounted)setRelease(null);};
        releaseHeld=releaseFailure;
        setRelease(()=>releaseFailure);
      });
      const matches=toolbar&&(query.filters.initiativeId===offpageInitiative.id||query.filters.workstream===offpageWorkstream)?[]:all;
      const model:PlanningWorkspaceModel={project:emptyPlanningShellState.project,revision:sourceRevision,scopeRevision:sourceRevision,
        items:matches.length?[parent,...matches]:[],people:[itemPageProfile],sprints:[sprint],relationships:[],preferences:[],
        coverage:{items:"partial",people:"partial",sprints:"partial",relationships:"partial",preferences:"partial",strategies:"partial",raci:"partial",links:"partial",blockers:"partial"},
        gantt:{query,queryKey:planningGanttQueryKey(query),itemIds:matches.map(task=>task.id),contextIds:matches.length?[parent.id]:[],total:matches.length,
          toolbarCounts:{filtered:matches.length?workspaceToolbarCount:0,unfiltered:workspaceToolbarCount},
          coverage:{items:"complete",hierarchy:"complete",schedule:"complete",relationships:"complete"},sourceRevision,observedAt:basis.observedAt,temporalKey:"stable",validUntil:null},
      };
      return Response.json({model,readAuthority:authority,currentProfile:itemPageProfile});
    }}).then(cleanup=>{if(!mounted)cleanup();else{restore=cleanup;setReady(true);}});
    return()=>{mounted=false;releaseHeld?.();restore?.();if(previous===null)localStorage.removeItem(seenKey);else localStorage.setItem(seenKey,previous);};
  },[basis,toolbar]);
  return <><output aria-label="Selected Gantt requests">{counts.gantt}</output><output aria-label="Complete workspace requests">{counts.complete}</output>
    {toolbar?<output aria-label="Structure controls requests">{counts.controls}</output>:null}
    {release?<button onClick={release}>Gantt-Leseantwort freigeben</button>:null}
    {ready?<PlanningStateProvider><PlanningApp initialWorkspace="planning" initialData={{...emptyPlanningShellState,tasks:[...basis.model.items],profiles:[itemPageProfile],sprints:[sprint]}}
      initialWorkspaceRead={planningWorkspaceHydration("planning",basis.model,session,{userId:itemPageUser.id,deadline:basis.deadline})}
      initialHeaderData={itemPageHeaderData} initialAuthUser={itemPageUser} initialCurrentProfile={itemPageProfile} initialProtectedDataLoaded authRequired source="supabase"/></PlanningStateProvider>:null}
  </>;
}

const meta={title:"Planning/Selected Gantt",component:SelectedGanttFlow,
  // Load the existing view module so the contract fails on data demand, not code loading.
  loaders:[async()=>{await import("@/features/tasks/organisms/gantt-view");return {};}],
  parameters:{layout:"fullscreen",nextjs:{appDirectory:true,navigation:{pathname:"/planning"}}},
} satisfies Meta<typeof SelectedGanttFlow>;
export default meta;
type Story=StoryObj<typeof meta>;
export const SelectedGanttRetriesItsCompleteBasisWithoutWorkspaceFallback:Story={
  play:async({canvasElement})=>{
    const canvas=within(canvasElement),target=completed[24];
    const board=within(await canvas.findByRole("region",{name:"Board nach Status"}));
    await expect(await board.findByRole("link",{name:active.title})).toHaveAttribute("href",`/tasks/${active.id}`);
    await expect(canvas.getByLabelText("Selected Gantt requests")).toHaveTextContent(/^0$/);
    await expect(canvas.getByLabelText("Complete workspace requests")).toHaveTextContent(/^0$/);
    await userEvent.click(canvas.getByRole("button",{name:"Gantt"}));
    await waitFor(()=>expect(canvas.getByLabelText("Selected Gantt requests")).toHaveTextContent(/^1$/));
    await expect(canvas.getByLabelText("Complete workspace requests")).toHaveTextContent(/^0$/);
    await expect(await canvas.findByText("Gantt wird geladen …")).toBeVisible();
    await expect(canvas.queryByRole("link",{name:`${target.title} · 5 Tage`})).not.toBeInTheDocument();
    await expect(canvas.getByRole("button",{name:"Board"})).toBeEnabled();
    await userEvent.click(canvas.getByRole("button",{name:"Gantt-Leseantwort freigeben"}));
    const retry=await canvas.findByRole("button",{name:"Ansicht erneut laden"});
    await expect(canvas.queryByText(/^von [0-9]+$/, { selector: "span" })).not.toBeInTheDocument();
    await expect(retry).toBeEnabled();
    await expect(canvas.getByLabelText("Complete workspace requests")).toHaveTextContent(/^0$/);
    await userEvent.click(retry);
    await waitFor(()=>expect(canvas.getByLabelText("Selected Gantt requests")).toHaveTextContent(/^2$/));
    const results=within(await canvas.findByRole("region",{name:"Planungsergebnisse"}));
    const bar=await results.findByRole("link",{name:`${target.title} · 5 Tage`});
    await expect(bar).toHaveAttribute("href",`/tasks/${target.id}`);
    await expect(bar).toHaveAttribute("title",`${target.title} · ${parent.title}`);
    await expect(canvas.getByText(`von ${workspaceToolbarCount}`, { selector: "span" })).toHaveTextContent(`${workspaceToolbarCount} von ${workspaceToolbarCount}`);
    for(const task of all) {
      await expect(results.getByRole("link",{name:task.title})).toHaveAttribute("href",`/tasks/${task.id}`);
      await expect(results.getByRole("link",{name:`${task.title} · 5 Tage`})).toHaveAttribute("href",`/tasks/${task.id}`);
    }
    await expect(canvas.getByLabelText("Complete workspace requests")).toHaveTextContent(/^0$/);
  },
};


export const GanttFiltersIncludeOptionsOutsideItsSelectedRows:Story={
  args:{toolbar:true},
  play:async({canvasElement})=>{
    const canvas=within(canvasElement),body=within(document.body);
    const board=within(await canvas.findByRole("region",{name:"Board nach Status"}));
    await expect(await board.findByRole("link",{name:active.title})).toBeVisible();
    await userEvent.click(canvas.getByRole("button",{name:"Gantt"}));
    const results=within(await canvas.findByRole("region",{name:"Planungsergebnisse"}));
    await expect(await results.findByRole("link",{name:active.title})).toBeVisible();
    await expect(canvas.getByLabelText("Complete workspace requests")).toHaveTextContent(/^0$/);
    await waitFor(()=>expect(canvas.getByLabelText("Structure controls requests")).toHaveTextContent(/^1$/));
    await userEvent.click(canvas.getByRole("button",{name:"Filter"}));
    for(const [label,optionName] of [
      ["Nach Initiative filtern",offpageInitiative.title],
      ["Nach Bereich filtern",offpageWorkstream],
    ]){
      const control=canvas.getByRole("combobox",{name:label});
      await userEvent.click(control);
      const option=await body.findByRole("option",{name:optionName});
      await expect(option).toBeVisible();
      await userEvent.click(option);
      await expect(control).toHaveTextContent(optionName);
    }
    await expect(canvas.getByLabelText("Complete workspace requests")).toHaveTextContent(/^0$/);
  },
};
