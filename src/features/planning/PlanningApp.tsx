"use client";

import type { User } from "@supabase/supabase-js";
import { usePlanningAppController } from "@/features/planning/hooks/use-planning-app-controller";
import { PlanningAppShell } from "@/features/planning/templates/planning-app-shell";
import type { AppWorkspace } from "@/features/planning/model/workspace-routes";
import type { NotionDecisionLogResult } from "@/lib/notion-decision-log";
import type { AuthenticatedProfile, PlanningData, PlanningHeaderData } from "@/lib/types";

type Props = {
  initialData: PlanningData;
  initialHeaderData: PlanningHeaderData;
  initialWorkspace: AppWorkspace;
  source: "seed" | "supabase";
  authRequired: boolean;
  demoSeedImportAvailable?: boolean;
  initialAuthUser?: User | null;
  initialCurrentProfile?: AuthenticatedProfile | null;
  initialProtectedDataLoaded?: boolean;
  initialAuthError?: string;
  initialDecisionLogResult?: NotionDecisionLogResult;
};

export function PlanningApp({
  initialData,
  initialHeaderData,
  initialWorkspace,
  source,
  authRequired,
  demoSeedImportAvailable = false,
  initialAuthUser = null,
  initialCurrentProfile = null,
  initialProtectedDataLoaded = false,
  initialAuthError = "",
  initialDecisionLogResult,
}: Props) {
  const controller = usePlanningAppController({
    initialData,
    initialHeaderData,
    initialWorkspace,
    source,
    authRequired,
    demoSeedImportAvailable,
    initialAuthUser,
    initialCurrentProfile,
    initialProtectedDataLoaded,
    initialAuthError,
  });

  return <PlanningAppShell authRequired={authRequired} controller={controller} source={source} decisionLogResult={initialDecisionLogResult} />;
}
