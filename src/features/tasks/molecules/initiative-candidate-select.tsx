"use client";

import { useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { PlanningState } from "@/features/planning/model/planning-state";
import { normalizeInitiativeCandidateQuery } from "@/features/planning-items/model/planning-item-candidates";
import { CustomSelect } from "@/shared/atoms/custom-select";

function selectedContextSnapshot(owner: PlanningState, id: string) {
  const context = owner.taskDetail(id), task = context.task;
  return JSON.stringify([context.readStatus, context.removed, task?.id, task?.title, task?.taskType, task?.updatedAt, task?.detailAvailability]);
}

export function InitiativeCandidateSelect({ owner, value, selectedContext, onChange }: {
  owner: PlanningState; value: string; selectedContext?: { id: string; title: string }; onChange: (id: string) => void;
}) {
  const [open, setOpen] = useState(false), [search, setSearch] = useState("");
  const normalizedSearch = normalizeInitiativeCandidateQuery({ view: "candidates", kind: "initiative", query: search, limit: 20 })!.query;
  const query = useMemo(() => ({ view: "candidates" as const, kind: "initiative" as const, query: normalizedSearch, limit: 20 }), [normalizedSearch]);
  const demand = useRef<AbortController | null>(null);
  const contextDemand = useRef<AbortController | null>(null);
  const view = useSyncExternalStore(owner.subscribe, () => owner.candidates(query), () => owner.candidates(query));
  useSyncExternalStore(owner.subscribe, () => selectedContextSnapshot(owner, value), () => selectedContextSnapshot(owner, value));
  useEffect(() => {
    if (!value) return;
    const controller = new AbortController(); contextDemand.current = controller;
    const context = owner.taskDetail(value);
    const known = owner.candidate(value) || context.task?.taskType === "initiative" && context.task.detailAvailability !== "stale" && !context.removed;
    // Selection identity owns this lease. Its response must not release or
    // restart the request merely because the label becomes available.
    if (!known && !context.removed && context.readStatus !== "forbidden") void owner.loadTaskDetail(value, { area: "target", signal: controller.signal });
    return () => { controller.abort(); if (contextDemand.current === controller) contextDemand.current = null; };
  }, [owner, value]);
  useEffect(() => {
    if (!open) return;
    const controller = new AbortController(); demand.current = controller;
    void owner.loadCandidates(query, { signal: controller.signal });
    return () => { controller.abort(); if (demand.current === controller) demand.current = null; };
  }, [owner, open, query]);
  const context = owner.taskDetail(value);
  const contextBlocked = context.removed || context.readStatus === "forbidden";
  const contextualTask = !contextBlocked && context.task?.taskType === "initiative" && context.task.detailAvailability !== "stale" ? context.task : null;
  const selected = owner.candidate(value) || (!contextBlocked ? view.items.find(item => item.id === value) || contextualTask : null);
  const contextUnavailable = Boolean(value && !selected && (context.removed || ["unavailable", "stale", "forbidden"].includes(context.readStatus)));
  const retryContext = () => {
    if (contextDemand.current) void owner.loadTaskDetail(value, { area: "target", signal: contextDemand.current.signal });
  };
  const submit = (refresh = false) => {
    if (demand.current) void owner.loadCandidates(query, { immediate: true, refresh, signal: demand.current.signal });
  };
  const loadFurther = () => {
    if (demand.current && view.continuation) void owner.loadCandidates({ ...query, continuation: view.continuation }, { immediate: true, signal: demand.current.signal });
  };
  return <div className="grid gap-1"><span className="text-xs font-semibold text-slate-600">Initiative</span><CustomSelect value={value} aria-label="Initiative" onChange={onChange} onOpenChange={setOpen}
    selectedOptionLabel={selected?.title || (contextBlocked ? "Auswahl nicht verfügbar" : selectedContext?.id === value ? selectedContext.title : undefined)}
    options={[{ value: "", label: "Ohne Initiative – als Vorschlag" }, ...(view.readStatus === "current" ? view.items.map(item => ({ value: item.id, label: item.title })) : [])]}
    search={{ label: "Initiative suchen", value: search, onChange: value => setSearch(value.slice(0, 2048)), onSubmit: () => submit() }}
    feedback={<div className="px-2 py-2 text-xs text-slate-600">
      {view.readStatus === "loading" || view.readStatus === "not-loaded" ? <p role="status">Initiativen werden geladen.</p>
        : view.readStatus === "current" && view.total === 0 && view.coverage === "complete" ? <p role="status">Keine Initiativen gefunden.</p>
          : view.readStatus === "current" && view.coverage === "partial" ? <>
            <p role="status">{view.furtherReadStatus === "loading" ? "Weitere Initiativen werden geladen." : view.furtherReadStatus === "unavailable" ? "Weitere Initiativen konnten nicht geladen werden." : "Weitere Initiativen sind noch nicht geladen."}</p>
            <button type="button" disabled={view.furtherReadStatus === "loading"} onClick={loadFurther} className="min-h-11 px-2 font-semibold text-blue-700">
              {view.furtherReadStatus === "unavailable" ? "Weitere Initiativen erneut laden" : "Weitere Initiativen laden"}
            </button>
          </>
          : view.readStatus !== "current" ? <><p role="status">Initiativen sind derzeit nicht aktuell verfügbar.</p><button type="button" onClick={() => submit(true)} className="min-h-11 px-2 font-semibold text-blue-700">Erneut laden</button></> : null}
    </div>} className="h-11" />
    {value && !selected && !selectedContext && context.readStatus === "loading" ? <p role="status" className="text-xs text-slate-600">Ausgewählte Initiative wird geladen.</p> : null}
    {contextUnavailable ? <div className="text-xs text-slate-600">
      <p role="status">{context.readStatus === "forbidden" ? "Ausgewählte Initiative darf nicht angezeigt werden." : context.removed ? "Ausgewählte Initiative ist nicht verfügbar." : "Ausgewählte Initiative konnte nicht geladen werden."}</p>
      <button type="button" onClick={retryContext} className="min-h-11 px-2 font-semibold text-blue-700">Ausgewählte Initiative erneut laden</button>
    </div> : null}
  </div>;
}
