import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState, useSyncExternalStore } from "react";
import { expect, userEvent, within } from "storybook/test";
import { createPlanningState } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { SprintFounderScoreTable } from "../organisms/sprint-founder-score-table";
import { buildSprintScoreViewModel } from "../model/sprint-score-view-model";
import { SprintCommitmentField } from "./sprint-commitment-field";
const commitment = { id: 1, sprintId: "sprint", profileId: "founder", commitmentLevel: "Standard" as const, weeklyHours: 20, note: "", updatedAt: "opaque/shown" };
function Fixture({ conflict = false, succeeds = false }: { conflict?: boolean; succeeds?: boolean }) {
  const [writes, setWrites] = useState(0), [reads, setReads] = useState(0), [show, setShow] = useState(true);
  const [owner] = useState(() => createPlanningState({ userId: "story", initialWorkspace: "sprint", initialData: { ...emptyPlanningShellState, sprintCommitments: [commitment] }, adapter: { saveTask: async () => ({ task: {} }), readWorkspace: async () => { setReads(n => n + 1); return { data: { ...emptyPlanningShellState, sprintCommitments: [{ ...commitment, weeklyHours: 16, updatedAt: "opaque/server" }] }, coverage: { sprintCommitments: "complete" } }; }, saveSprintCommitment: async (basis, patch) => { setWrites(n => n + 1); if (conflict && basis.updatedAt === "opaque/shown") throw Object.assign(new Error("Parallel geändert"), { status: 409, code: "commitment_revision_conflict" }); if (!conflict && !succeeds) throw new Error("Antwort verloren"); return { commitment: { ...basis, ...patch, updatedAt: "opaque/saved" } }; } } }));
  const data = useSyncExternalStore(owner.planning.subscribe, owner.internal.getSnapshot, owner.internal.getSnapshot);
  return <main className="p-4"><output aria-label="Commitment writes">{writes}</output><output aria-label="Commitment reads">{reads}</output><button onClick={() => setShow(value => !value)}>Ansicht wechseln</button><button onClick={() => { void owner.planning.refreshWorkspace("sprint"); }}>Aktualisieren</button>{show && <SprintCommitmentField planningState={owner.planning} shown={data.sprintCommitments[0]} field="hours" />}</main>;
}
const meta = { title: "Features/Sprint/Commitment", component: Fixture } satisfies Meta<typeof Fixture>; export default meta; type Story = StoryObj<typeof meta>;
export const RetainsUnknownAcrossNavigationWithoutReplay: Story = {  
play: async ({ canvasElement }) => {
    const canvas = within(canvasElement); await userEvent.clear(canvas.getByRole("spinbutton")); await userEvent.type(canvas.getByRole("spinbutton"), "24"); await userEvent.tab(); await expect(await canvas.findByText("Commitment noch nicht bestätigt")).toBeVisible(); await userEvent.click(canvas.getByRole("button", { name: "Ansicht wechseln" })); await userEvent.click(canvas.getByRole("button", { name: "Ansicht wechseln" })); await expect(canvas.getByRole("spinbutton")).toBeDisabled(); await userEvent.click(canvas.getByRole("button", { name: "Serverstand prüfen" })); await expect(canvas.getByLabelText("Commitment writes")).toHaveTextContent("1"); await expect(canvas.getByLabelText("Commitment reads")).toHaveTextContent("1");
  }
};

export const ComparesBeforeConsciousResave: Story = {  
args: { conflict: true }, play: async ({ canvasElement }) => {
    const canvas = within(canvasElement); await userEvent.clear(canvas.getByRole("spinbutton")); await userEvent.type(canvas.getByRole("spinbutton"), "24"); await userEvent.tab();
    await expect(await canvas.findByText("Commitment wurde zwischenzeitlich geändert")).toBeVisible(); await expect(canvas.getByRole("spinbutton")).toHaveValue(24); await expect(canvas.getByRole("button", { name: "Bewusst erneut speichern" })).toBeDisabled();
    await userEvent.click(canvas.getByRole("button", { name: "Serverstand vergleichen" })); await expect(await canvas.findByText("Server: Standard, 16 Stunden")).toBeVisible(); await userEvent.click(canvas.getByRole("button", { name: "Bewusst erneut speichern" })); await expect(canvas.getByLabelText("Commitment writes")).toHaveTextContent("2"); await expect(canvas.getByRole("spinbutton")).toHaveValue(24);
  }
};

export const DisplaysLaterConfirmedReadAfterSave:Story={args:{succeeds:true},play:async({canvasElement})=>{const canvas=within(canvasElement);await userEvent.clear(canvas.getByRole("spinbutton"));await userEvent.type(canvas.getByRole("spinbutton"),"24");await userEvent.tab();await expect(canvas.getByLabelText("Commitment writes")).toHaveTextContent("1");await userEvent.click(canvas.getByRole("button",{name:"Aktualisieren"}));await expect(canvas.getByRole("spinbutton")).toHaveValue(16);}};

function IncompleteTableFixture(){const sprint={id:"sprint",name:"Sprint",status:"active" as const,startDate:"2026-10-01",endDate:"2026-10-14",reviewDueAt:"",scoreLocked:false,updatedAt:"opaque/sprint"};const data={...emptyPlanningShellState,sprints:[sprint],sprintCommitments:[commitment],profiles:[{id:"founder",name:"Synthetic Founder",platformRole:"founder" as const,orgRole:"",githubLogin:"",weeklyCapacity:20}]};const [owner]=useState(()=>createPlanningState({userId:"story",initialData:data,adapter:{saveTask:async()=>({task:{}}),readWorkspace:async()=>({data})}}));const view=buildSprintScoreViewModel({data,selectedSprintId:"sprint",coverage:{items:"complete",commitments:"partial",meetings:"complete",attendance:"complete"}});return <SprintFounderScoreTable sprint={sprint} scoreRows={view.scoreRows} pending={false} planningState={owner.planning}/>;}
export const WithholdsTotalsFromIncompleteCommitments:Story={render:()=> <IncompleteTableFixture/>,play:async({canvasElement})=>{const canvas=within(canvasElement);await expect(canvas.getAllByText("Berechnung unvollständig").find(element=>element.checkVisibility())).toBeVisible();await expect(canvas.queryByText(/\d+\/20/)).not.toBeInTheDocument();}};
