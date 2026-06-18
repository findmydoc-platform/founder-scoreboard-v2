import { AppSidebar } from "@/features/planning/organisms/app-sidebar";
import type { PlanningAppController } from "@/features/planning/hooks/use-planning-app-controller";
import { PlanningAuthGate } from "@/features/planning/molecules/planning-auth-gate";
import { PlanningMetrics } from "@/features/planning/molecules/planning-metrics";
import { quickFilters } from "@/features/planning/model/planning-app-model";
import { PlanningFilters } from "@/features/planning/organisms/planning-filters";
import { PlanningHeader } from "@/features/planning/organisms/planning-header";
import { PlanningOverlayLayer } from "@/features/planning/organisms/planning-overlay-layer";
import { PlanningWorkspaceRenderer } from "@/features/planning/organisms/planning-workspace-renderer";
import { ReviewDetailPage } from "@/features/reviews/templates/review-detail-page";
import { TaskDetailPage } from "@/features/tasks/templates/task-detail-page";

type PlanningAppShellProps = {
  authRequired: boolean;
  controller: PlanningAppController;
  source: "seed" | "supabase";
};

export function PlanningAppShell({ authRequired, controller, source }: PlanningAppShellProps) {
  const {
    authAvailable,
    authChecked,
    authUser,
    commentImportNotice,
    currentProfile,
    data,
    filters,
    filtersAvailable,
    fullTaskView,
    isPending,
    localStateLoaded,
    metrics,
    mobileNavOpen,
    protectedDataLoaded,
    releaseSidebarFocus,
    reopenReviewTask,
    reviewTask,
    selectedPackage,
    selectedReviewDetailTask,
    selectedReviewDetailTaskId,
    selectedTask,
    selectedTaskActivity,
    selectedTaskBlockers,
    selectedTaskComments,
    selectedTaskExternalComments,
    selectedTaskSubIssues,
    setFilters,
    setMobileNavOpen,
    setWorkspace,
    showFilters,
    sidebarRef,
    workspace,
  } = controller;

  if (authRequired && (!authChecked || !authUser)) {
    return <PlanningAuthGate controller={controller} state="sign-in" />;
  }

  if (authRequired && authUser && !protectedDataLoaded && !data.tasks.length) {
    return <PlanningAuthGate controller={controller} state="loading" />;
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

  if (fullTaskView && selectedTask) {
    return (
      <TaskDetailPage
        task={selectedTask}
        pack={selectedPackage}
        packages={data.packages}
        sprint={data.sprints.find((sprint) => sprint.id === selectedTask.sprintId)}
        subIssues={selectedTaskSubIssues}
        comments={selectedTaskComments}
        externalComments={selectedTaskExternalComments}
        activities={selectedTaskActivity}
        blockers={selectedTaskBlockers}
        taskRelations={data.taskRelations}
        allTasks={data.tasks}
        profiles={data.profiles}
        sprints={data.sprints}
        milestones={data.milestones}
        decisions={data.decisions}
        decisionTaskLinks={data.decisionTaskLinks}
        source={source}
        commentImportNotice={commentImportNotice}
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
