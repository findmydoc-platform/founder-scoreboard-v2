"use client";

import type { User } from "@supabase/supabase-js";
import { usePlanningAppController } from "@/features/planning/hooks/use-planning-app-controller";
import { PlanningAppShell } from "@/features/planning/templates/planning-app-shell";
import type { AppWorkspace } from "@/features/planning/model/workspace-routes";
import type { AuthenticatedProfile, PlanningData } from "@/lib/types";

type Props = {
  initialData: PlanningData;
  initialWorkspace: AppWorkspace;
  source: "seed" | "supabase";
  authRequired: boolean;
  demoSeedImportAvailable?: boolean;
  initialAuthUser?: User | null;
  initialCurrentProfile?: AuthenticatedProfile | null;
  initialProtectedDataLoaded?: boolean;
  initialAuthError?: string;
  initialReviewTaskId?: string;
};

export function PlanningApp({
  initialData,
  initialWorkspace,
  source,
  authRequired,
  demoSeedImportAvailable = false,
  initialAuthUser = null,
  initialCurrentProfile = null,
  initialProtectedDataLoaded = false,
  initialAuthError = "",
  initialReviewTaskId = "",
}: Props) {
  const controller = usePlanningAppController({
    initialData,
    initialWorkspace,
    source,
    authRequired,
    demoSeedImportAvailable,
    initialAuthUser,
    initialCurrentProfile,
    initialProtectedDataLoaded,
    initialAuthError,
    initialReviewTaskId,
  });

  return <PlanningAppShell authRequired={authRequired} controller={controller} source={source} />;
}
