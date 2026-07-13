import { notFound } from "next/navigation";
import { PlanningApp } from "@/features/planning/PlanningApp";
import { PlanningDataUnavailablePage } from "@/features/planning/templates/planning-data-unavailable-page";
import { PlanningInitiativeDetailPage } from "@/features/planning-trash/templates/planning-initiative-detail-page";
import { initiativeDetailPageDataScope } from "@/lib/planning-data-scopes";
import { emptyPlanningData, getPlanningData } from "@/lib/planning-data";
import { emptyPlanningHeaderData } from "@/lib/planning-header-data";
import { getServerPlanningAuth } from "@/lib/planning-auth-server";
import { loadPlanningInitiativeDetail } from "@/lib/planning-trash-detail";
import { getServerSupabase, requiresSupabaseAuth } from "@/lib/supabase";
import type { AuthenticatedProfile } from "@/lib/types";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function InitiativePage({ params }: Props) {
  const { id } = await params;
  let authProfile: AuthenticatedProfile | null = null;
  const authRequired = requiresSupabaseAuth();
  if (authRequired) {
    const auth = await getServerPlanningAuth(["ceo", "founder", "deputy", "viewer"]);
    if (!auth.ok) {
      return <PlanningApp initialData={emptyPlanningData} initialHeaderData={emptyPlanningHeaderData} initialWorkspace="planning" source="supabase" authRequired initialAuthUser={auth.user} initialAuthError={auth.error} />;
    }
    authProfile = auth.profile;
  }

  const supabase = getServerSupabase();
  const { availability, data, source } = await getPlanningData(initiativeDetailPageDataScope, {
    workspace: "planning",
    currentProfileId: authProfile?.id || null,
    platformRole: authProfile?.platformRole || null,
  });
  if (availability === "unavailable") return <PlanningDataUnavailablePage workspace="planning" />;
  if (!supabase || source === "seed") notFound();

  const detailResult = await loadPlanningInitiativeDetail(supabase, id, data.profiles);
  if (!detailResult.ok) {
    if (detailResult.status === 404) notFound();
    return <PlanningDataUnavailablePage workspace="planning" />;
  }

  return (
    <PlanningInitiativeDetailPage
      detail={detailResult.detail}
      profiles={data.profiles}
      currentPlatformRole={authProfile?.platformRole}
    />
  );
}
