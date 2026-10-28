"use client";

import { sessionAuthority } from "@/features/administrator-access/model/administrator-access";

import { useContext, useEffect, useMemo, useRef, useState, useSyncExternalStore } from "react";
import type { BrowserApiClient } from "@/lib/browser-api-client";
import type { AuthenticatedProfile } from "@/lib/types";
import type { AppWorkspace } from "../model/workspace-routes";
import { createBrowserPlanningLifetime } from "../model/internal/browser-planning-lifetime";
import { PlanningStateLifetimeContext } from "../model/internal/planning-state-lifetime-context";
import type { BrowserPlanningState, PlanningPageState } from "../model/internal/browser-planning-state";

export function usePlanningStateOwner(options: PlanningPageState) {
  const shared = useContext(PlanningStateLifetimeContext);
  const [local] = useState(() => shared || createBrowserPlanningLifetime());
  const lifetime = shared || local;
  const [initialPage] = useState(options);
  const hydratedBundle = useRef<BrowserPlanningState | null>(null);
  const [emptyBundle] = useState(() => lifetime.empty(initialPage));
  const currentBundle = () => lifetime.page(initialPage) || emptyBundle;
  const bundle = useSyncExternalStore(lifetime.subscribe, currentBundle, currentBundle);
  const data = useSyncExternalStore(bundle.owner.planning.subscribe, bundle.owner.internal.getSnapshot, bundle.owner.internal.getSnapshot);
  useEffect(() => { if (!shared) return lifetime.connect(); }, [lifetime, shared]);
  useEffect(() => {
    if (hydratedBundle.current === bundle) return;
    hydratedBundle.current = bundle;
    if (bundle.initialPage !== initialPage) {
      bundle.acceptProtectedData(initialPage.initialData, initialPage.initialUserId, initialPage.initialWorkspace);
      bundle.acceptHeaderHydration(initialPage.initialHeaderData);
    }
  }, [bundle, initialPage]);
  return useMemo(() => ({
    data,
    planningState: bundle.owner.planning,
    setData: bundle.owner.internal.applyLegacyProjection,
    acceptProtectedData: bundle.acceptProtectedData,
    clearPlanningState: bundle.owner.internal.suspendProtected,
    legacyApiClient: bundle.legacyApiClient,
    configure: (apiClient: BrowserApiClient, workspace: AppWorkspace, currentProfile: AuthenticatedProfile | null, administratorAccess?: import("@/features/administrator-access/model/administrator-access").AdministratorAccessSnapshot) => {
      Object.assign(bundle.runtime, { apiClient, workspace, currentProfile });
      if (administratorAccess) bundle.owner.internal.bindAdministrationAuthority(sessionAuthority({ platformRole: currentProfile?.platformRole || "viewer", credentialKind: "session", administratorAccess }));
    },
  }), [bundle, data]);
}
