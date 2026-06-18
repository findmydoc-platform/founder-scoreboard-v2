import { PlanningApp } from "@/features/planning/PlanningApp";
import { emptyPlanningData, getPlanningData } from "@/lib/planning-data";
import { getServerPlanningAuth } from "@/lib/planning-auth-server";
import { hasSupabaseEnv, requiresSupabaseAuth } from "@/lib/supabase";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function ReviewPage({ params }: Props) {
  const { id } = await params;

  if (hasSupabaseEnv() && requiresSupabaseAuth()) {
    const auth = await getServerPlanningAuth(["ceo", "founder", "deputy", "viewer"]);
    if (!auth.ok) {
      return (
        <PlanningApp
          key={`review-${id}`}
          initialData={emptyPlanningData}
          source="supabase"
          authRequired
          initialReviewTaskId={id}
          initialAuthUser={auth.user}
          initialAuthError={auth.error}
        />
      );
    }

    const { data, source } = await getPlanningData();
    return (
      <PlanningApp
        key={`review-${id}`}
        initialData={data}
        source={source}
        authRequired
        initialReviewTaskId={id}
        initialAuthUser={auth.user}
        initialCurrentProfile={auth.profile}
        initialProtectedDataLoaded
      />
    );
  }

  const { data, source } = await getPlanningData();
  return <PlanningApp key={`review-${id}`} initialData={data} source={source} authRequired={false} initialReviewTaskId={id} />;
}
