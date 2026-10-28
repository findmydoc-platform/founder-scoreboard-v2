import type { NotionDecisionLogResult } from "@/lib/notion-decision-log";
import type { PlanningDecisionLogView } from "../planning-decision-log";
export function createDecisionLogState(options: { initial?: NotionDecisionLogResult; active(): boolean; generation(): number; changed(): void; read?: () => Promise<NotionDecisionLogResult> }) {
  const empty: PlanningDecisionLogView = {result:null,readStatus:"not-loaded",completeness:"none"};
  let snapshot: PlanningDecisionLogView = { result: options.initial || null, readStatus: options.initial ? options.initial.ok ? "current" : "unavailable" : "not-loaded", completeness: options.initial?.ok ? "complete" : "none" };
  let pending: Promise<boolean> | undefined;
  let epoch = 0;
  function hydrate(result?: NotionDecisionLogResult) {
    if (!options.active() || !result) return;
    if (snapshot.readStatus !== "not-loaded") { if(snapshot.readStatus !== "forbidden") void load(); return; }
    snapshot = {result,readStatus:result.ok ? "current" : "unavailable",completeness:result.ok ? "complete" : "none"}; options.changed();
  }
  function load(): Promise<boolean> {
    if (!options.active() || !options.read) return Promise.resolve(false);
    if (pending) return pending;
    const generation = options.generation(), started = epoch;
    snapshot = {...snapshot,readStatus:snapshot.readStatus === "forbidden" ? "forbidden" : "loading"}; options.changed();
    pending = (async () => {
      try {
        const result = await options.read!();
        if (!options.active() || generation !== options.generation() || started !== epoch) return false;
        if (result.ok) snapshot = {result,readStatus:"current",completeness:"complete"};
        else snapshot = {...snapshot,result:snapshot.result?.ok ? snapshot.result : result,readStatus:"unavailable"};
        options.changed(); return result.ok;
      } catch (error) {
        if (!options.active() || generation !== options.generation() || started !== epoch) return false;
        snapshot = (error as {status?:number}).status === 403 || (error as {status?:number}).status === 401 ? {result:null,readStatus:"forbidden",completeness:"none"} : {...snapshot,readStatus:"unavailable"}; options.changed(); return false;
      } finally { if (started === epoch) pending = undefined; }
    })();
    return pending;
  }
  return {view:():PlanningDecisionLogView => options.active() ? snapshot : empty,load,hydrate,clear(){epoch++;pending=undefined;snapshot={result:null,readStatus:"not-loaded",completeness:"none"};}};
}
