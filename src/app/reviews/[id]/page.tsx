import { PlanningApp } from "@/features/planning/PlanningApp";
import { PlanningDataUnavailablePage } from "@/features/planning/templates/planning-data-unavailable-page";
import { emptyPlanningData, getPlanningData } from "@/lib/planning-data";
import { emptyPlanningHeaderData } from "@/lib/planning-header-data";
import { getServerPlanningAuth } from "@/lib/planning-auth-server";
import { isDemoSeedImportButtonAvailable } from "@/lib/seed/demo-import";
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
          initialHeaderData={emptyPlanningHeaderData}
          initialWorkspace="reviews"
          source="supabase"
          authRequired
          initialReviewTaskId={id}
          initialAuthUser={auth.user}
          initialAuthError={auth.error}
        />
      );
    }

    const { availability, data, headerData, source } = await getPlanningData(undefined, {
      workspace: "reviews",
      currentProfileId: auth.profile?.id || null,
      platformRole: auth.profile?.platformRole || null,
    });
    if (availability === "unavailable") {
      return <PlanningDataUnavailablePage workspace="reviews" authUserEmail={auth.user?.email || ""} />;
    }
    return (
      <PlanningApp
        key={`review-${id}`}
        initialData={data}
        initialHeaderData={headerData}
        initialWorkspace="reviews"
        source={source}
        authRequired
        demoSeedImportAvailable={source === "seed" && isDemoSeedImportButtonAvailable()}
        initialReviewTaskId={id}
        initialAuthUser={auth.user}
        initialCurrentProfile={auth.profile}
        initialProtectedDataLoaded
      />
    );
  }

  const { availability, data, headerData, source } = await getPlanningData();
  if (availability === "unavailable") return <PlanningDataUnavailablePage workspace="reviews" />;
  return <PlanningApp key={`review-${id}`} initialData={data} initialHeaderData={headerData} initialWorkspace="reviews" source={source} authRequired={false} demoSeedImportAvailable={source === "seed" && isDemoSeedImportButtonAvailable()} initialReviewTaskId={id} />;
}
