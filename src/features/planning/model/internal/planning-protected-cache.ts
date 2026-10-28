"use client";

import { createBrowserSessionAdapter } from "@/lib/credentials/browser";
import type { ServerSessionView } from "@/lib/credentials/session-types";
import type { AuthenticatedProfile, PlanningShellState, PlanningHeaderData } from "@/lib/types";
import type { AppWorkspace } from "../workspace-routes";

type ProtectedPlanningShellStateCache = {
  authUserId: string;
  workspace?: AppWorkspace;
  sessionRevision?: string;
  authorityExpiresAt?: number;
  data: PlanningShellState;
  headerData: PlanningHeaderData;
  currentProfile: AuthenticatedProfile | null;
};

const protectedPlanningShellStateCaches = new Map<AppWorkspace | undefined, ProtectedPlanningShellStateCache>();
let latestCacheScope: AppWorkspace | undefined;
// Reusing data never renews the original session deadline or transfers it to a refreshed credential.
createBrowserSessionAdapter().subscribe(session => {
  for (const [scope, cache] of protectedPlanningShellStateCaches) {
    if (!session || cache.authUserId !== session.userId || cache.sessionRevision !== session.revision) protectedPlanningShellStateCaches.delete(scope);
  }
});

export function getProtectedPlanningShellStateCache(workspace?: AppWorkspace, session?: ServerSessionView | null) {
  const cache = protectedPlanningShellStateCaches.get(workspace ?? latestCacheScope) || null;
  if (!cache) return null;
  if (cache.authorityExpiresAt !== undefined && cache.authorityExpiresAt * 1000 <= Date.now()) {
    protectedPlanningShellStateCaches.delete(workspace ?? latestCacheScope);
    return null;
  }
  if (session !== undefined && (!session || cache.authUserId !== session.userId || cache.sessionRevision !== session.revision || cache.authorityExpiresAt !== session.expiresAt || session.expiresAt * 1000 <= Date.now())) return null;
  return cache;
}

export function setProtectedPlanningShellStateCache(cache: ProtectedPlanningShellStateCache | null, workspace?: AppWorkspace) {
  if (!cache) { if (workspace) protectedPlanningShellStateCaches.delete(workspace); else protectedPlanningShellStateCaches.clear(); return; }
  latestCacheScope = cache.workspace;
  protectedPlanningShellStateCaches.set(cache.workspace, cache);
}

