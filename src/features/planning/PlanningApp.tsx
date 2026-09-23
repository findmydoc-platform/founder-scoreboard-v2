"use client";

import type { User } from "@supabase/supabase-js";
import { usePlanningAppController } from "@/features/planning/hooks/use-planning-app-controller";
import { PlanningAppShell } from "@/features/planning/templates/planning-app-shell";
import type { AppWorkspace } from "@/features/planning/model/workspace-routes";
import type { NotionDecisionLogResult } from "@/lib/notion-decision-log";
import type { AuthenticatedProfile, PlanningShellState, PlanningHeaderData } from "@/lib/types";
import type { BacklogModel } from "@/features/backlog/model/backlog-read-model";
import type { SprintWorkspaceModel } from "@/features/sprint/model/sprint-read-model";
import type { AdministrationWorkspaceModel } from "@/features/administration/model/administration-read-model";
import type { AdministratorAccessSnapshot } from "@/features/administrator-access/model/administrator-access";
import { useCallback, useMemo } from "react";
import { useAdministratorAccessController } from "@/features/administrator-access/hooks/use-administrator-access-controller";
import { createBrowserApiClient } from "@/lib/browser-api-client";

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
  initialAdministrationModel?: AdministrationWorkspaceModel | null;
  initialAdministratorAccess?: AdministratorAccessSnapshot;
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
  initialAdministrationModel = null,
  initialAdministratorAccess,
}: Props) {
  const apiClient = useMemo(() => createBrowserApiClient(), []);
  const administratorAccessController = useAdministratorAccessController({
    apiClient,
    initialAccess: initialAdministratorAccess,
    platformRole: initialCurrentProfile?.platformRole || null,
  });
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
    operationalCorrection: administratorAccessController.authority.capabilities.operationalCorrection,
  });
  const revalidateAdministratorAccess = administratorAccessController.revalidate;
  const setWorkspace = controller.setWorkspace;
  const handleAdministratorAccessInvalid = useCallback(() => {
    void revalidateAdministratorAccess();
    setWorkspace("planning");
  }, [revalidateAdministratorAccess, setWorkspace]);

  return <PlanningAppShell authRequired={authRequired} controller={controller} administratorAccessController={administratorAccessController} initialAdministrationModel={initialAdministrationModel} onAdministratorAccessInvalid={handleAdministratorAccessInvalid} source={source} decisionLogResult={initialDecisionLogResult} initialBacklogModel={initialBacklogModel} initialSprintModel={initialSprintModel} />;
}
