import { notFound } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { PlanningApp } from "@/features/planning/PlanningApp";
import { PlanningDataUnavailablePage } from "@/features/planning/templates/planning-data-unavailable-page";
import { TaskDetailPage } from "@/features/tasks/templates/task-detail-page";
import { PlanningTrashTaskDetailPage } from "@/features/planning-trash/templates/planning-trash-task-detail-page";
import { taskDetailDegradationMessage } from "@/features/tasks/model/task-detail-planning-data-adapter";
import { createSupabaseTaskDetailReadModel } from "@/features/tasks/server/task-detail-read-model-supabase";
import { emptyPlanningData } from "@/lib/planning-data";
import { emptyPlanningHeaderData, loadPlanningHeaderData } from "@/lib/planning-header-data";
import { getServerPlanningAuth } from "@/lib/planning-auth-server";
import { getServerSupabase, requiresSupabaseAuth } from "@/lib/supabase";
import { loadPlanningTrashTaskDetail } from "@/lib/planning-trash-detail";
import type { AuthenticatedProfile } from "@/lib/types";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function TaskPage({ params }: Props) {
  const { id } = await params;
  let authProfile: AuthenticatedProfile | null = null;
  let authUser: User | null = null;
  const authRequired = requiresSupabaseAuth();
  if (authRequired) {
    const auth = await getServerPlanningAuth(["ceo", "founder", "deputy", "viewer"]);
    if (!auth.ok) {
      return <PlanningApp initialData={emptyPlanningData} initialHeaderData={emptyPlanningHeaderData} initialWorkspace="planning" source="supabase" authRequired initialAuthUser={auth.user} initialAuthError={auth.error} />;
    }
    authProfile = auth.profile;
    authUser = auth.user;
  }

  const supabase = getServerSupabase();
  if (!supabase) {
    return <PlanningDataUnavailablePage workspace="planning" />;
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
    return <PlanningDataUnavailablePage workspace="planning" />;
  }

  if (taskDetailResult.status === "notFound") {
    const trashDetailResult = await loadPlanningTrashTaskDetail(supabase, id, [...taskDetailResult.people]);
    if (!trashDetailResult.ok) {
      if (trashDetailResult.status === 404) notFound();
      return <PlanningDataUnavailablePage workspace="planning" />;
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
    />
  );
}
