import { useEffect, useState } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { PlanningApp } from "./PlanningApp";
import { PlanningStateProvider } from "./organisms/planning-state-provider";
import { emptyPlanningShellState } from "./model/planning-shell-state";
import { taskDetailStoryTask } from "@/features/tasks/molecules/task-detail-story-fixtures";
import { productUpdates } from "@/features/product-updates/model/product-update-registry";
import { itemPageProfile, itemPageUser, itemPageHeaderData, mockItemPageBrowser } from "../../../tests/helpers/task-detail-page-browser-fixture";
const parent = taskDetailStoryTask({ id: "scalar-visible-parent", title: "Visible scalar Initiative", taskType: "initiative", updatedAt: "2026-11-01T12:00:00Z", detailAvailability: "summary" });
function StructureControlsFlow() {
  const [ready,setReady]=useState(false),[counts,setCounts]=useState({controls:0,roots:0});
  useEffect(()=>{
    let active=true,restore:(()=>void)|undefined;
    const key=`founderops.product-updates.seen.${itemPageProfile.id}`,previous=localStorage.getItem(key);
    localStorage.setItem(key,JSON.stringify(productUpdates.map(update=>update.id)));
    void mockItemPageBrowser({respond:input=>{
      const url=new URL(String(input),"http://localhost:3000");if(url.pathname!=="/api/planning-board-data")return undefined;
      const query=JSON.parse(url.searchParams.get("scope")||"{}");
      if(query.view!=="structure")return Response.json({error:"Unselected class"},{status:503});
      const deadline=Date.now()+60_000,receipt={sourceRevision:"scalar-controls-source",scopeRevision:query.area,observedAt:"2026-11-01T12:00:00Z",validUntil:new Date(deadline).toISOString()};
      if(query.area==="controls"){
        setCounts(value=>({...value,controls:value.controls+1}));
        return Response.json({readActor:{profileId:itemPageProfile.id,platformRole:itemPageProfile.platformRole},readAuthority:{userId:itemPageUser.id,deadline},model:{revision:receipt.sourceRevision,controls:{...receipt,coverage:"complete",people:[{id:itemPageProfile.id,name:itemPageProfile.name},{id:"offpage-scalar-person",name:"Offpage scalar person"}],sprints:[{id:"closed-scalar-sprint",name:"Closed scalar Sprint"}],initiatives:[{id:parent.id,title:parent.title},{id:"offpage-scalar-parent",title:"Offpage scalar Initiative"}],workstreams:["Offpage scalar workstream"]}}});
      }
      setCounts(value=>({...value,roots:value.roots+1}));
      return Response.json({readActor:{profileId:itemPageProfile.id,platformRole:itemPageProfile.platformRole},readAuthority:{userId:itemPageUser.id,deadline},model:{revision:receipt.sourceRevision,items:[parent],people:[itemPageProfile],taskOmittedFields:["note","evidenceLinks"],structure:{...receipt,query,itemIds:[parent.id],contextIds:[],total:1,coverage:"complete",continuation:null}}});
    }}).then(cleanup=>{if(!active)cleanup();else{restore=cleanup;setReady(true);}});
    return()=>{active=false;restore?.();if(previous===null)localStorage.removeItem(key);else localStorage.setItem(key,previous);};
  },[]);
  return <>{Object.entries(counts).map(([key,count])=><output key={key} aria-label={`Scalar-Strukturabfragen ${key}`}>{count}</output>)}{ready?<PlanningStateProvider><PlanningApp initialWorkspace="planning" initialData={{...emptyPlanningShellState,profiles:[itemPageProfile]}} initialHeaderData={itemPageHeaderData} initialAuthUser={itemPageUser} initialCurrentProfile={itemPageProfile} initialProtectedDataLoaded authRequired source="supabase"/></PlanningStateProvider>:null}</>;
}
const meta={title:"Planning/Structure filter basis",component:StructureControlsFlow,parameters:{layout:"fullscreen",nextjs:{appDirectory:true,navigation:{pathname:"/planning"}}}} satisfies Meta<typeof StructureControlsFlow>;
export default meta;type Story=StoryObj<typeof meta>;
export const StructureFiltersKeepCompleteOptionsOutsideRootAndChildPages:Story={
 play:async({canvasElement})=>{
  const canvas=within(canvasElement),body=within(document.body);
  await userEvent.click(await canvas.findByRole("button",{name:"Struktur"}));
  await waitFor(()=>expect(canvas.getByLabelText("Scalar-Strukturabfragen controls")).toHaveTextContent("1"));
  await waitFor(()=>expect(canvas.getByLabelText("Scalar-Strukturabfragen roots")).toHaveTextContent("1"));
  await userEvent.click(canvas.getByRole("button",{name:"Filter"}));
  for(const [label,option] of [["Nach Zuständigkeit filtern","Offpage scalar person"],["Nach Initiative filtern","Offpage scalar Initiative"],["Nach Sprint filtern","Closed scalar Sprint"],["Nach Bereich filtern","Offpage scalar workstream"]]){
    const control = canvas.getByRole("combobox", { name: label });
    await userEvent.click(control);
    await expect(await body.findByRole("option", { name: option })).toBeVisible();
    await userEvent.keyboard("{Escape}");
    await waitFor(() => expect(canvas.getByRole("combobox", { name: label })).toHaveFocus());
  }
  await expect(canvas.getByLabelText("Scalar-Strukturabfragen controls")).toHaveTextContent("1");await expect(canvas.getByLabelText("Scalar-Strukturabfragen roots")).toHaveTextContent("1");
 },
};
