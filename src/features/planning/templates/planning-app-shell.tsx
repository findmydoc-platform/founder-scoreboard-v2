import { AppSidebar } from "@/features/planning/organisms/app-sidebar";
import type { PlanningAppController } from "@/features/planning/hooks/use-planning-app-controller";
import { PlanningBootShell } from "@/features/planning/templates/planning-boot-shell";
import { PlanningAuthGate } from "@/features/planning/molecules/planning-auth-gate";
import { quickFilters } from "@/features/planning/model/planning-app-model";
import { PlanningFilters } from "@/features/planning/organisms/planning-filters";
import { PlanningHeader } from "@/features/planning/organisms/planning-header";
import { PlanningOverlayLayer } from "@/features/planning/organisms/planning-overlay-layer";
import { PlanningWorkspaceRenderer } from "@/features/planning/organisms/planning-workspace-renderer";
import { FeatureTourProvider } from "@/features/product-tours/organisms/feature-tour-provider";
import { ProductUpdatesProvider } from "@/features/product-updates/organisms/product-updates-provider";
import type { NotionDecisionLogResult } from "@/lib/notion-decision-log";

type PlanningAppShellProps = {
  authRequired: boolean;
  controller: PlanningAppController;
  source: "seed" | "supabase";
  decisionLogResult?: NotionDecisionLogResult;
};

export function PlanningAppShell({ authRequired, controller, source, decisionLogResult }: PlanningAppShellProps) {
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
    localStateLoaded,
    mobileNavOpen,
    protectedDataLoaded,
    releaseSidebarFocus,
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

  return (
    <div className="min-h-screen bg-[#f4f7fb] text-slate-900">
      <AppSidebar
        ref={sidebarRef}
        onMouseLeave={releaseSidebarFocus}
        activeWorkspace={workspace}
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

        <FeatureTourProvider
          apiClient={controller.apiClient}
          currentProfile={currentProfile}
          data={data}
          openTaskPanel={controller.openTaskPanel}
          selectedTaskId={controller.selectedTaskId}
          setData={controller.setData}
          setWorkspace={setWorkspace}
          source={source}
          workspace={workspace}
        />

        <ProductUpdatesProvider profileId={currentProfile?.id || null} />

        {filtersAvailable && (
          <PlanningFilters
            filters={filters}
            profiles={data.profiles}
            packages={data.packages}
            sprints={data.sprints}
            workstreams={Array.from(new Set(data.tasks.map((task) => task.workstream).filter(Boolean))).sort((left, right) => left.localeCompare(right, "de"))}
            quickFilters={quickFilters}
            expanded={showFilters}
            visibleCount={controller.visibleTasks.length}
            totalCount={data.tasks.filter((task) => task.taskType !== "sub_issue").length}
            onExpandedChange={controller.setShowFilters}
            onChange={setFilters}
          />
        )}

        <PlanningWorkspaceRenderer controller={controller} source={source} decisionLogResult={decisionLogResult} />
      </main>

      <PlanningOverlayLayer controller={controller} />
    </div>
  );
}
