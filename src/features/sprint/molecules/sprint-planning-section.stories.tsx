import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState, useSyncExternalStore } from "react";
import { expect, userEvent, within } from "storybook/test";
import { createPlanningState } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { SprintPlanningSection } from "./sprint-planning-section";
import type { Sprint } from "@/lib/types";
const sprint: Sprint = { id:"sprint-1",name:"Sprint 1",status:"planning",startDate:"2098-01-01",endDate:"2098-01-14",reviewDueAt:"2098-01-16",scoreLocked:false,updatedAt:"opaque/original" };
function PlanStory({ conflict=false, success=false }: {conflict?:boolean;success?:boolean}) {
 const [writes,setWrites]=useState(0),[reads,setReads]=useState(0),[open,setOpen]=useState(true);
 const [draft,setDraft]=useState({firstSprintNumber:1,anchorStartDate:"2099-01-01",rhythmWeeks:2,horizonWeeks:1,targetSprintNumber:1});
 const [owner]=useState(()=>createPlanningState({userId:"story",initialWorkspace:"sprint",initialData:{...emptyPlanningShellState,sprints:[sprint]},adapter:{
  saveTask:async()=>({task:{}}),readWorkspace:async()=>{setReads(n=>n+1);return{data:{...emptyPlanningShellState,sprints:[{...sprint,updatedAt:"opaque/newer"}]}};},
  createSprintPlan:async(_input,basis)=>{setWrites(n=>n+1);if(success)return{sprints:[{...sprint,updatedAt:"opaque/created",startDate:"2099-01-01",endDate:"2099-01-14"}]};if(conflict){if(basis.sprints[0].updatedAt==="opaque/original")throw Object.assign(new Error("Parallel geändert"),{status:409,code:"sprint_plan_conflict"});return{sprints:[]};}throw new Error("Antwort verloren");}
 }}));
 useSyncExternalStore(owner.planning.subscribe,owner.internal.getSnapshot,owner.internal.getSnapshot);
 return <main className="p-4"><output aria-label="Plan writes">{writes}</output><output aria-label="Plan reads">{reads}</output><button onClick={()=>setOpen(value=>!value)}>Ansicht wechseln</button>{open&&<SprintPlanningSection planningState={owner.planning} pending={false} sprintPlanningOptions={draft} plannedSprintCount={1} onUpdateSprintPlanning={setDraft} />}</main>;
}
const meta={component:PlanStory,title:"Features/Sprint/PlanCreation"} satisfies Meta<typeof PlanStory>;
export default meta;
type Story=StoryObj<typeof meta>;
export const KeepsUnknownPlanAndChecksWithoutReplay:Story={play:async({canvasElement})=>{const canvas=within(canvasElement);await userEvent.click(canvas.getByRole("spinbutton",{name:"Rhythmus (Wochen)"}));await userEvent.click(canvas.getByRole("button",{name:"1 Änderung anwenden"}));await expect(await canvas.findByText("Sprint-Plan noch nicht bestätigt")).toBeVisible();await userEvent.click(canvas.getByRole("button",{name:"Ansicht wechseln"}));await userEvent.click(canvas.getByRole("button",{name:"Ansicht wechseln"}));await expect(canvas.getByRole("spinbutton",{name:"Rhythmus (Wochen)"})).toHaveValue(2);await userEvent.click(canvas.getByRole("button",{name:"Serverstand prüfen"}));await expect(canvas.getByLabelText("Plan writes")).toHaveTextContent("1");await expect(canvas.getByLabelText("Plan reads")).toHaveTextContent("1");}};
export const ComparesPlanBeforeConsciousRecreate:Story={args:{conflict:true},play:async({canvasElement})=>{const canvas=within(canvasElement);await userEvent.click(canvas.getByRole("spinbutton",{name:"Rhythmus (Wochen)"}));await userEvent.click(canvas.getByRole("button",{name:"1 Änderung anwenden"}));await expect(await canvas.findByText("Sprint-Plan wurde geändert oder geschützt")).toBeVisible();await expect(canvas.getByRole("button",{name:"Bewusst erneut planen"})).toBeDisabled();await userEvent.click(canvas.getByRole("button",{name:"Serverstand vergleichen"}));await expect(await canvas.findByText("Sprint 1: 2098-01-01 bis 2098-01-14")).toBeVisible();await userEvent.click(canvas.getByRole("button",{name:"Bewusst erneut planen"}));await expect(await canvas.findByText("0 Sprints bestätigt. Bestehende geschützte Sprints bleiben erhalten.")).toBeVisible();await expect(canvas.getByLabelText("Plan writes")).toHaveTextContent("2");}};
export const ConfirmsActualReturnedPlans:Story={args:{success:true},play:async({canvasElement})=>{const canvas=within(canvasElement);await userEvent.click(canvas.getByRole("button",{name:"1 Änderung anwenden"}));await expect(await canvas.findByText("1 Sprint bestätigt. Bestehende geschützte Sprints bleiben erhalten.")).toBeVisible();}};
