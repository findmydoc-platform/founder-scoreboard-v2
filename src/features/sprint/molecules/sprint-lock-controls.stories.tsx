import type {Meta,StoryObj} from "@storybook/nextjs-vite";
import {useEffect,useState,useSyncExternalStore} from "react";
import {expect,userEvent,waitFor,within} from "storybook/test";
import {createPlanningState} from "@/features/planning/model/internal/planning-state-owner";
import {emptyPlanningShellState} from "@/features/planning/model/planning-shell-state";
import type {SprintCompletionRead} from "../model/sprint-completion-read";
import {SprintLockControls} from "./sprint-lock-controls";
const sprint={id:"sprint",name:"Sprint 1",status:"review" as const,startDate:"2020-01-01",endDate:"2020-01-14",reviewDueAt:"2020-01-16T22:59:59Z",scoreLocked:false,updatedAt:"opaque/shown"};
const receipt={sprint:{id:sprint.id,status:"closed" as const,scoreLocked:true as const},carryover:{created:1,evaluated:1},scoring:{scores:2,strikeEvents:2}};
function LockStory({unknown=false,conflict=false}:{unknown?:boolean;conflict?:boolean}){const[writes,setWrites]=useState(0),[plans,setPlans]=useState(0),[checks,setChecks]=useState(0),[open,setOpen]=useState(true);const[owner]=useState(()=>createPlanningState({userId:"story",initialWorkspace:"sprint",initialData:{...emptyPlanningShellState,sprints:[sprint]},adapter:{saveTask:async()=>({task:{}}),readWorkspace:async()=>({data:{...emptyPlanningShellState,sprints:[{...sprint,status:"closed",scoreLocked:true,updatedAt:"opaque/locked"}]}}),lockSprint:async basis=>{setWrites(n=>n+1);if(unknown)throw new Error("Antwort verloren");if(conflict&&basis.sprint.updatedAt==="opaque/shown")throw Object.assign(new Error("Parallel geändert"),{status:409,code:"sprint_lock_conflict"});return receipt;},readSprintLock:async()=>{setChecks(n=>n+1);return{basis:{sprint:{...sprint,updatedAt:"opaque/new",scoreLocked:unknown},tasks:[]},tasksComplete:!unknown,receipt:unknown?receipt:null};},createSprintPlan:async()=>{setPlans(n=>n+1);throw Object.assign(new Error("Planung nicht verfügbar"),{status:400});}}}));useSyncExternalStore(owner.planning.subscribe,owner.internal.getSnapshot,owner.internal.getSnapshot);return <main className="p-4"><output aria-label="Lock writes">{writes}</output><output aria-label="Plan writes">{plans}</output><output aria-label="Receipt reads">{checks}</output><button onClick={()=>setOpen(value=>!value)}>Ansicht wechseln</button>{open&&<SprintLockControls planningState={owner.planning} sprint={owner.planning.sprintWorkspace().model.sprints[0]} tasks={[]} options={{firstSprintNumber:1,anchorStartDate:"2099-01-01",rhythmWeeks:2,horizonWeeks:1,targetSprintNumber:2}} disabled={false}/>}</main>;}
const meta={title:"Features/Sprint/LockWorkflow",component:LockStory} satisfies Meta<typeof LockStory>;export default meta;type Story=StoryObj<typeof meta>;
export const KeepsConfirmedLockWhenFollowingPlanFails:Story={play:async({canvasElement})=>{const canvas=within(canvasElement);await userEvent.click(canvas.getByRole("button",{name:"Sprint abschließen"}));await expect(await canvas.findByText("Sprint-Abschluss bestätigt")).toBeVisible();await expect(canvas.getByText("Folgeplanung fehlgeschlagen")).toBeVisible();await expect(canvas.getByLabelText("Lock writes")).toHaveTextContent("1");await expect(canvas.getByLabelText("Plan writes")).toHaveTextContent("1");await expect(canvas.getByRole("button",{name:"Sprint abschließen"})).toBeDisabled();}};
export const ChecksStoredLockReceiptWithoutAnyReplay:Story={args:{unknown:true},play:async({canvasElement})=>{const canvas=within(canvasElement);await userEvent.click(canvas.getByRole("button",{name:"Sprint abschließen"}));await expect(await canvas.findByText("Sprint-Abschluss unklar")).toBeVisible();await userEvent.click(canvas.getByRole("button",{name:"Ansicht wechseln"}));await userEvent.click(canvas.getByRole("button",{name:"Ansicht wechseln"}));await userEvent.click(canvas.getByRole("button",{name:"Abschluss prüfen"}));await expect(await canvas.findByText("Sprint-Abschluss bestätigt")).toBeVisible();await expect(canvas.getByLabelText("Lock writes")).toHaveTextContent("1");await expect(canvas.getByLabelText("Plan writes")).toHaveTextContent("0");await expect(canvas.getByLabelText("Receipt reads")).toHaveTextContent("1");}};
export const ComparesOriginalBasisBeforeConsciousLock:Story={args:{conflict:true},play:async({canvasElement})=>{const canvas=within(canvasElement);await userEvent.click(canvas.getByRole("button",{name:"Sprint abschließen"}));await expect(await canvas.findByText("Sprint vor dem Abschluss prüfen", {selector:"p"})).toBeVisible();await expect(canvas.getByRole("button",{name:"Sprint abschließen"})).toBeDisabled();await userEvent.click(canvas.getByRole("button",{name:"Sprint vor dem Abschluss prüfen"}));await expect(await canvas.findByText("Aktueller Stand: Sprint 1, 0 Aufgaben")).toBeVisible();await userEvent.click(canvas.getByRole("button",{name:"Erneut abschließen"}));await expect(await canvas.findByText("Sprint-Abschluss bestätigt")).toBeVisible();await expect(canvas.getByLabelText("Lock writes")).toHaveTextContent("2");await waitFor(()=>expect(canvas.queryAllByText("Parallel geändert")).toHaveLength(0));await expect(canvas.getByText("Folgeplanung fehlgeschlagen")).toBeVisible();await expect(canvas.getByText("Planung nicht verfügbar")).toBeVisible();await expect(canvas.getByLabelText("Plan writes")).toHaveTextContent("1");await expect(canvas.getByRole("button",{name:"Sprint abschließen"})).toBeDisabled();}};

function ScopedCompletionStory() {
 const [reads,setReads]=useState(0);
 const [writes,setWrites]=useState("");
 const [{owner,failFirstRead}]=useState(()=>{
  let failRead: (() => void) | undefined;
  const now=Date.now();
  const profile={id:"story-profile",name:"CEO",platformRole:"ceo" as const,githubLogin:""};
  const completion: SprintCompletionRead = {
   sprintId:sprint.id,sourceRevision:"source/ready",readActor:{profileId:profile.id,platformRole:"ceo"},
   readAuthority:{userId:"story",deadline:now+120_000},evaluatedAt:new Date(now).toISOString(),validUntil:new Date(now+60_000).toISOString(),
   basis:{sprint:{...sprint,updatedAt:"sprint/verified"},tasks:[{id:"outside",title:"Aufgabe außerhalb der geladenen Liste",updatedAt:"task/verified"}]},
   tasksComplete:true,receipt:null,reviewDueAt:sprint.reviewDueAt,openObjections:0,nextSprintId:"next",decision:{status:"ready",token:"story-completion-token"},
  };
  let requests=0;
  const owner=createPlanningState({
   userId:"story",initialWorkspace:"sprint",initialCurrentProfile:profile,initialData:{...emptyPlanningShellState,sprints:[sprint]},
   initialSession:{userId:"story",user:{id:"story"},revision:"session",expiresAt:Math.floor(now/1000)+120},
   adapter:{
    saveTask:async()=>({task:{}}),
    readWorkspace:async()=>null,
    readSprintCompletion:async(_id,{signal})=>{
     setReads(++requests);
     if(requests>1)return completion;
     return new Promise<SprintCompletionRead>((_,reject)=>{
      const abort=()=>reject(new DOMException("aborted","AbortError"));
      signal.addEventListener("abort",abort,{once:true});
      failRead=()=>{
       signal.removeEventListener("abort",abort);
       reject(Object.assign(new Error("unavailable"),{status:503}));
      };
     });
    },
    lockSprint:async(basis,token)=>{
     setWrites(basis.sprint.updatedAt==="sprint/verified"&&basis.tasks.length===1&&basis.tasks[0].id==="outside"&&basis.tasks[0].updatedAt==="task/verified"&&token==="story-completion-token"?"Exact verified submission":"Unexpected submission");
     return receipt;
    },
   },
  });
  return {owner,failFirstRead:()=>failRead?.()};
 });
 useEffect(()=>()=>owner.internal.dispose(),[owner]);
 useSyncExternalStore(owner.planning.subscribe,owner.internal.getSnapshot,owner.internal.getSnapshot);
 return <main className="p-4">
  <label>Unabhängige Sprintnotiz <input /></label>
  <output aria-label="Completion reads">{reads}</output><output aria-label="Lock writes">{writes}</output>
  <button onClick={failFirstRead}>Erste Abfrage beenden</button>
  <SprintLockControls planningState={owner.planning} sprint={owner.planning.sprintWorkspace().model.sprints[0]} tasks={[]} options={{firstSprintNumber:1,anchorStartDate:"2099-01-01",rhythmWeeks:2,horizonWeeks:1,targetSprintNumber:2}} disabled={false}/>
 </main>;
}

export const WaitsForTheExplicitlyRequestedCompleteBasis:Story={
 render:()=> <ScopedCompletionStory />,
 play:async({canvasElement})=>{
  const canvas=within(canvasElement);
  expect(canvas.getByLabelText("Completion reads")).toHaveTextContent("0");
  await userEvent.click(canvas.getByRole("button",{name:"Sprint abschließen"}));
  const panel=await canvas.findByRole("region",{name:"Abschlussgrundlage"});
  const completion=within(panel);
  await waitFor(()=>expect(panel).toHaveFocus());
  expect(await completion.findByText("Die Grundlage für den Sprint-Abschluss wird geprüft.")).toBeVisible();
  expect(completion.queryByRole("button",{name:"Sprint jetzt abschließen"})).not.toBeInTheDocument();
  expect(completion.queryByText(/0 Aufgaben/)).not.toBeInTheDocument();
  const note=canvas.getByRole("textbox",{name:"Unabhängige Sprintnotiz"});
  await userEvent.type(note,"Unabhängige Änderung");
  await userEvent.click(canvas.getByRole("button",{name:"Erste Abfrage beenden"}));
  expect(await completion.findByText("Die Abschlussgrundlage konnte nicht vollständig geprüft werden.")).toBeVisible();
  expect(canvas.getByLabelText("Lock writes")).toBeEmptyDOMElement();
  await userEvent.click(completion.getByRole("button",{name:"Abschlussgrundlage neu laden"}));
  expect(await completion.findByText("1 Aufgabe · 0 offene Score-Einwände")).toBeVisible();
  await userEvent.click(completion.getByText("Einbezogene Aufgaben"));
  expect(await completion.findByText("Aufgabe außerhalb der geladenen Liste")).toBeVisible();
  expect(canvas.getByLabelText("Completion reads")).toHaveTextContent("2");
  expect(note).toHaveValue("Unabhängige Änderung");
  await userEvent.click(completion.getByRole("button",{name:"Sprint jetzt abschließen"}));
  expect(await canvas.findByText("Sprint-Abschluss bestätigt")).toBeVisible();
  expect(canvas.getByLabelText("Lock writes")).toHaveTextContent("Exact verified submission");
 },
};
