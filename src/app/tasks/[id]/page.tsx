import { notFound } from "next/navigation";
import { PlanningApp } from "@/features/planning/PlanningApp";
import { TaskDetailPage } from "@/features/tasks/templates/task-detail-page";
import { taskDetailPageDataScope } from "@/lib/planning-data-scopes";
import { emptyPlanningData, getPlanningData } from "@/lib/planning-data";
import { getServerPlanningAuth } from "@/lib/planning-auth-server";
import { getServerSupabase, hasSupabaseEnv, requiresSupabaseAuth } from "@/lib/supabase";
import { emptyTaskDetailData, loadTaskDetailData } from "@/lib/task-detail-data";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function TaskPage({ params }: Props) {
  const { id } = await params;
  if (hasSupabaseEnv() && requiresSupabaseAuth()) {
    const auth = await getServerPlanningAuth(["ceo", "founder", "deputy", "viewer"]);
    if (!auth.ok) {
      return <PlanningApp initialData={emptyPlanningData} initialWorkspace="planning" source="supabase" authRequired initialAuthUser={auth.user} initialAuthError={auth.error} />;
    }
  }

  const { data, source } = await getPlanningData(taskDetailPageDataScope);
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
      source={source}
    />
  );
}
