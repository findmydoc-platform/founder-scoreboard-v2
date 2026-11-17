"use client";
import { useCallback, useEffect, useMemo, useRef } from "react";
import type { PlanningState } from "@/features/planning/model/planning-state";
import { currentIsoDate } from "@/lib/planning-schedule";
import { normalizeBacklogSelection, type BacklogSelectionQuery } from "../model/backlog-selection";
import type { BacklogTableFilters } from "../model/backlog-view-model";

export function useBacklogModel(planningState: PlanningState, readMode: "legacy" | "selected", filters: BacklogTableFilters) {
  const shared = planningState.backlog(), previous = useRef<BacklogSelectionQuery | null>(null), legacyRequested = useRef(false);
  const scoped = readMode === "selected" && filters.level === "deliverable";
  const awaitingAdmission = shared.readStatus === "not-loaded";
  const query = useMemo(() => scoped ? normalizeBacklogSelection({ view: "backlog", filters, limit: 20 }) : null, [scoped, filters]);
  const pending = useRef<{ key: string; controller: AbortController; timer?: ReturnType<typeof setTimeout>; start(): void } | null>(null);
  const supportControllers = useRef(new Map<"controls" | "sprints", AbortController>());
  const day = currentIsoDate();
  const request = useCallback((next: BacklogSelectionQuery, delayed: boolean) => {
    const key = JSON.stringify(next), existing = pending.current;
    if (existing?.key === key && !existing.controller.signal.aborted && ["current", "loading"].includes(planningState.backlog().readStatus)) { if (!delayed && existing.timer) { clearTimeout(existing.timer); existing.timer = undefined; existing.start(); } return; }
    if (existing) { clearTimeout(existing.timer); existing.controller.abort(); }
    const controller = new AbortController();
    const entry = { key, controller, timer: undefined as ReturnType<typeof setTimeout> | undefined, start: () => { void planningState.loadBacklogSelection(next, { immediate: true, signal: controller.signal }); } };
    pending.current = entry;
    if (delayed) entry.timer = setTimeout(() => { entry.timer = undefined; entry.start(); }, 250); else entry.start();
  }, [planningState]);
  useEffect(() => {
    if (query) {
      const old = previous.current;
      const typing = Boolean(old && old.filters.query !== query.filters.query && JSON.stringify({ ...old.filters, query: "" }) === JSON.stringify({ ...query.filters, query: "" }));
      previous.current = query; legacyRequested.current = false; request(query, typing);
    } else {
      const changed = Boolean(previous.current); previous.current = null;
      pending.current?.controller.abort(); clearTimeout(pending.current?.timer); pending.current = null;
      if (!legacyRequested.current || awaitingAdmission) { legacyRequested.current = true; if (changed || !shared.model.coverage?.items) void planningState.loadLegacyBacklog(); }
    }
  }, [planningState, query, request, shared.model.coverage?.items, awaitingAdmission]);
  const loadSupport = useCallback((area: "controls" | "sprints") => {
    if (planningState.backlog().supportReadStatus[area] === "loading") return;
    supportControllers.current.get(area)?.abort();
    const controller = new AbortController(); supportControllers.current.set(area, controller);
    void planningState.loadBacklogSupport({ view: "backlog-support", area, day }, { signal: controller.signal });
  }, [planningState, day]);
  useEffect(() => {
    if (readMode !== "selected") return;
    if (["not-loaded", "stale"].includes(shared.supportReadStatus.controls)) loadSupport("controls");
    if (scoped && (["not-loaded", "stale"].includes(shared.supportReadStatus.sprints) || shared.model.sprintBasis && shared.model.sprintBasis.day !== day)) loadSupport("sprints");
  }, [readMode, scoped, shared.supportReadStatus.controls, shared.supportReadStatus.sprints, shared.model.sprintBasis, day, loadSupport, awaitingAdmission]);
  useEffect(() => {
    const controllers = supportControllers.current;
    return () => { pending.current?.controller.abort(); clearTimeout(pending.current?.timer); for (const controller of controllers.values()) controller.abort(); };
  }, [planningState]);
  useEffect(() => {
    if (!query || shared.readStatus !== "stale") return;
    const timer = setTimeout(() => { void planningState.refreshWorkspace("backlog"); }, 500);
    return () => clearTimeout(timer);
  }, [planningState, query, shared.readStatus]);
  const commitSearch = useCallback((value: string) => {
    if (!query) return;
    const next = normalizeBacklogSelection({ ...query, filters: { ...query.filters, query: value } });
    if (next) request(next, false);
  }, [query, request]);
  return { ...shared, scoped, commitSearch, reload: () => { void planningState.refreshWorkspace("backlog"); }, loadSupport };
}
