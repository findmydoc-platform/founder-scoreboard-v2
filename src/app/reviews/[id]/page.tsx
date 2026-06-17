import { PlanningApp } from "@/components/planning-app";
import { emptyPlanningData, getPlanningData } from "@/lib/planning-data";
import { hasSupabaseEnv, requiresSupabaseAuth } from "@/lib/supabase";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function ReviewPage({ params }: Props) {
  const { id } = await params;

  if (hasSupabaseEnv() && requiresSupabaseAuth()) {
    return <PlanningApp key={`review-${id}`} initialData={emptyPlanningData} source="supabase" authRequired initialReviewTaskId={id} />;
  }

  const { data, source } = await getPlanningData();
  return <PlanningApp key={`review-${id}`} initialData={data} source={source} authRequired={false} initialReviewTaskId={id} />;
}
