import { PlanningApp } from "@/features/planning/PlanningApp";
import type { AppWorkspace } from "@/features/planning/model/workspace-routes";
import { getPlanningDataScopeForWorkspace } from "@/lib/planning-data-scopes";
import { emptyPlanningData, getPlanningData } from "@/lib/planning-data";
import { getServerPlanningAuth } from "@/lib/planning-auth-server";
import { isDemoSeedImportButtonAvailable } from "@/lib/seed/demo-import";
import { hasSupabaseEnv, requiresSupabaseAuth } from "@/lib/supabase";

function loadWorkspacePlanningData(initialWorkspace: AppWorkspace) {
  return getPlanningData(getPlanningDataScopeForWorkspace(initialWorkspace));
}

export async function renderWorkspacePage(initialWorkspace: AppWorkspace) {
  if (hasSupabaseEnv() && requiresSupabaseAuth()) {
    const auth = await getServerPlanningAuth(["ceo", "founder", "deputy", "viewer"]);
    if (!auth.ok) {
      return (
        <PlanningApp
          initialData={emptyPlanningData}
          initialWorkspace={initialWorkspace}
          source="supabase"
          authRequired
          initialAuthUser={auth.user}
          initialAuthError={auth.error}
        />
      );
    }

    const { data, source } = await loadWorkspacePlanningData(initialWorkspace);
    return (
      <PlanningApp
        initialData={data}
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

  const { data, source } = await loadWorkspacePlanningData(initialWorkspace);
  return (
    <PlanningApp
      initialData={data}
      initialWorkspace={initialWorkspace}
      source={source}
      authRequired={false}
      demoSeedImportAvailable={source === "seed" && isDemoSeedImportButtonAvailable()}
    />
  );
}
