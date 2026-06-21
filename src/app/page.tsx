import { PlanningApp } from "@/features/planning/PlanningApp";
import { emptyPlanningData, getPlanningData } from "@/lib/planning-data";
import { getServerPlanningAuth } from "@/lib/planning-auth-server";
import { isDemoSeedImportButtonAvailable } from "@/lib/seed/demo-import";
import { hasSupabaseEnv, requiresSupabaseAuth } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function Home() {
  if (hasSupabaseEnv() && requiresSupabaseAuth()) {
    const auth = await getServerPlanningAuth(["ceo", "founder", "deputy", "viewer"]);
    if (!auth.ok) {
      return <PlanningApp initialData={emptyPlanningData} source="supabase" authRequired initialAuthUser={auth.user} initialAuthError={auth.error} />;
    }

    const { data, source } = await getPlanningData();
    return (
      <PlanningApp
        initialData={data}
        source={source}
        authRequired
        demoSeedImportAvailable={source === "seed" && isDemoSeedImportButtonAvailable()}
        initialAuthUser={auth.user}
        initialCurrentProfile={auth.profile}
        initialProtectedDataLoaded
      />
    );
  }

  const { data, source } = await getPlanningData();
  return <PlanningApp initialData={data} source={source} authRequired={false} demoSeedImportAvailable={source === "seed" && isDemoSeedImportButtonAvailable()} />;
}
