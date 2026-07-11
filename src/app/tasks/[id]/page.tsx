import { notFound } from "next/navigation";
import { PlanningApp } from "@/features/planning/PlanningApp";
import { PlanningDataUnavailablePage } from "@/features/planning/templates/planning-data-unavailable-page";
import { TaskDetailPage } from "@/features/tasks/templates/task-detail-page";
import { taskDetailPageDataScope } from "@/lib/planning-data-scopes";
import { emptyPlanningData, getPlanningData } from "@/lib/planning-data";
import { emptyPlanningHeaderData } from "@/lib/planning-header-data";
import { getServerPlanningAuth } from "@/lib/planning-auth-server";
import { getServerSupabase, hasSupabaseEnv, requiresSupabaseAuth } from "@/lib/supabase";
import { emptyTaskDetailData, loadTaskDetailData } from "@/lib/task-detail-data";
import type { AuthenticatedProfile } from "@/lib/types";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function TaskPage({ params }: Props) {
  const { id } = await params;
  let authProfile: AuthenticatedProfile | null = null;
  if (hasSupabaseEnv() && requiresSupabaseAuth()) {
    const auth = await getServerPlanningAuth(["ceo", "founder", "deputy", "viewer"]);
    if (!auth.ok) {
      return <PlanningApp initialData={emptyPlanningData} initialHeaderData={emptyPlanningHeaderData} initialWorkspace="planning" source="supabase" authRequired initialAuthUser={auth.user} initialAuthError={auth.error} />;
    }
    authProfile = auth.profile;
  }

  const { availability, data, headerData, source } = await getPlanningData(taskDetailPageDataScope, {
    workspace: "planning",
    currentProfileId: authProfile?.id || null,
    platformRole: authProfile?.platformRole || null,
  });
  if (availability === "unavailable") {
    return <PlanningDataUnavailablePage workspace="planning" />;
  }
  const task = data.tasks.find((item) => item.id === id);

  if (!task) notFound();

  const supabase = getServerSupabase();
  const taskDetailResult = supabase ? await loadTaskDetailData(supabase, id) : { ok: true as const, data: emptyTaskDetailData };
  if (!taskDetailResult.ok && taskDetailResult.status === 404) notFound();
  const taskDetailData = taskDetailResult.ok ? taskDetailResult.data : emptyTaskDetailData;

  return (
    <TaskDetailPage
      task={task}
      pack={data.packages.find((pack) => pack.id === task.packageId)}
      packages={data.packages}
      sprint={data.sprints.find((sprint) => sprint.id === task.sprintId)}
      subIssues={data.tasks.filter((item) => item.parentTaskId === task.id)}
      comments={taskDetailData.taskComments}
      externalComments={taskDetailData.taskExternalComments}
      activities={taskDetailData.taskActivity}
      blockers={taskDetailData.taskBlockers}
      taskRelations={taskDetailData.taskRelations}
      allTasks={data.tasks}
      profiles={data.profiles}
      sprints={data.sprints}
      milestones={data.milestones}
      headerData={headerData}
      source={source}
      currentProfile={authProfile}
    />
  );
}
