import { notFound } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { PlanningApp } from "@/features/planning/PlanningApp";
import { WorkspaceDataUnavailablePage } from "@/features/planning/templates/workspace-data-unavailable-page";
import { TaskDetailPage } from "@/features/tasks/templates/task-detail-page";
import { safeTaskDetailReturnTo } from "@/features/tasks/model/task-detail-return-navigation";
import { PlanningTrashTaskDetailPage } from "@/features/planning-trash/templates/planning-trash-task-detail-page";
import { taskDetailDegradationMessage } from "@/features/tasks/model/task-detail-planning-shell-projection";
import { createSupabaseTaskDetailReadModel } from "@/features/tasks/server/task-detail-read-model-supabase";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { emptyPlanningHeaderData, loadPlanningHeaderData } from "@/lib/planning-header-data";
import { getServerPlanningAuth } from "@/lib/planning-auth-server";
import { getServerSupabase, requiresSupabaseAuth } from "@/lib/supabase";
import { loadPlanningTrashTaskDetail } from "@/lib/planning-trash-detail";
import type { AuthenticatedProfile } from "@/lib/types";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ returnTo?: string | string[] }>;
};

export default async function TaskPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { returnTo } = await searchParams;
  const safeReturnTo = safeTaskDetailReturnTo(returnTo);
  let authProfile: AuthenticatedProfile | null = null;
  let authUser: User | null = null;
  const authRequired = requiresSupabaseAuth();
  if (authRequired) {
    const auth = await getServerPlanningAuth(["ceo", "founder", "deputy", "viewer"]);
    if (!auth.ok) {
      return <PlanningApp initialData={emptyPlanningShellState} initialHeaderData={emptyPlanningHeaderData} initialWorkspace="planning" source="supabase" authRequired initialAuthUser={auth.user} initialAuthError={auth.error} />;
    }
    authProfile = auth.profile;
    authUser = auth.user;
  }

  const supabase = getServerSupabase();
  if (!supabase) {
    return <WorkspaceDataUnavailablePage workspace="planning" />;
  }
  const [taskDetailResult, headerData] = await Promise.all([
    createSupabaseTaskDetailReadModel(supabase).load(
      { itemId: id },
      { authorized: true, actorProfileId: authProfile?.id || null },
    ),
    loadPlanningHeaderData(supabase, {
      currentProfileId: authProfile?.id || null,
      platformRole: authProfile?.platformRole || null,
    }),
  ]);
  if (taskDetailResult.status === "unavailable" || taskDetailResult.status === "forbidden") {
    return <WorkspaceDataUnavailablePage workspace="planning" />;
  }

  if (taskDetailResult.status === "notFound") {
    const trashDetailResult = await loadPlanningTrashTaskDetail(supabase, id, [...taskDetailResult.people]);
    if (!trashDetailResult.ok) {
      if (trashDetailResult.status === 404) notFound();
      return <WorkspaceDataUnavailablePage workspace="planning" />;
    }
    return (
      <PlanningTrashTaskDetailPage
        detail={trashDetailResult.detail}
        profiles={[...taskDetailResult.people]}
        currentPlatformRole={authProfile?.platformRole}
      />
    );
  }

  return (
    <TaskDetailPage
      taskId={taskDetailResult.model.item.id}
      initialModel={taskDetailResult.model}
      headerData={headerData}
      source="supabase"
      authRequired={authRequired}
      initialAuthUser={authUser}
      initialCurrentProfile={authProfile}
      initialDetailDataError={taskDetailResult.status === "degraded"
        ? taskDetailDegradationMessage(taskDetailResult.unavailable)
        : ""}
      returnHref={safeReturnTo || "/planning"}
      returnLabel={safeReturnTo ? "Zurück zum Release" : "Zur Planung"}
    />
  );
}
