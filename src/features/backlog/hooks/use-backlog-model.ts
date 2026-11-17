"use client";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { PlanningState } from "@/features/planning/model/planning-state";
import { currentIsoDate } from "@/lib/planning-schedule";
import { normalizeBacklogSelection, type BacklogSelectionQuery, type BacklogOrphanSection } from "../model/backlog-selection";
import type { BacklogTableFilters } from "../model/backlog-view-model";

function useBacklogOrphanSection(planningState: PlanningState, section: BacklogOrphanSection, active: boolean, awaitingAdmission: boolean) {
  const query = useMemo(() => active ? normalizeBacklogSelection({ view: "backlog", section, filters: { level: "epic" }, limit: 20 }) : null, [active, section]);
  const lease = useRef<AbortController | null>(null);
  const [pageStatus, setPageStatus] = useState<"idle" | "loading" | "unavailable">("idle");
  const shared = planningState.backlog(), readStatus = shared.orphanReadStatus[section];
  const request = useCallback((append = false, refresh = false) => {
    if (!query) return;
    const current = planningState.backlog();
    if (!append && !refresh && current.orphanReadStatus[section] === "loading") return;
    const continuation = append ? current.model.orphanSelections?.[section]?.continuation : undefined;
    if (append && !continuation) return;
    lease.current?.abort(); const controller = new AbortController(); lease.current = controller;
    if (append) setPageStatus("loading");
    void planningState.loadBacklogSelection({ ...query, ...(continuation ? { continuation } : {}) }, { immediate: true, append, refresh, signal: controller.signal })
      .then(ok => { if (!controller.signal.aborted) setPageStatus(ok ? "idle" : "unavailable"); });
  }, [planningState, query, section]);
  useEffect(() => { request(); }, [request, awaitingAdmission]);
  useEffect(() => () => { lease.current?.abort(); }, [query]);
  useEffect(() => {
    if (!query || readStatus !== "stale") return;
    const timer = setTimeout(() => request(false, true), 500);
    return () => clearTimeout(timer);
  }, [query, readStatus, request]);
  return { readStatus, selection: shared.model.orphanSelections?.[section], progress: shared.model.controls?.orphanProgress?.[section], pageStatus,
    reload: () => request(false, true), loadMore: () => request(true) };
}

export function useBacklogModel(planningState: PlanningState, readMode: "legacy" | "selected", filters: BacklogTableFilters) {
  const shared = planningState.backlog(), previous = useRef<BacklogSelectionQuery | null>(null), legacyRequested = useRef(false);
  const scoped = readMode === "selected";
  const awaitingAdmission = shared.readStatus === "not-loaded";
  const orphanInitiatives = useBacklogOrphanSection(planningState, "orphanInitiatives", scoped && filters.level === "epic", awaitingAdmission);
  const orphanDeliverables = useBacklogOrphanSection(planningState, "orphanDeliverables", scoped && filters.level === "epic", awaitingAdmission);
  const query = useMemo(() => scoped ? normalizeBacklogSelection({ view: "backlog", filters, limit: 20 }) : null, [scoped, filters]);
  const pending = useRef<{ key: string; controller: AbortController; timer?: ReturnType<typeof setTimeout>; start(): void } | null>(null);
  const supportControllers = useRef(new Map<"controls" | "sprints", AbortController>());
  const day = currentIsoDate();
  const [pageRequest, setPageRequest] = useState<{ key: string; status: "loading" | "unavailable" | "idle" } | null>(null);
  const pageController = useRef<AbortController | null>(null);
  const queryKey = JSON.stringify(query);
  const pageStatus = pageRequest?.key === queryKey ? pageRequest.status : "idle";
  const loadMore = useCallback(() => {
    const selection = planningState.backlog().model.selection;
    if (!query || !selection?.continuation || pageController.current) return;
    const controller = new AbortController(); pageController.current = controller;
    setPageRequest({ key: JSON.stringify(query), status: "loading" });
    void planningState.loadBacklogSelection({ ...query, continuation: selection.continuation }, { immediate: true, append: true, signal: controller.signal })
      .then(ok => { if (!controller.signal.aborted) setPageRequest({ key: JSON.stringify(query), status: ok ? "idle" : "unavailable" }); })
      .finally(() => { if (pageController.current === controller) pageController.current = null; });
  }, [planningState, query]);
  useEffect(() => () => { pageController.current?.abort(); pageController.current = null; }, [queryKey]);
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
    if (scoped && filters.level === "deliverable" && (["not-loaded", "stale"].includes(shared.supportReadStatus.sprints) || shared.model.sprintBasis && shared.model.sprintBasis.day !== day)) loadSupport("sprints");
  }, [readMode, scoped, filters.level, shared.supportReadStatus.controls, shared.supportReadStatus.sprints, shared.model.sprintBasis, day, loadSupport, awaitingAdmission]);
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
  return { ...shared, scoped, orphanGroups: filters.level === "epic" && scoped ? { orphanInitiatives, orphanDeliverables } : undefined, commitSearch, loadMore, pageStatus, reload: () => { void planningState.refreshWorkspace("backlog"); }, loadSupport };
}
