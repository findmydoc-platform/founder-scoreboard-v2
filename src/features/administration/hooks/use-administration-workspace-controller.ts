"use client";

import { useCallback, useEffect, useReducer, useState } from "react";
import type { AuthorityCapabilities } from "@/features/administrator-access/model/administrator-access";
import type { AdministrationWorkspaceModel } from "@/features/administration/model/administration-read-model";
import type { BrowserApiClient } from "@/lib/browser-api-client";

export function useAdministrationWorkspaceController({
  planningState,
  capabilities,
  onAdministratorAccessInvalid,
}: {
  apiClient: BrowserApiClient;
  planningState: import("@/features/planning/model/planning-state").PlanningState;
  capabilities: AuthorityCapabilities;
  initialModel?: AdministrationWorkspaceModel | null;
  onAdministratorAccessInvalid: () => void;
}) {
  const [, publish] = useReducer(value => value + 1, 0);
  useEffect(() => planningState.subscribe(publish), [planningState]);
  const model = planningState.administration().model;
  const [message, setMessage] = useState("");

  const load = useCallback(async () => {
    const loaded = await planningState.loadAdministration();
    const state = planningState.administration();
    if (!loaded) {
      if (state.readStatus === "forbidden") onAdministratorAccessInvalid();
      setMessage(state.readStatus === "forbidden" ? "Der Administrationszugang ist nicht mehr gültig." : "Administrationsdaten konnten nicht geladen werden.");
    } else setMessage("");
    return loaded ? state.model : null;
  }, [planningState, onAdministratorAccessInvalid]);

  useEffect(() => { window.queueMicrotask(() => void load()); }, [load]);

  return {
    busy: false,
    capabilities,
    load,
    message,
    model,
    planningState,
  };
}
