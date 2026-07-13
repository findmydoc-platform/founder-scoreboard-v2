import { PlanningApp } from "@/features/planning/PlanningApp";
import { PlanningDataUnavailablePage } from "@/features/planning/templates/planning-data-unavailable-page";
import type { AppWorkspace } from "@/features/planning/model/workspace-routes";
import { getPlanningDataScopeForWorkspace } from "@/lib/planning-data-scopes";
import { emptyPlanningData, getPlanningData, type PlanningDataLoadOptions } from "@/lib/planning-data";
import { emptyPlanningHeaderData } from "@/lib/planning-header-data";
import { sharedPlanningHeaderSlotLoaders } from "@/lib/planning-header-cache";
import { getServerPlanningAuth } from "@/lib/planning-auth-server";
import { isDemoSeedImportButtonAvailable } from "@/lib/seed/demo-import";
import { requiresSupabaseAuth } from "@/lib/supabase";
import type { AuthenticatedProfile } from "@/lib/types";

function loadWorkspacePlanningData(
  initialWorkspace: AppWorkspace,
  profile?: AuthenticatedProfile | null,
  options?: PlanningDataLoadOptions,
) {
  return getPlanningData(getPlanningDataScopeForWorkspace(initialWorkspace), {
    workspace: initialWorkspace,
    currentProfileId: profile?.id || null,
    platformRole: profile?.platformRole || null,
  }, {
    ...options,
    sharedHeaderSlotLoaders: sharedPlanningHeaderSlotLoaders,
  });
}

export async function renderWorkspacePage(initialWorkspace: AppWorkspace) {
  if (requiresSupabaseAuth()) {
    const auth = await getServerPlanningAuth(["ceo", "founder", "deputy", "viewer"]);
    if (!auth.ok) {
      return (
        <PlanningApp
          initialData={emptyPlanningData}
          initialHeaderData={emptyPlanningHeaderData}
          initialWorkspace={initialWorkspace}
          source="supabase"
          authRequired
          initialAuthUser={auth.user}
          initialAuthError={auth.error}
        />
      );
    }

    const { availability, data, headerData, source } = await loadWorkspacePlanningData(initialWorkspace, auth.profile, {
      headerData: "deferred",
    });
    if (availability === "unavailable") {
      return <PlanningDataUnavailablePage workspace={initialWorkspace} authUserEmail={auth.user?.email || ""} />;
    }
    return (
      <PlanningApp
        initialData={data}
        initialHeaderData={headerData}
        initialWorkspace={initialWorkspace}
        source={source}
        authRequired
        demoSeedImportAvailable={source === "seed" && isDemoSeedImportButtonAvailable()}
        initialAuthUser={auth.user}
        initialCurrentProfile={auth.profile}
        initialProtectedDataLoaded
      />
    );
  }

  const { availability, data, headerData, source } = await loadWorkspacePlanningData(initialWorkspace);
  if (availability === "unavailable") {
    return <PlanningDataUnavailablePage workspace={initialWorkspace} />;
  }
  return (
    <PlanningApp
      initialData={data}
      initialHeaderData={headerData}
      initialWorkspace={initialWorkspace}
      source={source}
      authRequired={false}
      demoSeedImportAvailable={source === "seed" && isDemoSeedImportButtonAvailable()}
    />
  );
}
