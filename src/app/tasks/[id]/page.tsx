import { notFound } from "next/navigation";
import { TaskDetailPage } from "@/components/task-detail-page";
import { getPlanningData } from "@/lib/planning-data";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function TaskPage({ params }: Props) {
  const { id } = await params;
  const { data, source } = await getPlanningData();
  const task = data.tasks.find((item) => item.id === id);

  if (!task) notFound();

  return (
    <TaskDetailPage
      task={task}
      pack={data.packages.find((pack) => pack.id === task.packageId)}
      sprint={data.sprints.find((sprint) => sprint.id === task.sprintId)}
      subIssues={data.tasks.filter((item) => item.parentTaskId === task.id)}
      comments={data.taskComments.filter((comment) => comment.taskId === task.id)}
      blockers={data.taskBlockers.filter((blocker) => blocker.taskId === task.id)}
      profiles={data.profiles}
      sprints={data.sprints}
      milestones={data.milestones}
      source={source}
    />
  );
}
