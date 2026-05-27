import { PlanningApp } from "@/components/planning-app";
import { TaskDetailPage } from "@/components/task-detail-page";
import { emptyPlanningData, getPlanningData } from "@/lib/planning-data";
import { hasSupabaseEnv, requiresSupabaseAuth } from "@/lib/supabase";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ view?: string }>;
};

export default async function TaskPage({ params, searchParams }: Props) {
  const { id } = await params;
  const { view } = await searchParams;
  if (hasSupabaseEnv() && requiresSupabaseAuth()) {
    return <PlanningApp key={id} initialData={emptyPlanningData} source="supabase" authRequired initialTaskId={id} />;
  }

  const { data, source } = await getPlanningData();
  const task = data.tasks.find((item) => item.id === id);

  if (view === "full" && task) {
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
        decisions={data.decisions}
        decisionTaskLinks={data.decisionTaskLinks}
        focusItems={data.taskFocusItems}
        source={source}
      />
    );
  }

  return <PlanningApp key={id} initialData={data} source={source} authRequired={false} initialTaskId={id} />;
}
