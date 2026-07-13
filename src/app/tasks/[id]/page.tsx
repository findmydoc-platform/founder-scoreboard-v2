import { notFound } from "next/navigation";
import type { User } from "@supabase/supabase-js";
import { PlanningApp } from "@/features/planning/PlanningApp";
import { PlanningDataUnavailablePage } from "@/features/planning/templates/planning-data-unavailable-page";
import { TaskDetailPage } from "@/features/tasks/templates/task-detail-page";
import { SeedTaskDetailPage } from "@/features/tasks/templates/seed-task-detail-page";
import { PlanningTrashTaskDetailPage } from "@/features/planning-trash/templates/planning-trash-task-detail-page";
import { taskDetailPageDataScope } from "@/lib/planning-data-scopes";
import { emptyPlanningData, getPlanningData } from "@/lib/planning-data";
import { emptyPlanningHeaderData } from "@/lib/planning-header-data";
import { getServerPlanningAuth } from "@/lib/planning-auth-server";
import { getServerSupabase, hasSupabaseEnv, requiresSupabaseAuth } from "@/lib/supabase";
import { emptyTaskDetailData, loadTaskDetailData } from "@/lib/task-detail-data";
import { loadPlanningTrashTaskDetail } from "@/lib/planning-trash-detail";
import { mergeTaskDetailData } from "@/features/tasks/model/task-api-client";
import type { AuthenticatedProfile } from "@/lib/types";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function TaskPage({ params }: Props) {
  const { id } = await params;
  let authProfile: AuthenticatedProfile | null = null;
  let authUser: User | null = null;
  const authRequired = hasSupabaseEnv() && requiresSupabaseAuth();
  if (authRequired) {
    const auth = await getServerPlanningAuth(["ceo", "founder", "deputy", "viewer"]);
    if (!auth.ok) {
      return <PlanningApp initialData={emptyPlanningData} initialHeaderData={emptyPlanningHeaderData} initialWorkspace="planning" source="supabase" authRequired initialAuthUser={auth.user} initialAuthError={auth.error} />;
    }
    authProfile = auth.profile;
    authUser = auth.user;
  }

  const supabase = getServerSupabase();
  const planningDataPromise = getPlanningData(taskDetailPageDataScope, {
    workspace: "planning",
    currentProfileId: authProfile?.id || null,
    platformRole: authProfile?.platformRole || null,
  });
  const taskDetailPromise = supabase
    ? loadTaskDetailData(supabase, id)
    : Promise.resolve({ ok: true as const, data: emptyTaskDetailData });
  const [
    { availability, data, headerData, source },
    taskDetailResult,
  ] = await Promise.all([planningDataPromise, taskDetailPromise]);
  if (availability === "unavailable") {
    return <PlanningDataUnavailablePage workspace="planning" />;
  }
  const task = data.tasks.find((item) => item.id === id);

  if (!task && source === "seed") return <SeedTaskDetailPage taskId={id} />;
  if (!task) {
    if (!supabase) notFound();
    const trashDetailResult = await loadPlanningTrashTaskDetail(supabase, id, data.profiles);
    if (!trashDetailResult.ok) {
      if (trashDetailResult.status === 404) notFound();
      return <PlanningDataUnavailablePage workspace="planning" />;
    }
    return (
      <PlanningTrashTaskDetailPage
        detail={trashDetailResult.detail}
        currentPlatformRole={authProfile?.platformRole}
      />
    );
  }

  if (!taskDetailResult.ok && taskDetailResult.status === 404) notFound();
  const taskDetailData = taskDetailResult.ok ? taskDetailResult.data : emptyTaskDetailData;
  const initialData = mergeTaskDetailData(data, id, taskDetailData);

  return (
    <TaskDetailPage
      taskId={task.id}
      initialData={initialData}
      headerData={headerData}
      source={source}
      authRequired={authRequired}
      initialAuthUser={authUser}
      initialCurrentProfile={authProfile}
    />
  );
}
