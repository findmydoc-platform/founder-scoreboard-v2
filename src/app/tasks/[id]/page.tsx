import { notFound } from "next/navigation";
import { PlanningApp } from "@/features/planning/PlanningApp";
import { TaskDetailPage } from "@/features/tasks/templates/task-detail-page";
import { emptyPlanningData, getPlanningData } from "@/lib/planning-data";
import { getServerPlanningAuth } from "@/lib/planning-auth-server";
import { hasSupabaseEnv, requiresSupabaseAuth } from "@/lib/supabase";

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

  const { data, source } = await getPlanningData();
  const task = data.tasks.find((item) => item.id === id);

  if (!task) notFound();

  return (
    <TaskDetailPage
      task={task}
      pack={data.packages.find((pack) => pack.id === task.packageId)}
      packages={data.packages}
      sprint={data.sprints.find((sprint) => sprint.id === task.sprintId)}
      subIssues={data.tasks.filter((item) => item.parentTaskId === task.id)}
      comments={data.taskComments.filter((comment) => comment.taskId === task.id)}
      externalComments={data.taskExternalComments.filter((comment) => comment.taskId === task.id)}
      activities={data.taskActivity.filter((activity) => activity.taskId === task.id)}
      blockers={data.taskBlockers.filter((blocker) => blocker.taskId === task.id)}
      taskRelations={data.taskRelations}
      allTasks={data.tasks}
      profiles={data.profiles}
      sprints={data.sprints}
      milestones={data.milestones}
      source={source}
    />
  );
}
