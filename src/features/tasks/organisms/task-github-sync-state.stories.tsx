import { useEffect, useState, useSyncExternalStore } from "react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent, within } from "storybook/test";
import { createBrowserPlanningState, type BrowserPlanningState } from "@/features/planning/model/internal/browser-planning-state";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { emptyPlanningHeaderData } from "@/lib/planning-header-data";
import { taskDetailStoryTask } from "../molecules/task-detail-story-fixtures";
import { useTaskGitHubSyncCommand } from "../hooks/use-task-github-sync-command";
import { TaskGitHubSyncQueue } from "./task-github-sync-queue";
import type { TaskGitHubProjectionSuccess } from "@/lib/github-sync/contract";
import type { PlanningShellState } from "@/lib/types";
const task = taskDetailStoryTask({ id: "sync-story", title: "Sync mit gemeinsamer Bestätigung", updatedAt: "2026-10-28T10:00:00Z", githubRepo: "example/project", githubIssueNumber: 7, githubIssueUrl: "https://github.com/example/project/issues/7", githubIssueSyncStatus: "not_synced" });
const success: TaskGitHubProjectionSuccess = { ok: true, code: "github_sync_succeeded", issue: { repository: "example/project", number: 7, url: "https://github.com/example/project/issues/7", recovered: false, recreated: false }, task: { githubIssueSyncStatus: "synced", githubIssueSyncError: "", updatedAt: "2026-10-28T10:02:00Z" }, warnings: [], notices: [], commentDelivery: { delivered: 0, reconciled: 0, created: 0, waitingForAuthorConnection: 0, waitingForIssue: 0, retryScheduled: 0, failed: 0 } };
function Queue({ browser, data, onClose }: {
    browser: BrowserPlanningState;
    data: PlanningShellState;
    onClose: () => void;
}) {
    const [error, setError] = useState("");
    const commands = useTaskGitHubSyncCommand({ planningState: browser.owner.planning, setSaveError: setError, startTransition: callback => { void callback(); } });
    const connection = browser.owner.planning.githubConnection();
    return <><output aria-label="Sync action error">{error}</output><TaskGitHubSyncQueue open tasks={data.tasks} comments={data.taskComments} pending={browser.owner.planning.githubSyncBatch().phase === "running"} githubInstallationAvailable={connection.installationAvailable} githubUserConnected={connection.userConnected} githubConnectionState={connection.readStatus === "loading" ? "checking" : connection.state} waitingGitHubCommentCount={connection.waitingCommentCount} githubReauthFailed={false} authBusy={false} notice={commands.githubSyncNotice} onClose={onClose} onOpenTask={() => { }} onReconnect={() => { }} onSyncLinkedGitHubTasks={commands.syncLinkedGitHubTasks} onSyncTaskToGitHub={commands.syncTaskToGitHub} syncOperations={browser.owner.planning.taskGitHubSyncs()} onCheckSync={id => { void browser.owner.planning.checkTaskGitHubSync(id); }}/></>;
}
function Harness({ mode = "unknown" }: {
    mode?: "unknown" | "partial" | "bulk" | "navigation" | "retry";
}) {
    const [writes, setWrites] = useState(0), [reads, setReads] = useState(0), [statusReads, setStatusReads] = useState(0), [open, setOpen] = useState(true), [release, setRelease] = useState<(() => void) | null>(null);
    const [browser] = useState(() => {
        const parent = { ...task, id: "parent", title: "A Parent" }, child = { ...task, id: "child", title: "A Child", parentTaskId: "parent", taskType: "sub_issue" as const }, other = { ...task, id: "other", title: "B Independent" };
        const initialData = { ...emptyPlanningShellState, tasks: mode === "bulk" ? [child, other, parent] : [task] };
        const created = createBrowserPlanningState({ initialUserId: "sync-user", initialWorkspace: "planning", initialCurrentProfile: null, initialHeaderData: emptyPlanningHeaderData, initialData });
        created.runtime.session = { userId: "sync-user", revision: "sync-session", expiresAt: 4102444800, user: { id: "sync-user" } };
        let attempts = 0;
        created.runtime.apiClient = { ...created.runtime.apiClient, requestJson: async <T,>(input: Parameters<typeof created.runtime.apiClient.requestJson>[0], options: Parameters<typeof created.runtime.apiClient.requestJson>[1]) => {
                const path = String(input);
                let body: unknown;
                let status = 200;
                if (path === "/api/github-app/status") {
                    setStatusReads(n => n + 1);
                    body = { installation: { available: true }, user: { connected: true }, waitingCommentCount: 12 };
                }
                else if (path.endsWith("detail-data")) {
                    setReads(n => n + 1);
                    body = { taskDetail: { revision: "check", project: initialData.project, item: { ...task, ...success.task }, ancestors: [], children: [], relatedItems: [], people: [], sprints: [], discussion: { comments: [], externalComments: [] }, blockers: [], relationships: [], activity: [], reviews: [], coverage: { timeline: "complete", discussion: "complete" } } };
                }
                else {
                    expect(options?.expectedSession).toMatchObject({ userId: "sync-user", revision: "sync-session" });
                    attempts++;
                    setWrites(n => n + 1);
                    if (mode === "unknown")
                        throw new Error("Antwort verloren");
                    if (mode === "navigation")
                        await new Promise<void>(resolve => setRelease(() => resolve));
                    if (mode === "partial" && attempts === 1) {
                        status = 503;
                        body = { ok: false, code: "github_sync_unavailable", error: "Lock-Abschluss noch offen", retryable: true, task: success.task };
                    }
                    else if (mode === "retry" && attempts === 1 || mode === "bulk" && path.includes("/parent/")) {
                        status = 502;
                        body = { ok: false, code: "github_sync_failed", error: "GitHub vorübergehend nicht erreichbar", retryable: true, task: { githubIssueSyncStatus: "failed", githubIssueSyncError: "GitHub vorübergehend nicht erreichbar", updatedAt: "2026-10-28T10:01:00Z" } };
                    }
                    else
                        body = mode === "bulk" ? { ...success, commentDelivery: { ...success.commentDelivery, delivered: 3 } } : success;
                }
                return { response: new Response(null, { status }), body: body as T };
            } };
        return created;
    });
    const data = useSyncExternalStore(browser.owner.planning.subscribe, browser.owner.internal.getSnapshot, browser.owner.internal.getSnapshot);
    useEffect(() => { void browser.owner.planning.loadGitHubConnection(); }, [browser]);
    return <main className="min-h-screen p-4"><output aria-label="Projection writes">{writes}</output><output aria-label="Projection checks">{reads}</output><output aria-label="Connection reads">{statusReads}</output><output aria-label="Waiting total">{browser.owner.planning.githubConnection().waitingCommentCount ?? "unknown"}</output><output aria-label="Task projection">{data.tasks.map(task => `${task.id}:${task.githubIssueSyncStatus}`).join(",")}</output>{!open ? <><button className="min-h-11 p-2" onClick={() => setOpen(true)}>GitHub öffnen</button>{release ? <button className="min-h-11 p-2" onClick={release}>Serverantwort freigeben</button> : null}</> : <Queue browser={browser} data={data} onClose={() => setOpen(false)}/>}</main>;
}
const meta = { title: "Features/Tasks/Organisms/CoordinatedGitHubSync", component: Harness, parameters: { layout: "fullscreen" } } satisfies Meta<typeof Harness>;
export default meta;
type Story = StoryObj<typeof meta>;
export const UnknownChecksWithoutAnotherProjection: Story = { args: { mode: "unknown" }, play: async ({ canvasElement }) => { const canvas = within(canvasElement); await userEvent.click(await canvas.findByRole("button", { name: "Synchronisieren" })); await expect(await canvas.findByText("GitHub-Sync: Bestätigung ausstehend")).toBeVisible(); await userEvent.click(canvas.getByRole("button", { name: "GitHub schließen" })); await userEvent.click(canvas.getByRole("button", { name: "GitHub öffnen" })); await expect(await canvas.findByText("GitHub-Sync: Bestätigung ausstehend")).toBeVisible(); await userEvent.click(canvas.getByRole("button", { name: "Aktuellen Stand prüfen" })); await expect(await canvas.findByText(/beweist den früheren Vorgang/)).toBeVisible(); await expect(canvas.getByLabelText("Projection writes")).toHaveTextContent("1"); await expect(canvas.getByLabelText("Projection checks")).toHaveTextContent("1"); await expect(canvas.getByRole("button", { name: "Synchronisieren" })).toBeDisabled(); } };
export const FinalizedTaskSurvivesCleanupFailure: Story = { args: { mode: "partial" }, play: async ({ canvasElement }) => { const canvas = within(canvasElement); await userEvent.click(await canvas.findByRole("button", { name: "Synchronisieren" })); await expect(await canvas.findByRole("heading", { name: "GitHub-Sync teilweise bestätigt" })).toBeVisible(); await expect(canvas.getByLabelText("Task projection")).toHaveTextContent("sync-story:synced"); await expect(canvas.getByText("Lock-Abschluss noch offen", { selector: "p" })).toBeVisible(); await expect(canvas.getByLabelText("Projection writes")).toHaveTextContent("1"); } };
export const ExistingRetryRunsOnlyAfterDeliberateClick: Story = { args: { mode: "retry" }, play: async ({ canvasElement }) => { const canvas = within(canvasElement); await userEvent.click(await canvas.findByRole("button", { name: "Synchronisieren" })); await expect(await canvas.findByText("GitHub-Sync braucht Aufmerksamkeit")).toBeVisible(); const row = within(canvas.getByRole("article")); await userEvent.click(row.getByRole("button", { name: "Erneut versuchen" })); await expect(canvas.getByLabelText("Task projection")).toHaveTextContent("sync-story:synced"); await expect(canvas.getByLabelText("Projection writes")).toHaveTextContent("2"); } };
export const BulkSkipsChildAndKeepsRealWaitingCount: Story = { args: { mode: "bulk" }, play: async ({ canvasElement }) => { const canvas = within(canvasElement); await userEvent.click(await canvas.findByRole("button", { name: "3 Aktionen ausführen" })); await expect(await canvas.findByText(/Bestätigte Kommentarzustellung dieses Laufs: 3 zugestellt/)).toBeVisible(); await expect(canvas.getByLabelText("Projection writes")).toHaveTextContent("2"); await expect(canvas.getByLabelText("Connection reads")).toHaveTextContent("2"); await expect(canvas.getByLabelText("Waiting total")).toHaveTextContent("12"); await expect(canvas.getByLabelText("Task projection")).toHaveTextContent("child:not_synced"); await expect(canvas.getByLabelText("Task projection")).toHaveTextContent("other:synced"); } };
export const HeldProjectionSurvivesQueueRemount: Story = { args: { mode: "navigation" }, play: async ({ canvasElement }) => { const canvas = within(canvasElement); await userEvent.click(await canvas.findByRole("button", { name: "Synchronisieren" })); await userEvent.click(canvas.getByRole("button", { name: "GitHub schließen" })); await userEvent.click(await canvas.findByRole("button", { name: "Serverantwort freigeben" })); await expect(canvas.getByLabelText("Task projection")).toHaveTextContent("sync-story:synced"); await userEvent.click(canvas.getByRole("button", { name: "GitHub öffnen" })); await expect(await canvas.findByText("Alle geladenen freigegebenen Aufgaben sind mit GitHub abgeglichen.")).toBeVisible(); await expect(canvas.getByLabelText("Projection writes")).toHaveTextContent("1"); } };
