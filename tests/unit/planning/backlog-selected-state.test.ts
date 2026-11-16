import { expect, test } from "vitest";
import { createPlanningState, type PlanningWorkspaceRead } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { normalizeBacklogSelection, type BacklogSelection, type BacklogSelectionQuery } from "@/features/backlog/model/backlog-selection";
import { DEFAULT_BACKLOG_FILTERS } from "@/features/backlog/model/backlog-view-model";
import { taskDetailStoryTask } from "@/features/tasks/molecules/task-detail-story-fixtures";
import type { Task } from "@/lib/types";

const actor = { id: "selected-backlog-reader", name: "Synthetic reader", platformRole: "founder" as const, orgRole: "Founder", githubLogin: "", weeklyCapacity: 40 };
const selected = taskDetailStoryTask({ id: "selected-backlog-child", title: "Selected child", parentTaskId: "selected-backlog-parent", updatedAt: "2026-11-01T12:00:00Z", note: "Existing canonical note", evidenceLinks: ["https://evidence.example.test/known"] });
const parent = taskDetailStoryTask({ id: "selected-backlog-parent", title: "Required context", taskType: "initiative", parentTaskId: "", updatedAt: "2026-11-01T12:00:00Z" });
const query = normalizeBacklogSelection({ view: "backlog", filters: { ...DEFAULT_BACKLOG_FILTERS, query: "selected" }, limit: 20 })!;
type SelectedRead = PlanningWorkspaceRead & { backlogSelection: BacklogSelection; readActor: { profileId: string; platformRole: typeof actor.platformRole } };
type SelectedPort = { loadBacklogSelection?(query: BacklogSelectionQuery, options?: { immediate?: boolean; signal?: AbortSignal }): Promise<boolean> };
function deferred<T>() { let resolve!: (value:T)=>void; const promise=new Promise<T>(done=>{resolve=done;});return{promise,resolve}; }
function response():SelectedRead {
  const deadline=Date.now()+60_000,omitted:(keyof Task)[]=["description","note","strategy","raciAssignments","evidenceLinks"];
  const row={...selected,detailAvailability:"summary" as const};omitted.forEach(field=>{delete row[field];});
  return {data:{...emptyPlanningShellState,tasks:[row,parent]},readAuthority:{userId:"selected-backlog-user",deadline},readActor:{profileId:actor.id,platformRole:actor.platformRole},
    coverage:{tasks:"partial",profiles:"partial",sprints:"partial",sprintCommitments:"partial"},taskCoverage:"partial",taskOmittedFields:omitted,
    backlogCoverage:{items:"partial",people:"partial",sprints:"partial",commitments:"partial",strategies:"partial",raci:"partial",links:"partial"},
    backlogSelection:{query,itemIds:[selected.id],contextIds:[parent.id],rankById:{[selected.id]:1008},total:1,coverage:"complete",continuation:null,
      sourceRevision:"selected-backlog-source",scopeRevision:"selected-backlog-scope",observedAt:new Date().toISOString(),validUntil:new Date(deadline).toISOString()}};
}

test("selected Backlog coalesces compatible reads and keeps scoped membership, context, rank and partial field evidence distinct",async()=>{
  const held=deferred<SelectedRead>(),reads:BacklogSelectionQuery[]=[];
  const adapter={saveTask:async()=>({task:selected}),readWorkspace:async()=>{throw new Error("Selected Backlog cannot fall back to a workspace read");},
    readBacklogSelection:async(scope:BacklogSelectionQuery)=>{reads.push(scope);return held.promise;}};
  const {planning,internal}=createPlanningState({userId:"selected-backlog-user",initialWorkspace:"planning",initialCurrentProfile:actor,
    initialSession:{userId:"selected-backlog-user",user:{id:"selected-backlog-user"},revision:"selected-backlog-session",expiresAt:(Date.now()+60_000)/1000},
    initialData:{...emptyPlanningShellState,tasks:[selected]},adapter});
  try {
    const port=planning as typeof planning & SelectedPort;
    const first=port.loadBacklogSelection?.(query,{immediate:true});
    const second=port.loadBacklogSelection?.(query,{immediate:true});
    expect(reads).toEqual([query]);
    held.resolve(response());expect(await first).toBe(true);expect(await second).toBe(true);
    expect(planning.backlog()).toMatchObject({readStatus:"current",model:{selection:{itemIds:[selected.id],contextIds:[parent.id],rankById:{[selected.id]:1008},total:1,coverage:"complete"},coverage:{items:"partial",people:"partial",sprints:"partial",commitments:"partial"}}});
    expect(planning.taskDetail(selected.id).task).toMatchObject({note:selected.note,evidenceLinks:selected.evidenceLinks});
    await port.loadBacklogSelection?.(query,{immediate:true});expect(reads).toHaveLength(1);
  }finally{internal.dispose();}
});
