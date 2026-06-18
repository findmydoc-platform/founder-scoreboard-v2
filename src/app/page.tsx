import { PlanningApp } from "@/features/planning/PlanningApp";
import { emptyPlanningData, getPlanningData } from "@/lib/planning-data";
import { hasSupabaseEnv, requiresSupabaseAuth } from "@/lib/supabase";

export const dynamic = "force-dynamic";

export default async function Home() {
  if (hasSupabaseEnv() && requiresSupabaseAuth()) {
    return <PlanningApp initialData={emptyPlanningData} source="supabase" authRequired />;
  }

  const { data, source } = await getPlanningData();
  return <PlanningApp initialData={data} source={source} authRequired={false} />;
}
