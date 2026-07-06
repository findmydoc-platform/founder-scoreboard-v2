import { AppSidebar } from "@/features/planning/organisms/app-sidebar";
import type { PlanningAppController } from "@/features/planning/hooks/use-planning-app-controller";
import { PlanningBootShell } from "@/features/planning/templates/planning-boot-shell";
import { PlanningAuthGate } from "@/features/planning/molecules/planning-auth-gate";
import { GitHubAppReconnectBanner } from "@/features/planning/molecules/github-app-reconnect-banner";
import { PlanningMetrics } from "@/features/planning/molecules/planning-metrics";
import { quickFilters } from "@/features/planning/model/planning-app-model";
import { PlanningFilters } from "@/features/planning/organisms/planning-filters";
import { PlanningHeader } from "@/features/planning/organisms/planning-header";
import { PlanningOverlayLayer } from "@/features/planning/organisms/planning-overlay-layer";
import { PlanningWorkspaceRenderer } from "@/features/planning/organisms/planning-workspace-renderer";
import { ReviewDetailPage } from "@/features/reviews/templates/review-detail-page";

type PlanningAppShellProps = {
  authRequired: boolean;
  controller: PlanningAppController;
  source: "seed" | "supabase";
};

export function PlanningAppShell({ authRequired, controller, source }: PlanningAppShellProps) {
  const {
    authAvailable,
    authBusy,
    authChecked,
    authError,
    authUser,
    currentProfile,
    data,
    filters,
    filtersAvailable,
    githubAppConnected,
    isPending,
    localStateLoaded,
    metrics,
    mobileNavOpen,
    protectedDataLoaded,
    releaseSidebarFocus,
    reopenReviewTask,
    reviewTask,
    selectedReviewDetailTask,
    selectedReviewDetailTaskId,
    setFilters,
    setMobileNavOpen,
    setWorkspace,
    signIn,
    signOut,
    showFilters,
    sidebarRef,
    workspace,
  } = controller;

  if (authRequired && !authChecked) {
    return (
      <PlanningBootShell
        workspace={workspace}
        source={source}
        localStateLoaded={localStateLoaded}
        authAvailable={authAvailable}
        authUserEmail=""
        title="Zugriff wird geprüft"
        description="FounderOps prüft den Teamzugriff, bevor Planungsdaten geladen werden."
      />
    );
  }

  if (authRequired && !authUser) {
    return <PlanningAuthGate controller={controller} state="sign-in" />;
  }

  if (authRequired && authUser && !protectedDataLoaded && !data.tasks.length) {
    return (
      <PlanningBootShell
        workspace={workspace}
        source={source}
        localStateLoaded={localStateLoaded}
        authAvailable={authAvailable}
        authUserEmail={authUser.email || ""}
        title={authError ? "Planungsdaten konnten nicht geladen werden" : "Planungsdaten werden geladen"}
        description={authError ? "Der Teamzugriff ist aktiv, aber die Planungsdaten konnten nicht geladen werden." : "Der Teamzugriff ist gültig. Die Daten werden jetzt geladen."}
        error={authError || undefined}
        authUser={authUser}
        authBusy={authBusy}
        onSignIn={signIn}
        onSignOut={signOut}
      />
    );
  }

  if (selectedReviewDetailTaskId) {
    return (
      <ReviewDetailPage
        data={data}
        task={selectedReviewDetailTask}
        currentProfile={currentProfile}
        pending={isPending}
        source={source}
        onReview={reviewTask}
        onReopen={reopenReviewTask}
      />
    );
  }

  return (
    <div className="min-h-screen bg-[#f4f7fb] text-slate-900">
      <AppSidebar
        ref={sidebarRef}
        onMouseLeave={releaseSidebarFocus}
        activeWorkspace={workspace}
        onSelect={setWorkspace}
        source={source}
        localStateLoaded={localStateLoaded}
        authAvailable={authAvailable}
        authUserEmail={authUser?.email || ""}
        currentPlatformRole={currentProfile?.platformRole || ""}
        mobileOpen={mobileNavOpen}
        onMobileClose={() => setMobileNavOpen(false)}
      />

      <main className="lg:pl-16">
        <PlanningHeader controller={controller} />

        <GitHubAppReconnectBanner
          authenticated={Boolean(authUser)}
          profileId={currentProfile?.id || ""}
          githubAppConnected={githubAppConnected}
          busy={authBusy}
          onConnect={() => signIn({ githubReconnect: true, clearReconnectGuard: true })}
        />

        {filtersAvailable && <PlanningMetrics metrics={metrics} />}

        {showFilters && filtersAvailable && (
          <PlanningFilters
            filters={filters}
            profiles={data.profiles}
            packages={data.packages}
            quickFilters={quickFilters}
            onChange={setFilters}
          />
        )}

        <PlanningWorkspaceRenderer controller={controller} source={source} />
      </main>

      <PlanningOverlayLayer controller={controller} />
    </div>
  );
}
