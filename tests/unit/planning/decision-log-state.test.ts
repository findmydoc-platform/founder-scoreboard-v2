import { expect, test } from "vitest";
import { createPlanningState } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import type { NotionDecisionLogResult } from "@/lib/notion-decision-log";
const result: NotionDecisionLogResult = { ok: true, entries: [], fetchedAt: "2026-10-28" };
test("Decision Log owns complete-empty hydration, coalesces reads, withholds denied and late session results", async () => {
  let reads=0; let reject=false; let resolve!: (value:NotionDecisionLogResult)=>void;
  const owner=createPlanningState({userId:"account",initialData:emptyPlanningShellState,initialDecisionLogResult:result,adapter:{saveTask:async()=>({task:{}}),readWorkspace:async()=>null,readDecisionLog:async()=>{reads++;if(reject)throw Object.assign(new Error("Denied"),{status:403});return new Promise(yes=>{resolve=yes;});}}});
  expect(owner.planning.decisionLog()).toMatchObject({result,readStatus:"current",completeness:"complete"});
  const first=owner.planning.loadDecisionLog();const second=owner.planning.loadDecisionLog();expect(reads).toBe(1);resolve(result);await Promise.all([first,second]);
  reject=true;await owner.planning.loadDecisionLog();expect(owner.planning.decisionLog()).toMatchObject({result:null,readStatus:"forbidden",completeness:"none"});
  reject=false;const late=owner.planning.loadDecisionLog();owner.internal.endSession();resolve(result);await late;expect(owner.planning.decisionLog()).toMatchObject({result:null,readStatus:"not-loaded"});
});
test("Decision Log unavailable refresh retains only its confirmed snapshot without invented completeness",async()=>{
 const owner=createPlanningState({userId:"account",initialData:emptyPlanningShellState,initialDecisionLogResult:result,adapter:{saveTask:async()=>({task:{}}),readWorkspace:async()=>null,readDecisionLog:async()=>({ok:false,code:"notion_unavailable",message:"Unavailable",fetchedAt:"later"})}});
 await owner.planning.loadDecisionLog();expect(owner.planning.decisionLog()).toMatchObject({result,readStatus:"unavailable",completeness:"complete"});
});
