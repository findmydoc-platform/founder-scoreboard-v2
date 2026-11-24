import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { PlanningApp } from "@/features/planning/PlanningApp";
import { PlatformReleaseOwnedDetail } from "@/features/platform-releases/organisms/platform-release-owned-detail";
import { isReleaseDocumentRequest, startPlatformReleaseReferenceEntry, PlatformReleaseServerReferenceEntry } from "@/features/platform-releases/server/platform-release-server-reference-entry";
import { PlatformReleasesShell } from "@/features/platform-releases/templates/platform-releases-shell";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { emptyPlanningHeaderData } from "@/lib/planning-header-data";
import { authorizeCredentialAction } from "@/lib/credentials";
import { redirectForWorkspaceGate } from "@/lib/workspace-gate-redirect";
import { requiresSupabaseAuth } from "@/lib/supabase-configuration";

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
  const auth = authRequired ? await authorizeCredentialAction({ credential: { kind: "server-cookies" }, action: "session.planning" }) : null;
  if (auth && !auth.ok) {
    redirectForWorkspaceGate(auth.code);
    return <PlanningApp initialData={emptyPlanningShellState} initialHeaderData={emptyPlanningHeaderData} initialWorkspace="notifications" source="supabase" authRequired initialAuthUser={auth.user} initialAuthError={auth.error} />;
  }
  const profile = auth?.ok ? auth.profile : null;
  const permission = await authorizeCredentialAction({ credential: { kind: "server-cookies" }, action: "releases.read" });
  const sameActor = permission.ok && (permission.profile?.id || null) === (profile?.id || null)
    && (permission.profile?.platformRole || null) === (profile?.platformRole || null);
  const admitted = permission.ok && sameActor ? permission : undefined;
  const headerResult = admitted?.account.loadReleaseHeader({ headerSlots: ["quickLinks", "calendarEvents"] });
  const result = await admitted?.account.readReleaseContent({ version, detailDocument: true });
  const release = result?.status === "ready" ? result.releases.find(item => item.version === version) : null;
  if (!release) notFound();
  const readSession = admitted?.readSession;
  const entry = result?.status === "ready" && result.readAuthority && result.readActor && admitted
    && auth?.ok && readSession && auth.user.id === readSession.userId && auth.session?.userId === readSession.userId
    && auth.session.revision === readSession.revision && auth.session.expiresAt === readSession.expiresAt
    && isReleaseDocumentRequest(await headers())
    ? startPlatformReleaseReferenceEntry({ version, manifestDigest: release.manifestDigest }, readSession, result.readActor, result.readAuthority, admitted.account.readReleaseReferences)
    : undefined;
  const header = await headerResult;
  const { technical } = await searchParams;
  return <PlatformReleasesShell authUser={auth?.ok ? auth.user : null} currentPlatformRole={profile?.platformRole} initialCurrentProfile={profile} initialAdministratorAccess={auth?.ok ? auth.authority?.administratorAccess : undefined} headerData={header?.headerData || emptyPlanningHeaderData} calendarProfiles={header?.calendarProfiles} returnToArchive initialReleaseReferenceEntry={entry?.read}>
    <PlatformReleaseOwnedDetail release={release} technicalInitiallyOpen={technical === "open"} serverEntryId={entry?.read.id}>
      {entry ? <PlatformReleaseServerReferenceEntry read={entry.read} result={entry.result} /> : null}
    </PlatformReleaseOwnedDetail>
  </PlatformReleasesShell>;
}
