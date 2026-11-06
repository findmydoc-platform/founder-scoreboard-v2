import { useState, useSyncExternalStore } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { createBrowserPlanningState } from "@/features/planning/model/internal/browser-planning-state";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { emptyPlanningHeaderData } from "@/lib/planning-header-data";
import { taskDetailStoryTask } from "@/features/tasks/molecules/task-detail-story-fixtures";
import type { BrowserApiClient } from "@/lib/browser-api-client";
import type { Profile } from "@/lib/types";
import { TaskCommentThread } from "./task-comment-thread";

const task = taskDetailStoryTask({ id: "reload-comment-task", title: "Reload recovery" });
const profile: Profile = { id: "reload-author", name: "Author", platformRole: "ceo", orgRole: "CEO", githubLogin: "author", weeklyCapacity: 40 };

// A real HTTP boundary permits browser acceptance checks to hold POST across a full reload.
function ReloadRecoveryFixture() {
  const [owner] = useState(() => {
    const browser = createBrowserPlanningState({ initialData: { ...emptyPlanningShellState, tasks: [task], profiles: [profile] }, initialHeaderData: emptyPlanningHeaderData, initialCurrentProfile: profile, initialUserId: "reload-user", initialWorkspace: "planning" });
    browser.runtime.session = { userId: "reload-user", revision: "reload-story-session", expiresAt: 4102444800, user: { id: "reload-user" } };
    browser.runtime.apiClient = {
      async requestJson<T>(input, options) {
        const response = await fetch(input, { method: options?.method, headers: { "Content-Type": "application/json" }, body: options?.json ? JSON.stringify(options.json) : undefined });
        return { response, body: await response.json() as T };
      },
      requestForm: async () => { throw new Error("Unexpected upload"); },
      requestBlob: async () => { throw new Error("Unexpected blob"); },
    } satisfies BrowserApiClient;
    return browser.owner;
  });
  useSyncExternalStore(owner.planning.subscribe, owner.internal.getSnapshot, owner.internal.getSnapshot);
  const discussion = owner.planning.taskComments(task.id);
  return <main className="mx-auto max-w-3xl p-4">
    <h1>Submitted comment reload recovery</h1>
    <h2>Task discussion</h2>
    <TaskCommentThread comments={[...discussion.comments]} commentCreations={owner.planning.taskCommentCreations(task.id)} commentCompleteness={discussion.completeness} onCheckCommentCreation={id => { void owner.planning.checkTaskCommentCreation(id); }} profiles={[profile]} tasks={[task]} currentProfileId={profile.id} onAddComment={async text => { const result = await owner.planning.createTaskComment(task, text); if (!result.ok) throw new Error(result.error); }} />
  </main>;
}

const meta = { title: "Features/Tasks/Organisms/TaskCommentReloadRecovery", component: ReloadRecoveryFixture, parameters: { layout: "fullscreen" } } satisfies Meta<typeof ReloadRecoveryFixture>;
export default meta;
type Story = StoryObj<typeof meta>;
export const FullBrowserReload: Story = {};
