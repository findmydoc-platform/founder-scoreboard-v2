import type { Metadata } from "next";
import { PlanningApp } from "@/features/planning/PlanningApp";
import { PlatformReleaseArchive } from "@/features/platform-releases/organisms/platform-release-archive";
import { PlatformReleasesShell } from "@/features/platform-releases/templates/platform-releases-shell";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { emptyPlanningHeaderData } from "@/lib/planning-header-data";
import { authorizeCredentialAction } from "@/lib/credentials";
import { redirectForWorkspaceGate } from "@/lib/workspace-gate-redirect";
import { requiresSupabaseAuth } from "@/lib/supabase-configuration";

export const metadata: Metadata = { title: "Releases · findmydoc Planning" };
export const dynamic = "force-dynamic";

export default async function PlatformReleasesPage() {
  const authRequired = requiresSupabaseAuth();
  const auth = authRequired ? await authorizeCredentialAction({ credential: { kind: "server-cookies" }, action: "session.planning" }) : null;
  if (auth && !auth.ok) {
    redirectForWorkspaceGate(auth.code);
    return <PlanningApp initialData={emptyPlanningShellState} initialHeaderData={emptyPlanningHeaderData} initialWorkspace="notifications" source="supabase" authRequired initialAuthUser={auth.user} initialAuthError={auth.error} />;
  }
  const profile = auth?.ok ? auth.profile : null;
  const permission = await authorizeCredentialAction({ credential: { kind: "server-cookies" }, action: "releases.read" });
  const sameActor = permission.ok && (permission.profile?.id || null) === (profile?.id || null)
    && (permission.profile?.platformRole || null) === (profile?.platformRole || null);
  const [result, header] = permission.ok && sameActor ? await Promise.all([
    permission.account.readReleases(), permission.account.loadReleaseHeader(),
  ]) : [{ available: false, releases: [] }, { available: false, headerData: emptyPlanningHeaderData }];
  const releases = result.releases;
  const headerData = header.headerData;
  return <PlatformReleasesShell authUser={auth?.ok ? auth.user : null} currentPlatformRole={profile?.platformRole} headerData={headerData}><PlatformReleaseArchive releases={releases} /></PlatformReleasesShell>;
}
