"use client";

import type { PlanningState } from "@/features/planning/model/planning-state";
import { useMemo } from "react";
import type { BrowserApiClient } from "@/lib/browser-api-client";
import { usePrivateTeamWorkweekState, type WorkweekTransport } from "../model/private-team-workweek-state";

/** Keeps browser HTTP details outside the editor's state and recovery policies. */
export function usePrivateTeamWorkweek(apiClient: BrowserApiClient, planningState: PlanningState, initialWeek?: string) {
  const transport = useMemo<WorkweekTransport>(() => ({
    async request(operation, input) {
      if (operation === "load" || operation === "save" || operation === "publish" || operation === "reconcile" || operation === "loadConflict") {
        const result = operation === "load" ? await planningState.loadPrivateWorkweek(input?.week)
          : operation === "save" ? await planningState.savePrivateWorkweek(input?.json as import("../model/private-workweek-planning-state").PrivateWorkweekSaveInput)
          : operation === "publish" ? await planningState.publishPrivateWorkweek((input?.json as { versionId: string }).versionId)
          : operation === "reconcile" ? await planningState.reconcileWorkweek()
          : await planningState.loadWorkweekConflict();
        return { response: new Response(null, { status: result.status || 503 }), body: result.value } as import("@/lib/browser-api-client").BrowserApiJsonResult<never>;
      }
      return apiClient.requestJson("/api/team-workweek/restart", {
        method: "POST", json: input?.json,
        useDevProfileOverride: false,
      });
    },
  }), [apiClient, planningState]);
  return usePrivateTeamWorkweekState(transport, planningState, initialWeek);
}
