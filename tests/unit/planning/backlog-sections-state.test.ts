import { expect, test } from "vitest";
import { createPlanningState, type PlanningWorkspaceRead } from "@/features/planning/model/internal/planning-state-owner";
import type { PlanningReadStatus } from "@/features/planning/model/planning-state";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { normalizeBacklogSelection, type BacklogSelection, type BacklogSelectionQuery, type BacklogOrphanSection } from "@/features/backlog/model/backlog-selection";
import { DEFAULT_BACKLOG_FILTERS } from "@/features/backlog/model/backlog-view-model";
import { taskDetailStoryTask } from "@/features/tasks/molecules/task-detail-story-fixtures";
import type { Task } from "@/lib/types";

const actor={id:"section-founder",name:"Synthetic founder",platformRole:"founder" as const,orgRole:"Founder",githubLogin:"",weeklyCapacity:40};
const primary=normalizeBacklogSelection({view:"backlog",filters:{...DEFAULT_BACKLOG_FILTERS,level:"epic",query:"Epic search"},limit:20})!;
const orphanInitiatives=normalizeBacklogSelection({...primary,section:"orphanInitiatives"})!;
const orphanDeliverables=normalizeBacklogSelection({...primary,section:"orphanDeliverables"})!;
type SectionView={readStatus:PlanningReadStatus;orphanReadStatus?:Partial<Record<BacklogOrphanSection,PlanningReadStatus>>;model:{selection?:BacklogSelection;orphanSelections?:Partial<Record<BacklogOrphanSection,BacklogSelection>>}};
function deferred<T>(){let resolve!:(value:T)=>void;const promise=new Promise<T>(done=>{resolve=done;});return{promise,resolve};}
function response(query:BacklogSelectionQuery,deadline:number):PlanningWorkspaceRead {
 const section=query.section||"level",type=section==="orphanInitiatives"?"initiative":section==="orphanDeliverables"?"deliverable":query.filters.level;
 const row=taskDetailStoryTask({id:`selected-${section}`,title:`Selected ${section}`,taskType:type,parentTaskId:"",status:query.section?"Erledigt":"Offen",updatedAt:"2026-11-01T12:00:00Z",detailAvailability:"summary"});
 const omitted:(keyof Task)[]=["description","note","strategy","raciAssignments","evidenceLinks","linkedPullRequests"];omitted.forEach(field=>{delete row[field];});
 return {data:{...emptyPlanningShellState,tasks:[row]},readAuthority:{userId:"section-user",deadline},readActor:{profileId:actor.id,platformRole:actor.platformRole},taskOmittedFields:omitted,taskCoverage:"partial",coverage:{tasks:"partial",profiles:"partial"},
  backlogCoverage:{items:"partial",people:"partial",sprints:"partial",commitments:"partial"},backlogSelection:{query,itemIds:[row.id],contextIds:[],rankById:{[row.id]:1},total:1,coverage:"complete",continuation:null,sourceRevision:"section-source",scopeRevision:`scope-${section}-${query.filters.query}`,observedAt:"2026-11-01T12:00:00Z",validUntil:new Date(deadline).toISOString()}};
}
function ownerFor(read:(query:BacklogSelectionQuery,options?:{signal?:AbortSignal})=>Promise<PlanningWorkspaceRead>,now=()=>Date.now()){
 return createPlanningState({userId:"section-user",initialWorkspace:"backlog",initialData:emptyPlanningShellState,initialCurrentProfile:actor,initialSession:{userId:"section-user",user:{id:"section-user"},revision:"section-session",expiresAt:(Date.now()+3_600_000)/1000},adapter:{now,saveTask:async()=>{throw new Error("No write");},readWorkspace:async()=>{throw new Error("No workspace fallback");},readBacklogSelection:read}});
}

test("Epic Backlog accepts independent section responses without replacing the primary membership or renewing another section deadline",async()=>{
 let now=Date.now();const initial=now,reads:BacklogSelectionQuery[]=[],signals:AbortSignal[]=[];
 const held=new Map([primary,orphanInitiatives,orphanDeliverables].map(query=>[query.section||"level",deferred<PlanningWorkspaceRead>()]));
 const owner=ownerFor(async(query,options)=>{reads.push(query);signals.push(options!.signal!);return held.get(query.section||"level")!.promise;},()=>now);
 try{
  const main=owner.planning.loadBacklogSelection(primary),initiatives=owner.planning.loadBacklogSelection(orphanInitiatives),deliverables=owner.planning.loadBacklogSelection(orphanDeliverables);
  expect(reads.map(query=>query.section||"level")).toEqual(["level","orphanInitiatives","orphanDeliverables"]);expect(signals.every(signal=>!signal.aborted)).toBe(true);
  held.get("orphanInitiatives")!.resolve(response(orphanInitiatives,initial+20_000));expect(await initiatives).toBe(true);
  const partial=owner.planning.backlog() as SectionView;expect(partial.model.selection).toBeUndefined();expect(partial.readStatus).toBe("loading");expect(partial.model.orphanSelections?.orphanInitiatives?.itemIds).toEqual(["selected-orphanInitiatives"]);
  held.get("orphanDeliverables")!.resolve(response(orphanDeliverables,initial+40_000));expect(await deliverables).toBe(true);
  held.get("level")!.resolve(response(primary,initial+60_000));expect(await main).toBe(true);
  expect((owner.planning.backlog() as SectionView).model.selection?.itemIds).toEqual(["selected-level"]);
  expect(owner.planning.backlog().model.items.map(row=>row.id).sort()).toEqual(["selected-level","selected-orphanDeliverables","selected-orphanInitiatives"]);
  now=initial+20_001;const expired=owner.planning.backlog() as SectionView;
  expect(expired.readStatus).toBe("current");expect(expired.model.selection?.itemIds).toEqual(["selected-level"]);expect(expired.model.orphanSelections?.orphanInitiatives).toBeUndefined();expect(expired.orphanReadStatus?.orphanInitiatives).toBe("stale");expect(expired.model.orphanSelections?.orphanDeliverables?.itemIds).toEqual(["selected-orphanDeliverables"]);
 }finally{for(const [section,pending]of held)pending.resolve(response(section==="level"?primary:section==="orphanInitiatives"?orphanInitiatives:orphanDeliverables,initial+60_000));owner.internal.dispose();}
});

test("Epic Backlog refreshes each visible section without promoting the last orphan or reusing an obsolete continuation",async()=>{
 const queries:BacklogSelectionQuery[]=[];
 const owner=ownerFor(async query=>{queries.push(query);const value=response(query,Date.now()+60_000);if(query.continuation)value.backlogSelection={...value.backlogSelection!,total:2,coverage:"partial",continuation:"later-cursor"};return value;});
 try{
  await owner.planning.loadBacklogSelection(primary);
  await owner.planning.loadBacklogSelection({...orphanInitiatives,continuation:"known-initiative-page"});
  await owner.planning.loadBacklogSelection({...orphanDeliverables,continuation:"known-deliverable-page"});
  await owner.planning.refreshWorkspace("backlog");
  expect(queries.slice(3)).toEqual([primary,orphanInitiatives,orphanDeliverables]);
  expect((owner.planning.backlog() as SectionView).model.selection?.query).toEqual(primary);
  await owner.planning.loadBacklogSelection(normalizeBacklogSelection({...primary,filters:{...primary.filters,query:"Another Epic search"}})!);
  expect(queries.slice(6).map(query=>query.section||"level")).toEqual(["level"]);
  const delivery=normalizeBacklogSelection({view:"backlog",filters:DEFAULT_BACKLOG_FILTERS,limit:20})!;
  await owner.planning.loadBacklogSelection(delivery);const count=queries.length;
  await owner.planning.refreshWorkspace("backlog");expect(queries.slice(count)).toEqual([delivery]);
 }finally{owner.internal.dispose();}
});
