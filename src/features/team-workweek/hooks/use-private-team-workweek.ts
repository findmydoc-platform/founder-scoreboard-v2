"use client";

import type { PlanningState } from "@/features/planning/model/planning-state";
import { useMemo } from "react";
import type { BrowserApiClient } from "@/lib/browser-api-client";
import { TEAM_WORKWEEK_PUBLISHED_EVENT } from "../model/published-workweek-events";
import { usePrivateTeamWorkweekState, type WorkweekTransport } from "../model/private-team-workweek-state";

/** Keeps browser HTTP details outside the editor's state and recovery policies. */
export function usePrivateTeamWorkweek(apiClient: BrowserApiClient, planningState: PlanningState, initialWeek?: string) {
  const transport = useMemo<WorkweekTransport>(() => ({
    published: () => window.dispatchEvent(new Event(TEAM_WORKWEEK_PUBLISHED_EVENT)),
    async request(operation, input) {
      if (operation === "load" || operation === "save" || operation === "publish" || operation === "reconcile") {
        const result = operation === "load" ? await planningState.loadPrivateWorkweek(input?.week)
          : operation === "save" ? await planningState.savePrivateWorkweek(input?.json as import("../model/private-workweek-planning-state").PrivateWorkweekSaveInput)
          : operation === "publish" ? await planningState.publishPrivateWorkweek((input?.json as { versionId: string }).versionId)
          : await planningState.reconcileWorkweek();
        return { response: new Response(null, { status: result.status || 503 }), body: result.value } as import("@/lib/browser-api-client").BrowserApiJsonResult<never>;
      }
      const routes = {
        loadConflict: "conflict",
        resolveConflict: "conflict", restart: "restart",
      };
      const read = operation === "loadConflict";
      return apiClient.requestJson(`/api/team-workweek/${routes[operation]}`, {
        ...(read ? { cache: "no-store" as const } : { method: "POST", json: input?.json }),
        useDevProfileOverride: false,
      });
    },
  }), [apiClient, planningState]);
  return usePrivateTeamWorkweekState(transport, planningState, initialWeek);
}
