import { useSyncExternalStore } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useTaskCommentRecoveryStory } from "@/features/tasks/hooks/use-task-comment-recovery-story";
import { taskDetailStoryTask } from "@/features/tasks/molecules/task-detail-story-fixtures";
import type { Profile } from "@/lib/types";
import { TaskCommentThread } from "./task-comment-thread";

const task = taskDetailStoryTask({ id: "reload-comment-task", title: "Reload recovery" });
const profile: Profile = { id: "reload-author", name: "Author", platformRole: "ceo", orgRole: "CEO", githubLogin: "author", weeklyCapacity: 40 };

// A real HTTP boundary permits browser acceptance checks to hold POST across a full reload.
function ReloadRecoveryFixture() {
  const owner = useTaskCommentRecoveryStory(task, profile);
  useSyncExternalStore(owner.planning.subscribe, owner.internal.getSnapshot, owner.internal.getSnapshot);
  const discussion = owner.planning.taskComments(task.id);
  return <main className="mx-auto max-w-3xl p-4">
    <h1>Submitted comment reload recovery</h1>
    <h2>Task discussion</h2>
    <button onClick={() => { void owner.planning.loadTaskDetail(task.id); }}>Diskussion laden</button>
    <TaskCommentThread comments={[...discussion.comments]} commentCreations={owner.planning.taskCommentCreations(task.id)} commentCompleteness={discussion.completeness} onRetryCommentCreation={id=>{void owner.planning.retryTaskCommentCreation(id);}} onCheckCommentCreation={id => { void owner.planning.checkTaskCommentCreation(id); }} profiles={[profile]} tasks={[task]} currentProfileId={profile.id} onAddComment={text => owner.planning.createTaskComment(task, text)} />
  </main>;
}

const meta = { title: "Features/Tasks/Organisms/TaskCommentReloadRecovery", component: ReloadRecoveryFixture, parameters: { layout: "fullscreen" } } satisfies Meta<typeof ReloadRecoveryFixture>;
export default meta;
type Story = StoryObj<typeof meta>;
export const FullBrowserReload: Story = {};
