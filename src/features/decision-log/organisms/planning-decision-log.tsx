"use client";
import { useEffect, useSyncExternalStore } from "react";
import type { PlanningState } from "@/features/planning/model/planning-state";
import { DecisionLogOverview } from "./decision-log-overview";
export function PlanningDecisionLog({planningState}:{planningState:PlanningState}) {
  const view=useSyncExternalStore(planningState.subscribe,planningState.decisionLog,planningState.decisionLog);
  useEffect(()=>{if(view.readStatus === "not-loaded") void planningState.loadDecisionLog();},[planningState,view.readStatus]);
  return <div>{view.result ? <DecisionLogOverview result={view.result}/> : <p role="status">{view.readStatus === "forbidden" ? "Kein Zugriff auf das Decision Log." : view.readStatus === "loading" ? "Decision Log wird geladen." : view.readStatus === "unavailable" ? "Decision Log nicht verfügbar." : "Decision Log ist nicht geladen."}</p>}{view.readStatus === "unavailable" ? <p role="status">Decision Log konnte nicht aktualisiert werden.</p>:null}<button type="button" className="min-h-11 rounded border px-4" disabled={view.readStatus === "loading"} onClick={()=>{void planningState.loadDecisionLog();}}>Decision Log aktualisieren</button></div>;
}
