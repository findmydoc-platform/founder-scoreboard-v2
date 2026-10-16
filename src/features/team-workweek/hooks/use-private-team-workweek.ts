"use client";

import { useMemo } from "react";
import type { BrowserApiClient } from "@/lib/browser-api-client";
import { TEAM_WORKWEEK_PUBLISHED_EVENT } from "./use-published-team-workweeks";
import { usePrivateTeamWorkweekState, type WorkweekTransport } from "../model/private-team-workweek-state";

/** Keeps browser HTTP details outside the editor's state and recovery policies. */
export function usePrivateTeamWorkweek(apiClient: BrowserApiClient, initialWeek?: string) {
  const transport = useMemo<WorkweekTransport>(() => ({
    published: () => window.dispatchEvent(new Event(TEAM_WORKWEEK_PUBLISHED_EVENT)),
    request(operation, input) {
      const routes = {
        load: "private-draft", save: "private-draft", loadConflict: "conflict",
        resolveConflict: "conflict", publish: "publish", restart: "restart", reconcile: "reconcile",
      };
      const read = operation === "load" || operation === "loadConflict";
      const query = operation === "load" && input?.week ? `?week=${input.week}` : "";
      return apiClient.requestJson(`/api/team-workweek/${routes[operation]}${query}`, {
        ...(read ? { cache: "no-store" as const } : { method: "POST", json: input?.json }),
        useDevProfileOverride: false,
      });
    },
  }), [apiClient]);
  return usePrivateTeamWorkweekState(transport, initialWeek);
}
