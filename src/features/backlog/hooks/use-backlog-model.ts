"use client";

import { useCallback, useEffect, useReducer } from "react";
import { requestBacklogModel } from "@/features/backlog/model/backlog-api-client";
import { backlogModelReducer, type BacklogModel } from "@/features/backlog/model/backlog-read-model";
import type { BrowserApiClient } from "@/lib/browser-api-client";

export function useBacklogModel(apiClient: BrowserApiClient, initialModel: BacklogModel) {
  const [model, dispatch] = useReducer(backlogModelReducer, initialModel);

  useEffect(() => {
    dispatch({ type: "modelLoaded", model: initialModel });
  }, [initialModel]);

  const refreshBacklogModel = useCallback(async () => {
    const { response, body } = await requestBacklogModel(apiClient);
    if (!response.ok || !body?.model) throw new Error(body?.error || "Backlog konnte nicht neu geladen werden.");
    dispatch({ type: "modelLoaded", model: body.model });
  }, [apiClient]);

  return { dispatch, model, refreshBacklogModel };
}
