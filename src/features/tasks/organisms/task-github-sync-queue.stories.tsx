import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, within } from "storybook/test";
import { TaskGitHubSyncQueue } from "./task-github-sync-queue";
const meta = {
  title: "Tasks/GitHub connection",
  component: TaskGitHubSyncQueue,
  args: {
    open:true, tasks:[],comments:[],pending:false,githubInstallationAvailable:true,
    githubUserConnected:false,githubConnectionState:"missing",waitingGitHubCommentCount:0,
    githubReauthFailed:false,authBusy:false,onClose:fn(),onOpenTask:fn(),onReconnect:fn(),
    onSyncLinkedGitHubTasks:fn(),onSyncTaskToGitHub:fn(),
  },
} satisfies Meta<typeof TaskGitHubSyncQueue>;
export default meta;
type Story = StoryObj<typeof meta>;
export const MissingAuthorConnection: Story = {
  play: async ({ canvasElement }) => {
    await expect(within(canvasElement).getByRole("dialog")).toBeVisible();
    await expect(within(canvasElement).getByText("Autorenverbindung fehlt",{exact:true})).toBeVisible();
  },
};
export const Connected: Story = { args: {githubUserConnected:true,githubConnectionState:"connected"} };
