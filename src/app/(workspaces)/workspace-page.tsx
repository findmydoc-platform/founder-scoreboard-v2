import { PlanningApp } from "@/features/planning/PlanningApp";
import { WorkspaceDataUnavailablePage } from "@/features/planning/templates/workspace-data-unavailable-page";
import type { AppWorkspace } from "@/features/planning/model/workspace-routes";
import { backlogModelToPlanningShellState } from "@/features/backlog/model/backlog-planning-shell-projection";
import { createSupabaseBacklogReadModel } from "@/features/backlog/server/backlog-read-model-supabase";
import { planningWorkspaceModelToPlanningShellState } from "@/features/planning-items/model/planning-shell-projection";
import { createSupabasePlanningBoardReadModel } from "@/features/planning/server/planning-board-read-model-supabase";
import { createSupabaseStrategicPlanningReadModel } from "@/features/projects/server/strategic-planning-read-model-supabase";
import { supportingWorkspaceModelToPlanningShellState, type SupportingWorkspace } from "@/features/planning/model/supporting-planning-shell-projection";
import { createSupabaseEventsReadModel } from "@/features/events/server/events-read-model-supabase";
import { createSupabaseToolsReadModel } from "@/features/tools/server/tools-read-model-supabase";
import { createSupabaseTeamReadModel } from "@/features/team/server/team-read-model-supabase";
import { createSupabaseProfileReadModel } from "@/features/profile/server/profile-read-model-supabase";
import { createSupabaseNotificationsReadModel } from "@/features/notifications/server/notifications-read-model-supabase";
import { sprintWorkspaceModelToPlanningShellState } from "@/features/sprint/model/sprint-planning-shell-projection";
import { createSupabaseSprintReadModel } from "@/features/sprint/server/sprint-read-model-supabase";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { emptyPlanningHeaderData, loadPlanningHeaderData } from "@/lib/planning-header-data";
import { sharedPlanningHeaderSlotLoaders } from "@/lib/planning-header-cache";
import { getServerPlanningAuth } from "@/lib/planning-auth-server";
import { loadNotionDecisionLog } from "@/lib/notion-decision-log";
import { getServerSupabase, requiresSupabaseAuth } from "@/lib/supabase";
import type { AuthenticatedProfile } from "@/lib/types";

async function loadBacklogPageData(profile?: AuthenticatedProfile | null) {
  const supabase = getServerSupabase();
  if (!supabase) return { status: "unavailable" as const };
  const [backlog, headerData] = await Promise.all([
    createSupabaseBacklogReadModel(supabase).load({
      authorized: true,
      actorProfileId: profile?.id || null,
    }),
    loadPlanningHeaderData(supabase, {
      currentProfileId: profile?.id || null,
      platformRole: profile?.platformRole || null,
      sharedSlotLoaders: sharedPlanningHeaderSlotLoaders,
    }),
  ]);
  return backlog.status === "ready"
    ? { status: "ready" as const, model: backlog.model, headerData }
    : { status: backlog.status };
}

async function loadPlanningWorkspacePageData(
  workspace: "planning" | "projects",
  profile?: AuthenticatedProfile | null,
) {
  const supabase = getServerSupabase();
  if (!supabase) return { status: "unavailable" as const };
  const readModel = workspace === "planning"
    ? createSupabasePlanningBoardReadModel(supabase)
    : createSupabaseStrategicPlanningReadModel(supabase);
  const [planningWorkspace, headerData] = await Promise.all([
    readModel.load({ authorized: true, actorProfileId: profile?.id || null }),
    loadPlanningHeaderData(supabase, {
      currentProfileId: profile?.id || null,
      platformRole: profile?.platformRole || null,
      sharedSlotLoaders: sharedPlanningHeaderSlotLoaders,
    }),
  ]);
  return planningWorkspace.status === "ready"
    ? { status: "ready" as const, model: planningWorkspace.model, headerData }
    : { status: planningWorkspace.status };
}

async function loadSupportingWorkspacePageData(
  workspace: SupportingWorkspace,
  profile?: AuthenticatedProfile | null,
) {
  const supabase = getServerSupabase();
  if (!supabase) return { status: "unavailable" as const };
  const readModel = workspace === "events" ? createSupabaseEventsReadModel(supabase)
    : workspace === "tools" ? createSupabaseToolsReadModel(supabase)
      : workspace === "team" ? createSupabaseTeamReadModel(supabase)
        : workspace === "profile" ? createSupabaseProfileReadModel(supabase)
          : createSupabaseNotificationsReadModel(supabase);
  const [workspaceData, headerData] = await Promise.all([
    readModel.load({ authorized: true, actorProfileId: profile?.id || null }),
    loadPlanningHeaderData(supabase, {
      currentProfileId: profile?.id || null,
      platformRole: profile?.platformRole || null,
      sharedSlotLoaders: sharedPlanningHeaderSlotLoaders,
    }),
  ]);
  return workspaceData.status === "ready"
    ? { status: "ready" as const, model: workspaceData.model, headerData }
    : { status: workspaceData.status };
}

async function loadSprintPageData(profile?: AuthenticatedProfile | null) {
  const supabase = getServerSupabase();
  if (!supabase) return { status: "unavailable" as const };
  const [sprint, headerData] = await Promise.all([
    createSupabaseSprintReadModel(supabase).load({ authorized: true, actorProfileId: profile?.id || null }),
    loadPlanningHeaderData(supabase, {
      currentProfileId: profile?.id || null,
      platformRole: profile?.platformRole || null,
      sharedSlotLoaders: sharedPlanningHeaderSlotLoaders,
    }),
  ]);
  return sprint.status === "ready"
    ? { status: "ready" as const, model: sprint.model, headerData }
    : { status: sprint.status };
}

async function loadDecisionLogPageData(profile?: AuthenticatedProfile | null) {
  const supabase = getServerSupabase();
  if (!supabase) return { status: "unavailable" as const };
  const [headerData, decisionLog] = await Promise.all([
    loadPlanningHeaderData(supabase, {
      currentProfileId: profile?.id || null,
      platformRole: profile?.platformRole || null,
      sharedSlotLoaders: sharedPlanningHeaderSlotLoaders,
    }),
    loadNotionDecisionLog(),
  ]);
  return { status: "ready" as const, headerData, decisionLog };
}

export async function renderWorkspacePage(initialWorkspace: AppWorkspace) {
  if (requiresSupabaseAuth()) {
    const auth = await getServerPlanningAuth(["ceo", "founder", "deputy", "viewer"]);
    if (!auth.ok) {
      return (
        <PlanningApp
          initialData={emptyPlanningShellState}
          initialHeaderData={emptyPlanningHeaderData}
          initialWorkspace={initialWorkspace}
          source="supabase"
          authRequired
          initialAuthUser={auth.user}
          initialAuthError={auth.error}
        />
      );
    }

    if (initialWorkspace === "backlog") {
      const backlog = await loadBacklogPageData(auth.profile);
      if (backlog.status !== "ready") {
        return <WorkspaceDataUnavailablePage workspace="backlog" authUserEmail={auth.user?.email || ""} />;
      }
      return (
        <PlanningApp
          initialData={backlogModelToPlanningShellState(backlog.model)}
          initialHeaderData={backlog.headerData}
          initialWorkspace="backlog"
          initialBacklogModel={backlog.model}
          source="supabase"
          authRequired
          initialAuthUser={auth.user}
          initialCurrentProfile={auth.profile}
          initialProtectedDataLoaded
        />
      );
    }

    if (initialWorkspace === "planning" || initialWorkspace === "projects") {
      const planningWorkspace = await loadPlanningWorkspacePageData(initialWorkspace, auth.profile);
      if (planningWorkspace.status !== "ready") {
        return <WorkspaceDataUnavailablePage workspace={initialWorkspace} authUserEmail={auth.user?.email || ""} />;
      }
      return (
        <PlanningApp
          initialData={planningWorkspaceModelToPlanningShellState(planningWorkspace.model)}
          initialHeaderData={planningWorkspace.headerData}
          initialWorkspace={initialWorkspace}
          source="supabase"
          authRequired
          initialAuthUser={auth.user}
          initialCurrentProfile={auth.profile}
          initialProtectedDataLoaded
        />
      );
    }

    if (initialWorkspace === "events" || initialWorkspace === "tools" || initialWorkspace === "team" || initialWorkspace === "profile" || initialWorkspace === "notifications") {
      const supportingWorkspace = await loadSupportingWorkspacePageData(initialWorkspace, auth.profile);
      if (supportingWorkspace.status !== "ready") {
        return <WorkspaceDataUnavailablePage workspace={initialWorkspace} authUserEmail={auth.user?.email || ""} />;
      }
      return (
        <PlanningApp
          initialData={supportingWorkspaceModelToPlanningShellState(initialWorkspace, supportingWorkspace.model)}
          initialHeaderData={supportingWorkspace.headerData}
          initialWorkspace={initialWorkspace}
          source="supabase"
          authRequired
          initialAuthUser={auth.user}
          initialCurrentProfile={auth.profile}
          initialProtectedDataLoaded
        />
      );
    }

    if (initialWorkspace === "sprint") {
      const sprint = await loadSprintPageData(auth.profile);
      if (sprint.status !== "ready") return <WorkspaceDataUnavailablePage workspace="sprint" authUserEmail={auth.user?.email || ""} />;
      return (
        <PlanningApp
          initialData={sprintWorkspaceModelToPlanningShellState(sprint.model)}
          initialHeaderData={sprint.headerData}
          initialWorkspace="sprint"
          initialSprintModel={sprint.model}
          source="supabase"
          authRequired
          initialAuthUser={auth.user}
          initialCurrentProfile={auth.profile}
          initialProtectedDataLoaded
        />
      );
    }

    const decisionLog = await loadDecisionLogPageData(auth.profile);
    if (decisionLog.status !== "ready") {
      return <WorkspaceDataUnavailablePage workspace={initialWorkspace} authUserEmail={auth.user?.email || ""} />;
    }
    return (
      <PlanningApp
        initialData={emptyPlanningShellState}
        initialHeaderData={decisionLog.headerData}
        initialWorkspace={initialWorkspace}
        source="supabase"
        authRequired
        initialAuthUser={auth.user}
        initialCurrentProfile={auth.profile}
        initialProtectedDataLoaded
        initialDecisionLogResult={decisionLog.decisionLog}
      />
    );
  }

  if (initialWorkspace === "backlog") {
    const backlog = await loadBacklogPageData();
    if (backlog.status !== "ready") return <WorkspaceDataUnavailablePage workspace="backlog" />;
    return (
      <PlanningApp
        initialData={backlogModelToPlanningShellState(backlog.model)}
        initialHeaderData={backlog.headerData}
        initialWorkspace="backlog"
        initialBacklogModel={backlog.model}
        source="supabase"
        authRequired={false}
      />
    );
  }


  if (initialWorkspace === "planning" || initialWorkspace === "projects") {
    const planningWorkspace = await loadPlanningWorkspacePageData(initialWorkspace);
    if (planningWorkspace.status !== "ready") return <WorkspaceDataUnavailablePage workspace={initialWorkspace} />;
    return (
      <PlanningApp
        initialData={planningWorkspaceModelToPlanningShellState(planningWorkspace.model)}
        initialHeaderData={planningWorkspace.headerData}
        initialWorkspace={initialWorkspace}
        source="supabase"
        authRequired={false}
      />
    );
  }

  if (initialWorkspace === "events" || initialWorkspace === "tools" || initialWorkspace === "team" || initialWorkspace === "profile" || initialWorkspace === "notifications") {
    const supportingWorkspace = await loadSupportingWorkspacePageData(initialWorkspace);
    if (supportingWorkspace.status !== "ready") return <WorkspaceDataUnavailablePage workspace={initialWorkspace} />;
    return (
      <PlanningApp
        initialData={supportingWorkspaceModelToPlanningShellState(initialWorkspace, supportingWorkspace.model)}
        initialHeaderData={supportingWorkspace.headerData}
        initialWorkspace={initialWorkspace}
        source="supabase"
        authRequired={false}
      />
    );
  }

  if (initialWorkspace === "sprint") {
    const sprint = await loadSprintPageData();
    if (sprint.status !== "ready") return <WorkspaceDataUnavailablePage workspace="sprint" />;
    return (
      <PlanningApp
        initialData={sprintWorkspaceModelToPlanningShellState(sprint.model)}
        initialHeaderData={sprint.headerData}
        initialWorkspace="sprint"
        initialSprintModel={sprint.model}
        source="supabase"
        authRequired={false}
      />
    );
  }

  const decisionLog = await loadDecisionLogPageData();
  if (decisionLog.status !== "ready") {
    return <WorkspaceDataUnavailablePage workspace={initialWorkspace} />;
  }
  return (
    <PlanningApp
      initialData={emptyPlanningShellState}
      initialHeaderData={decisionLog.headerData}
      initialWorkspace={initialWorkspace}
      source="supabase"
      authRequired={false}
      initialDecisionLogResult={decisionLog.decisionLog}
    />
  );
}
