import type { Metadata } from "next";
import { PlanningApp } from "@/features/planning/PlanningApp";
import { PlatformReleaseArchive } from "@/features/platform-releases/organisms/platform-release-archive";
import { platformReleaseSeed } from "@/features/platform-releases/model/platform-release-seed";
import { loadPlatformReleases } from "@/features/platform-releases/server/platform-release-read-model-supabase";
import { PlatformReleasesShell } from "@/features/platform-releases/templates/platform-releases-shell";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { emptyPlanningHeaderData, loadPlanningHeaderData } from "@/lib/planning-header-data";
import { sharedPlanningHeaderSlotLoaders } from "@/lib/planning-header-cache";
import { getServerPlanningAuth } from "@/lib/planning-auth-server";
import { getServerServiceRoleSupabase } from "@/lib/supabase-service-role";
import { requiresSupabaseAuth } from "@/lib/supabase";

export const metadata: Metadata = { title: "Releases · findmydoc Planning" };
export const dynamic = "force-dynamic";

export default async function PlatformReleasesPage() {
  const authRequired = requiresSupabaseAuth();
  const auth = authRequired ? await getServerPlanningAuth(["ceo", "founder", "deputy", "viewer"]) : null;
  if (auth && !auth.ok) {
    return <PlanningApp initialData={emptyPlanningShellState} initialHeaderData={emptyPlanningHeaderData} initialWorkspace="notifications" source="supabase" authRequired initialAuthUser={auth.user} initialAuthError={auth.error} />;
  }
  const profile = auth?.ok ? auth.profile : null;
  const supabase = getServerServiceRoleSupabase();
  const [releases, headerData] = supabase ? await Promise.all([
    loadPlatformReleases(supabase, profile?.id || null),
    loadPlanningHeaderData(supabase, {
      currentProfileId: profile?.id || null,
      platformRole: profile?.platformRole || null,
      sharedSlotLoaders: sharedPlanningHeaderSlotLoaders,
    }),
  ]) : [process.env.NODE_ENV === "development" ? platformReleaseSeed : [], emptyPlanningHeaderData];
  return <PlatformReleasesShell authUser={auth?.ok ? auth.user : null} currentPlatformRole={profile?.platformRole} headerData={headerData}><PlatformReleaseArchive releases={releases} /></PlatformReleasesShell>;
}
