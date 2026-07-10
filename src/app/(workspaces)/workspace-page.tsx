import { PlanningApp } from "@/features/planning/PlanningApp";
import type { AppWorkspace } from "@/features/planning/model/workspace-routes";
import { getPlanningDataScopeForWorkspace } from "@/lib/planning-data-scopes";
import { emptyPlanningData, getPlanningData } from "@/lib/planning-data";
import { emptyPlanningHeaderData } from "@/lib/planning-header-data";
import { getServerPlanningAuth } from "@/lib/planning-auth-server";
import { isDemoSeedImportButtonAvailable } from "@/lib/seed/demo-import";
import { hasSupabaseEnv, requiresSupabaseAuth } from "@/lib/supabase";
import type { AuthenticatedProfile } from "@/lib/types";

function loadWorkspacePlanningData(initialWorkspace: AppWorkspace, profile?: AuthenticatedProfile | null) {
  return getPlanningData(getPlanningDataScopeForWorkspace(initialWorkspace), {
    workspace: initialWorkspace,
    currentProfileId: profile?.id || null,
    platformRole: profile?.platformRole || null,
  });
}

export async function renderWorkspacePage(initialWorkspace: AppWorkspace) {
  if (hasSupabaseEnv() && requiresSupabaseAuth()) {
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

    const { data, headerData, source } = await loadWorkspacePlanningData(initialWorkspace, auth.profile);
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

  const { data, headerData, source } = await loadWorkspacePlanningData(initialWorkspace);
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
