import { PlanningApp } from "@/features/planning/PlanningApp";
import { PlanningDataUnavailablePage } from "@/features/planning/templates/planning-data-unavailable-page";
import type { AppWorkspace } from "@/features/planning/model/workspace-routes";
import { backlogModelToPlanningData } from "@/features/backlog/model/backlog-planning-data-adapter";
import { createSupabaseBacklogReadModel } from "@/features/backlog/server/backlog-read-model-supabase";
import { planningWorkspaceModelToPlanningData } from "@/features/planning-items/model/planning-workspace-data-adapter";
import { createSupabasePlanningBoardReadModel } from "@/features/planning/server/planning-board-read-model-supabase";
import { createSupabaseStrategicPlanningReadModel } from "@/features/projects/server/strategic-planning-read-model-supabase";
import { supportingWorkspaceModelToPlanningData, type SupportingWorkspace } from "@/features/planning/model/supporting-workspace-data-adapters";
import { createSupabaseEventsReadModel } from "@/features/events/server/events-read-model-supabase";
import { createSupabaseToolsReadModel } from "@/features/tools/server/tools-read-model-supabase";
import { createSupabaseTeamReadModel } from "@/features/team/server/team-read-model-supabase";
import { createSupabaseProfileReadModel } from "@/features/profile/server/profile-read-model-supabase";
import { createSupabaseNotificationsReadModel } from "@/features/notifications/server/notifications-read-model-supabase";
import { sprintWorkspaceModelToPlanningData } from "@/features/sprint/model/sprint-planning-data-adapter";
import { createSupabaseSprintReadModel } from "@/features/sprint/server/sprint-read-model-supabase";
import { getPlanningDataScopeForWorkspace, type LegacyPlanningDataWorkspace } from "@/lib/planning-data-scopes";
import { emptyPlanningData, getPlanningData, type PlanningDataLoadOptions } from "@/lib/planning-data";
import { emptyPlanningHeaderData, loadPlanningHeaderData } from "@/lib/planning-header-data";
import { sharedPlanningHeaderSlotLoaders } from "@/lib/planning-header-cache";
import { getServerPlanningAuth } from "@/lib/planning-auth-server";
import { loadNotionDecisionLog } from "@/lib/notion-decision-log";
import { getServerSupabase, requiresSupabaseAuth } from "@/lib/supabase";
import type { AuthenticatedProfile } from "@/lib/types";

function loadWorkspacePlanningData(
  initialWorkspace: LegacyPlanningDataWorkspace,
  profile?: AuthenticatedProfile | null,
  options?: PlanningDataLoadOptions,
) {
  return getPlanningData(getPlanningDataScopeForWorkspace(initialWorkspace), {
    workspace: initialWorkspace,
    currentProfileId: profile?.id || null,
    platformRole: profile?.platformRole || null,
  }, {
    ...options,
    sharedHeaderSlotLoaders: sharedPlanningHeaderSlotLoaders,
  });
}

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

export async function renderWorkspacePage(initialWorkspace: AppWorkspace) {
  if (requiresSupabaseAuth()) {
    const auth = await getServerPlanningAuth(["ceo", "founder", "deputy", "viewer"]);
    if (!auth.ok) {
      return (
        <PlanningApp
          initialData={emptyPlanningData}
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
        return <PlanningDataUnavailablePage workspace="backlog" authUserEmail={auth.user?.email || ""} />;
      }
      return (
        <PlanningApp
          initialData={backlogModelToPlanningData(backlog.model)}
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
        return <PlanningDataUnavailablePage workspace={initialWorkspace} authUserEmail={auth.user?.email || ""} />;
      }
      return (
        <PlanningApp
          initialData={planningWorkspaceModelToPlanningData(planningWorkspace.model)}
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
        return <PlanningDataUnavailablePage workspace={initialWorkspace} authUserEmail={auth.user?.email || ""} />;
      }
      return (
        <PlanningApp
          initialData={supportingWorkspaceModelToPlanningData(initialWorkspace, supportingWorkspace.model)}
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
      if (sprint.status !== "ready") return <PlanningDataUnavailablePage workspace="sprint" authUserEmail={auth.user?.email || ""} />;
      return (
        <PlanningApp
          initialData={sprintWorkspaceModelToPlanningData(sprint.model)}
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

    const [{ availability, data, headerData, source }, initialDecisionLogResult] = await Promise.all([
      loadWorkspacePlanningData(initialWorkspace, auth.profile, { headerData: "deferred" }),
      initialWorkspace === "decision-log" ? loadNotionDecisionLog() : Promise.resolve(undefined),
    ]);
    if (availability === "unavailable") {
      return <PlanningDataUnavailablePage workspace={initialWorkspace} authUserEmail={auth.user?.email || ""} />;
    }
    return (
      <PlanningApp
        initialData={data}
        initialHeaderData={headerData}
        initialWorkspace={initialWorkspace}
        source={source}
        authRequired
        initialAuthUser={auth.user}
        initialCurrentProfile={auth.profile}
        initialProtectedDataLoaded
        initialDecisionLogResult={initialDecisionLogResult}
      />
    );
  }

  if (initialWorkspace === "backlog") {
    const backlog = await loadBacklogPageData();
    if (backlog.status !== "ready") return <PlanningDataUnavailablePage workspace="backlog" />;
    return (
      <PlanningApp
        initialData={backlogModelToPlanningData(backlog.model)}
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
    if (planningWorkspace.status !== "ready") return <PlanningDataUnavailablePage workspace={initialWorkspace} />;
    return (
      <PlanningApp
        initialData={planningWorkspaceModelToPlanningData(planningWorkspace.model)}
        initialHeaderData={planningWorkspace.headerData}
        initialWorkspace={initialWorkspace}
        source="supabase"
        authRequired={false}
      />
    );
  }

  if (initialWorkspace === "events" || initialWorkspace === "tools" || initialWorkspace === "team" || initialWorkspace === "profile" || initialWorkspace === "notifications") {
    const supportingWorkspace = await loadSupportingWorkspacePageData(initialWorkspace);
    if (supportingWorkspace.status !== "ready") return <PlanningDataUnavailablePage workspace={initialWorkspace} />;
    return (
      <PlanningApp
        initialData={supportingWorkspaceModelToPlanningData(initialWorkspace, supportingWorkspace.model)}
        initialHeaderData={supportingWorkspace.headerData}
        initialWorkspace={initialWorkspace}
        source="supabase"
        authRequired={false}
      />
    );
  }

  if (initialWorkspace === "sprint") {
    const sprint = await loadSprintPageData();
    if (sprint.status !== "ready") return <PlanningDataUnavailablePage workspace="sprint" />;
    return (
      <PlanningApp
        initialData={sprintWorkspaceModelToPlanningData(sprint.model)}
        initialHeaderData={sprint.headerData}
        initialWorkspace="sprint"
        initialSprintModel={sprint.model}
        source="supabase"
        authRequired={false}
      />
    );
  }

  const [{ availability, data, headerData, source }, initialDecisionLogResult] = await Promise.all([
    loadWorkspacePlanningData(initialWorkspace),
    initialWorkspace === "decision-log" ? loadNotionDecisionLog() : Promise.resolve(undefined),
  ]);
  if (availability === "unavailable") {
    return <PlanningDataUnavailablePage workspace={initialWorkspace} />;
  }
  return (
    <PlanningApp
      initialData={data}
      initialHeaderData={headerData}
      initialWorkspace={initialWorkspace}
      source={source}
      authRequired={false}
      initialDecisionLogResult={initialDecisionLogResult}
    />
  );
}
