import { useEffect, useState, useSyncExternalStore } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, waitFor, within } from "storybook/test";
import { TaskRelationshipsSection } from "./task-relationships-section";
import { useTaskCollaborationCommands } from "@/features/tasks/hooks/use-task-collaboration-commands";
import { createBrowserPlanningState, type BrowserPlanningState } from "@/features/planning/model/internal/browser-planning-state";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { emptyPlanningHeaderData } from "@/lib/planning-header-data";
import { taskDetailStoryTask } from "@/features/tasks/molecules/task-detail-story-fixtures";
import { buildTaskRelationshipRows } from "@/features/tasks/model/task-detail-state";
import type { TaskRelationshipDraft } from "@/features/tasks/molecules/task-relationship-form";
import type { BrowserApiClient } from "@/lib/browser-api-client";
import { PlanningBusinessStateContext } from "@/features/planning/hooks/use-planning-business-state";
import { createEpicParentBrowserFixture, parentDetailDeliverable, searchedRelationshipTarget, storedRelationshipTarget } from "../../../../tests/helpers/epic-parent-browser-fixture";
import type { Profile, TaskRelation } from "@/lib/types";
const source=taskDetailStoryTask({id:"source",title:"Source",updatedAt:"2026-10-28T00:00:00Z"}),target=taskDetailStoryTask({id:"target",title:"Target",updatedAt:"2026-10-28T00:00:00Z"});
const profile:Profile={id:"author",name:"Author",platformRole:"ceo",orgRole:"CEO",githubLogin:"author",weeklyCapacity:40};
const note="Original relationship note";
const relation:TaskRelation={id:7,taskId:source.id,relatedTaskId:target.id,relationType:"blocked_by",note,createdBy:profile.id,createdAt:"2026-10-28T00:00:00Z"};
const controls=new Map<string,{writes():number;reads():number;finish():void;end():void}>();
function Section({browser}:{browser:BrowserPlanningState}){
 const owner=browser.owner,data=owner.internal.getSnapshot(),detail=owner.planning.taskDetail(source.id);
 const[draft,setDraft]=useState<TaskRelationshipDraft>({relationType:"blocked_by",relatedTaskId:"",note:""});
 const commands=useTaskCollaborationCommands({planningState:owner.planning,apiClient:browser.runtime.apiClient,currentProfile:profile,githubInstallationAvailable:false,githubUserConnected:false,selectedTask:detail.task,data,source:"supabase",setSaveError:()=>{},startTransition:callback=>callback(),canChangeTaskStatus:()=>true,canCorrectOperationally:false,canManageFinalTaskStatus:true,canManageTaskMeta:true});
 if(!detail.task)return <p>Keine Aufgabe</p>;
 const groups=buildTaskRelationshipRows(detail.task,data.tasks,[...detail.relationships]);
 return <TaskRelationshipsSection task={detail.task} profiles={[profile]} {...groups} relationDraft={draft} relationTargetOptions={[{value:target.id,label:"Target"}]} allowedRelationTypes={["blocked_by"]} pending={false} relationshipChanges={owner.planning.taskRelationshipChanges(source.id)} onCheckRelationshipChange={id=>{void owner.planning.checkTaskRelationshipChange(id);}} onOpenTask={()=>{}} onRemoveRelation={edge=>commands.removeTaskRelation(detail.task!,edge)} canRemoveRelation={()=>true} onRelationDraftChange={patch=>setDraft(current=>({...current,...patch}))} onAddRelation={async basis=>{const result=await commands.addTaskRelation(basis,draft);if(result.ok)setDraft({relationType:"blocked_by",relatedTaskId:"",note:""});return result;}}/>;
}
function Fixture({scenario="success"}:{scenario?:string}){
 const[network]=useState(()=>{
  let writes=0,reads=0,exists=scenario.startsWith("remove"),finish=()=>{};
  const client:BrowserApiClient={async requestJson<T>(url:Parameters<BrowserApiClient["requestJson"]>[0],options?:Parameters<BrowserApiClient["requestJson"]>[1]){
   if(options?.method){writes++;const payload=options.json as {expectedUpdatedAt:string;relationId?:number};expect(payload.expectedUpdatedAt).toBe(source.updatedAt);const removing=options.method==="DELETE";if(removing)expect(payload.relationId).toBe(relation.id);else expect(options.json).toMatchObject({relatedTaskId:target.id,relationType:"blocked_by",note});
    const rejected=scenario==="remove-rejected",unknown=scenario==="unknown-add"||scenario==="remove-unknown";if(!rejected)exists=!removing;const result={response:new Response(null,{status:rejected?403:unknown?503:200}),body:(rejected?{error:"Forbidden"}:unknown?{error:"Confirmation lost"}:removing?{relationId:relation.id}:{relation}) as T};if(scenario==="pending")return new Promise<typeof result>(resolve=>{finish=()=>resolve(result);});return result;
   }
   reads++;const task=String(url).includes(`/tasks/${target.id}/`)?target:source;return{response:new Response(null),body:{taskDetail:{revision:"read",project:emptyPlanningShellState.project,item:{...task,updatedAt:"2026-10-28T01:00:00Z",githubIssueSyncStatus:"not_synced"},ancestors:[],children:[],relatedItems:[],people:[profile],sprints:[],discussion:{comments:[],externalComments:[]},blockers:[],relationships:exists?[relation]:[],activity:[],reviews:[],coverage:{relationships:"complete"}}} as T};
  },requestForm:async()=>{throw new Error("Unexpected form");},requestBlob:async()=>{throw new Error("Unexpected blob");}};
  return{client,writes:()=>writes,reads:()=>reads,finish:()=>finish()};
 });
 const[browser]=useState(()=>{const value=createBrowserPlanningState({initialData:{...emptyPlanningShellState,tasks:[source,target],profiles:[profile],taskRelations:scenario.startsWith("remove")?[relation]:[]},initialWorkspace:"planning",initialUserId:"user",initialCurrentProfile:profile,initialHeaderData:emptyPlanningHeaderData});value.runtime.session = {userId:value.runtime.userId,revision:"story-session",expiresAt:4102444800,user:{id:value.runtime.userId}}; value.runtime.apiClient=network.client;return value;});
 useSyncExternalStore(browser.owner.planning.subscribe,browser.owner.internal.getSnapshot,browser.owner.internal.getSnapshot);const[shown,setShown]=useState(true);controls.set(scenario,{...network,end:()=>browser.owner.internal.sessionChanged(null)});
 return <main className="mx-auto grid max-w-3xl gap-3 p-4"><h1>Coordinated task relationships</h1><button onClick={()=>setShown(value=>!value)}>Ansicht wechseln</button><button onClick={()=>void browser.owner.planning.loadTaskDetail(source.id)}>Serverstand laden</button>{shown?<Section browser={browser}/>:<p>Andere Planning-Ansicht</p>}</main>;
}
const meta={title:"Features/Tasks/Organisms/CoordinatedTaskRelationships",component:Fixture,parameters:{layout:"fullscreen"}} satisfies Meta<typeof Fixture>;export default meta;type Story=StoryObj<typeof meta>;
async function openForm(canvasElement:HTMLElement){const canvas=within(canvasElement);await userEvent.click(canvas.getByRole("button",{name:"Beziehung hinzufügen"}));const target=canvas.getByRole("combobox",{name:"Verknüpftes Item"});await userEvent.click(target);await userEvent.click(within(canvasElement.ownerDocument.body).getByRole("option",{name:"Target"}));await waitFor(()=>expect(target).toHaveFocus());await userEvent.type(canvas.getByRole("textbox",{name:"Optionaler Beziehungshinweis"}),note);return canvas;}
async function add(canvasElement:HTMLElement){const canvas=await openForm(canvasElement);await userEvent.click(canvas.getByRole("button",{name:"Abhängigkeit hinzufügen"}));return canvas;}
export const ConfirmedAddPublishesActualRelationship:Story={args:{scenario:"success"},play:async({canvasElement})=>{const canvas=await add(canvasElement);await waitFor(()=>expect(canvas.getByRole("button",{name:"Beziehung zu Target entfernen"})).toBeVisible());await expect(canvas.queryByRole("textbox",{name:"Optionaler Beziehungshinweis"})).not.toBeInTheDocument();expect(controls.get("success")!.writes()).toBe(1);expect(controls.get("success")!.reads()).toBe(2);}};
export const ConfirmedRemovalKeepsRelationshipAbsent:Story={args:{scenario:"remove-success"},play:async({canvasElement})=>{const canvas=within(canvasElement);await userEvent.click(canvas.getByRole("button",{name:"Beziehung zu Target entfernen"}));await waitFor(()=>expect(canvas.getByText("Keine Beziehungen vorhanden.")).toBeVisible());expect(controls.get("remove-success")!.writes()).toBe(1);expect(controls.get("remove-success")!.reads()).toBe(2);}};
export const UnknownAddKeepsInputAcrossNavigationWithoutReplay:Story={args:{scenario:"unknown-add"},play:async({canvasElement})=>{const canvas=await add(canvasElement);await waitFor(()=>expect(canvas.getByText("Ob die Verknüpfung geändert wurde, ist noch unklar. Nicht erneut senden.")).toBeVisible());await expect(canvas.getByRole("textbox",{name:"Optionaler Beziehungshinweis"})).toHaveValue(note);await userEvent.click(canvas.getByRole("button",{name:"Ansicht wechseln"}));await userEvent.click(canvas.getByRole("button",{name:"Ansicht wechseln"}));await expect(canvas.getByText(note)).toBeVisible();await userEvent.click(canvas.getByRole("button",{name:"Verknüpfung prüfen"}));await waitFor(()=>expect(canvas.getByText("Aufgaben geladen. Ob die Verknüpfung geändert wurde, bleibt unklar.")).toBeVisible());await expect(canvas.getByRole("button",{name:"Beziehung hinzufügen"})).toBeDisabled();expect(controls.get("unknown-add")!.writes()).toBe(1);expect(controls.get("unknown-add")!.reads()).toBe(2);}};
export const UnknownRemovalChecksAbsenceWithoutDeletingAgain:Story={args:{scenario:"remove-unknown"},play:async({canvasElement})=>{const canvas=within(canvasElement);await userEvent.click(canvas.getByRole("button",{name:"Beziehung zu Target entfernen"}));await waitFor(()=>expect(canvas.getByText("Ob die Verknüpfung geändert wurde, ist noch unklar. Nicht erneut senden.")).toBeVisible());await userEvent.click(canvas.getByRole("button",{name:"Verknüpfung prüfen"}));await waitFor(()=>expect(canvas.getByText("Aufgaben geladen. Ob die Verknüpfung geändert wurde, bleibt unklar.")).toBeVisible());await expect(canvas.queryByRole("button",{name:"Beziehung zu Target entfernen"})).not.toBeInTheDocument();expect(controls.get("remove-unknown")!.writes()).toBe(1);expect(controls.get("remove-unknown")!.reads()).toBe(2);}};
export const RejectedRemovalRestoresOnlyItsRelationship:Story={args:{scenario:"remove-rejected"},play:async({canvasElement})=>{const canvas=within(canvasElement);await userEvent.click(canvas.getByRole("button",{name:"Beziehung zu Target entfernen"}));await waitFor(()=>expect(canvas.getByText("Die Verknüpfung wurde nicht geändert.")).toBeVisible());await expect(canvas.getByRole("button",{name:"Beziehung zu Target entfernen"})).toBeVisible();expect(controls.get("remove-rejected")!.reads()).toBe(0);}};
export const OpenFormRetainsItsOriginalShownTaskBasis:Story={args:{scenario:"stale-basis"},play:async({canvasElement})=>{const canvas=await openForm(canvasElement);await userEvent.click(canvas.getByRole("button",{name:"Serverstand laden"}));await userEvent.click(canvas.getByRole("button",{name:"Abhängigkeit hinzufügen"}));await expect(canvas.getByText("Die Aufgabe wurde seit dem Öffnen geändert. Schließe das Formular und öffne es erneut; die Eingaben bleiben erhalten.")).toBeVisible();await expect(canvas.getByRole("textbox",{name:"Optionaler Beziehungshinweis"})).toHaveValue(note);expect(controls.get("stale-basis")!.writes()).toBe(0);}};
export const PendingAddPublishesAfterViewRemount:Story={args:{scenario:"pending"},play:async({canvasElement})=>{const canvas=await add(canvasElement);await expect(canvas.getByText("Verknüpfung wird hinzugefügt …")).toBeVisible();await userEvent.click(canvas.getByRole("button",{name:"Ansicht wechseln"}));controls.get("pending")!.finish();await userEvent.click(canvas.getByRole("button",{name:"Ansicht wechseln"}));await waitFor(()=>expect(canvas.getByRole("button",{name:"Beziehung zu Target entfernen"})).toBeVisible());expect(controls.get("pending")!.writes()).toBe(1);}};

function RelationshipDiscoverySectionStory({stored=false}:{stored?:boolean}) {
 const [fixture]=useState(()=>createEpicParentBrowserFixture({parentKind:"relationship",detailTask:parentDetailDeliverable}));
 useEffect(()=>()=>fixture.state.owner.internal.dispose(),[fixture]);
 useSyncExternalStore(fixture.state.owner.planning.subscribe,fixture.state.owner.internal.getSnapshot,fixture.state.owner.internal.getSnapshot);
 const [draft,setDraft]=useState<TaskRelationshipDraft>({relationType:"blocked_by",relatedTaskId:storedRelationshipTarget.id,note:"Erhaltener Detailhinweis"});
 const [submitted,setSubmitted]=useState(""),[removed,setRemoved]=useState(0);
 const source=parentDetailDeliverable;
 const edges:TaskRelation[]=stored?[
  {...relation,id:101,taskId:source.id,relatedTaskId:searchedRelationshipTarget.id,relationType:"blocked_by"},
  {...relation,id:102,taskId:searchedRelationshipTarget.id,relatedTaskId:source.id,relationType:"blocks"},
  {...relation,id:103,taskId:source.id,relatedTaskId:searchedRelationshipTarget.id,relationType:"relates_to"},
  {...relation,id:104,taskId:source.id,relatedTaskId:"unavailable-stored-endpoint",relationType:"relates_to",note:"Gespeicherter unbekannter Kontext"},
 ]:[];
 const groups=buildTaskRelationshipRows(source,[source,{...searchedRelationshipTarget,status:"Erledigt",assignee:"CEO"}],edges);
 return <PlanningBusinessStateContext.Provider value={fixture.state.owner.planning}><output aria-label="Submitted detail relationship">{submitted}</output><output aria-label="Removed canonical edge">{removed}</output>
  <TaskRelationshipsSection task={source} profiles={fixture.data.profiles} {...groups} relationDraft={draft} relationTargetOptions={[]} allowedRelationTypes={["blocked_by","blocks","relates_to"]} pending={false} onOpenTask={()=>{}} onRemoveRelation={edge=>setRemoved(edge.id)} canRemoveRelation={()=>true} onRelationDraftChange={patch=>setDraft(current=>({...current,...patch}))}
    onAddRelation={async basis=>{setSubmitted(JSON.stringify({source:basis.id,version:basis.updatedAt,...draft}));return {ok:true};}}/>
 </PlanningBusinessStateContext.Provider>;
}
export const DetailRelationshipDiscoversOffPageTargetsWithinItsSourceScope:Story={render:()=> <RelationshipDiscoverySectionStory/>,play:async({canvasElement})=>{
 const canvas=within(canvasElement),page=within(document.body);await userEvent.click(canvas.getByRole("button",{name:"Beziehung hinzufügen"}));
 const trigger=canvas.getByRole("combobox",{name:"Verknüpftes Item"});await waitFor(()=>expect(trigger).toHaveTextContent(storedRelationshipTarget.title));
 await userEvent.click(trigger);await page.findByRole("searchbox",{name:"Item suchen"});
 await userEvent.click(await page.findByRole("button",{name:"Weitere Items laden"}));
 await userEvent.click(await page.findByRole("option",{name:"Fernes verknüpftes Item · CEO"}));
 await userEvent.click(trigger);const search=page.getByRole("searchbox",{name:"Item suchen"});await userEvent.type(search,"Kein Treffer");await userEvent.keyboard("{Enter}");
 await expect(await page.findByText("Keine Items gefunden.")).toBeVisible();await expect(trigger).toHaveTextContent(searchedRelationshipTarget.title);await userEvent.keyboard("{Escape}");
 await expect(canvas.getByRole("textbox",{name:"Optionaler Beziehungshinweis"})).toHaveValue("Erhaltener Detailhinweis");
 await userEvent.click(canvas.getByRole("button",{name:"Abhängigkeit hinzufügen"}));
 await waitFor(()=>expect(canvas.getByLabelText("Submitted detail relationship")).toHaveTextContent(JSON.stringify({source:parentDetailDeliverable.id,version:parentDetailDeliverable.updatedAt,relationType:"blocked_by",relatedTaskId:searchedRelationshipTarget.id,note:"Erhaltener Detailhinweis"})));
}};
export const StoredEndpointContextSurvivesDiscoveryAndKeepsCanonicalEdges:Story={render:()=> <RelationshipDiscoverySectionStory stored/>,play:async({canvasElement})=>{
 const canvas=within(canvasElement),page=within(document.body);
 await expect(canvas.getAllByRole("link",{name:searchedRelationshipTarget.title})).toHaveLength(1);
 await expect(canvas.getByText("Erledigt · CEO")).toBeVisible();
 await expect(canvas.getByText("Aufgabenkontext nicht verfügbar")).toBeVisible();
 await expect(canvas.getByText("Gespeicherter unbekannter Kontext")).toBeVisible();
 await userEvent.click(canvas.getByRole("button",{name:"Beziehung hinzufügen"}));const trigger=canvas.getByRole("combobox",{name:"Verknüpftes Item"});await userEvent.click(trigger);
 const search=await page.findByRole("searchbox",{name:"Item suchen"});await userEvent.type(search,"Kein Treffer");await userEvent.keyboard("{Enter}");
 await expect(await page.findByText("Keine Items gefunden.")).toBeVisible();await userEvent.keyboard("{Escape}");
 await expect(canvas.getAllByRole("link",{name:searchedRelationshipTarget.title})).toHaveLength(1);
 await userEvent.click(canvas.getByRole("button",{name:`Beziehung zu ${searchedRelationshipTarget.title} entfernen`}));
 await expect(canvas.getByLabelText("Removed canonical edge")).toHaveTextContent("101");
}};
