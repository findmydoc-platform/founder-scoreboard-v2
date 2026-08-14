import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { PlanningApp } from "@/features/planning/PlanningApp";
import { PlatformReleaseDetail } from "@/features/platform-releases/organisms/platform-release-detail";
import { platformReleaseSeed } from "@/features/platform-releases/model/platform-release-seed";
import { loadPlatformRelease } from "@/features/platform-releases/server/platform-release-read-model-supabase";
import { PlatformReleasesShell } from "@/features/platform-releases/templates/platform-releases-shell";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { emptyPlanningHeaderData, loadPlanningHeaderData } from "@/lib/planning-header-data";
import { sharedPlanningHeaderSlotLoaders } from "@/lib/planning-header-cache";
import { getServerPlanningAuth } from "@/lib/planning-auth-server";
import { getServerServiceRoleSupabase } from "@/lib/supabase-service-role";
import { requiresSupabaseAuth } from "@/lib/supabase";

type Props = {
  params: Promise<{ version: string }>;
  searchParams: Promise<{ technical?: string }>;
};

export const metadata: Metadata = { title: "Release-Details · findmydoc Planning" };
export const dynamic = "force-dynamic";

export default async function PlatformReleaseDetailPage({ params, searchParams }: Props) {
  const { version } = await params;
  if (!/^v\d+\.\d+\.\d+$/.test(version)) notFound();
  const authRequired = requiresSupabaseAuth();
  const auth = authRequired ? await getServerPlanningAuth(["ceo", "founder", "deputy", "viewer"]) : null;
  if (auth && !auth.ok) {
    return <PlanningApp initialData={emptyPlanningShellState} initialHeaderData={emptyPlanningHeaderData} initialWorkspace="notifications" source="supabase" authRequired initialAuthUser={auth.user} initialAuthError={auth.error} />;
  }
  const profile = auth?.ok ? auth.profile : null;
  const supabase = getServerServiceRoleSupabase();
  const [release, headerData] = supabase ? await Promise.all([
    loadPlatformRelease(supabase, version, profile?.id || null),
    loadPlanningHeaderData(supabase, {
      currentProfileId: profile?.id || null,
      platformRole: profile?.platformRole || null,
      sharedSlotLoaders: sharedPlanningHeaderSlotLoaders,
    }),
  ]) : [process.env.NODE_ENV === "development" ? platformReleaseSeed.find((item) => item.version === version) || null : null, emptyPlanningHeaderData];
  if (!release) notFound();
  const { technical } = await searchParams;
  return <PlatformReleasesShell authUser={auth?.ok ? auth.user : null} currentPlatformRole={profile?.platformRole} headerData={headerData}><PlatformReleaseDetail release={release} technicalInitiallyOpen={technical === "open"} /></PlatformReleasesShell>;
}
