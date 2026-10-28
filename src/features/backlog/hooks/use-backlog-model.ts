"use client";
import { useCallback, useEffect, useRef, useState } from "react";
import type { BacklogAction, BacklogModel } from "../model/backlog-read-model";
import type { PlanningState } from "@/features/planning/model/planning-state";
export function useBacklogModel(planningState: PlanningState, initialModel: BacklogModel) {
  const [orderPreview, setOrderPreview] = useState<Record<string, { order: number; basis?: string }>>({});
  const requested = useRef(false);
  const shared = planningState.backlog();
  const refreshBacklogModel = useCallback(async () => { if (!(await planningState.refreshWorkspace("backlog"))) throw new Error("Backlog konnte nicht neu geladen werden."); }, [planningState]);
  useEffect(() => {
    if (!requested.current && shared.readStatus !== "loading") { requested.current = true; if (!shared.model.coverage?.items) void refreshBacklogModel().catch(() => {}); }
  }, [refreshBacklogModel, shared.readStatus, shared.model.coverage?.items]);
  // Temporary order-only presentation bridge until the named ordering migration (#553).
  const dispatch = useCallback((action: BacklogAction) => {
    if (action.type !== "itemsPatched") return;
    if (action.patches.some(patch => patch.updatedAt)) { void refreshBacklogModel().finally(() => setOrderPreview({})).catch(() => {}); return; }
    setOrderPreview(current => ({ ...current, ...Object.fromEntries(action.patches.filter(patch => typeof patch.order === "number").map(patch => [patch.id, { order: patch.order!, basis: planningState.backlog().model.items.find(task => task.id === patch.id)?.updatedAt }])) }));
  }, [planningState, refreshBacklogModel]);
  const model: BacklogModel = { ...shared.model, revision: shared.model.revision || initialModel.revision, items: shared.model.items.map(task => orderPreview[task.id]?.basis === task.updatedAt ? { ...task, order: orderPreview[task.id].order } : task) };
  return { dispatch, model, refreshBacklogModel };
}
