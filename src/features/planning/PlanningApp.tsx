"use client";

import type { User } from "@supabase/supabase-js";
import { usePlanningAppController } from "@/features/planning/hooks/use-planning-app-controller";
import { PlanningAppShell } from "@/features/planning/templates/planning-app-shell";
import type { AppWorkspace } from "@/features/planning/model/workspace-routes";
import type { NotionDecisionLogResult } from "@/lib/notion-decision-log";
import type { AuthenticatedProfile, PlanningShellState, PlanningHeaderData } from "@/lib/types";
import type { BacklogModel } from "@/features/backlog/model/backlog-read-model";
import type { SprintWorkspaceModel } from "@/features/sprint/model/sprint-read-model";

type Props = {
  initialData: PlanningShellState;
  initialHeaderData: PlanningHeaderData;
  initialWorkspace: AppWorkspace;
  source: "supabase";
  authRequired: boolean;
  initialAuthUser?: User | null;
  initialCurrentProfile?: AuthenticatedProfile | null;
  initialProtectedDataLoaded?: boolean;
  initialAuthError?: string;
  initialDecisionLogResult?: NotionDecisionLogResult;
  initialBacklogModel?: BacklogModel;
  initialSprintModel?: SprintWorkspaceModel;
};

export function PlanningApp({
  initialData,
  initialHeaderData,
  initialWorkspace,
  source,
  authRequired,
  initialAuthUser = null,
  initialCurrentProfile = null,
  initialProtectedDataLoaded = false,
  initialAuthError = "",
  initialDecisionLogResult,
  initialBacklogModel,
  initialSprintModel,
}: Props) {
  const controller = usePlanningAppController({
    initialData,
    initialHeaderData,
    initialWorkspace,
    source,
    authRequired,
    initialAuthUser,
    initialCurrentProfile,
    initialProtectedDataLoaded,
    initialAuthError,
  });

  return <PlanningAppShell authRequired={authRequired} controller={controller} source={source} decisionLogResult={initialDecisionLogResult} initialBacklogModel={initialBacklogModel} initialSprintModel={initialSprintModel} />;
}
