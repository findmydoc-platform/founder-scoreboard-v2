import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState, useTransition } from "react";
import { useTaskDetailDataLoader } from "@/features/tasks/hooks/use-task-detail-data-loader";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import type { BrowserApiClient } from "@/lib/browser-api-client";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { taskDetailStoryTask } from "@/features/tasks/molecules/task-detail-story-fixtures";
import type { PlanningShellState, Profile } from "@/lib/types";
import { TaskDetailSurface } from "./task-detail-surface";

const profiles: Profile[] = [
  { id: "sebastian", name: "Sebastian Schütze", platformRole: "ceo", orgRole: "CEO", githubLogin: "SebastianSchuetze", weeklyCapacity: 40 },
  { id: "volkan", name: "Mehmet Volkan Kablan", platformRole: "founder", orgRole: "Engineering", githubLogin: "MehmetVolkan", weeklyCapacity: 40 },
  { id: "volker", name: "Volker Beispiel", platformRole: "founder", orgRole: "Operations", githubLogin: "volker", weeklyCapacity: 32 },
];

const task = taskDetailStoryTask({
  id: "mention-task",
  title: "Review-Prozess für die nächste Produktphase vorbereiten",
  description: "Der Review-Prozess soll für Founder und Deputies klar, nachvollziehbar und direkt mit GitHub verbunden sein.",
  problemStatement: "Entscheidungen und Rückfragen liegen derzeit an mehreren Stellen.",
  intendedOutcome: "Review, Kommentar und Zustellung sind in einer Aktivität nachvollziehbar.",
  scopeConstraints: "Keine neue Navigation und keine Änderung an bestehenden Rollen.",
  acceptanceCriteria: "Review-Kommentare unterstützen Erwähnungen\nBenachrichtigungen springen an die Fundstelle",
  evidenceRequired: "Screenshot der Aktivität und erfolgreiche GitHub-Zustellung",
  definitionOfDone: "Desktop und Mobile geprüft\nKontraste erfüllen WCAG 2.2 AA",
  assignee: "sebastian",
  owner: "sebastian",
  githubRepo: "findmydoc-platform/management",
  githubIssueNumber: 418,
  githubIssueUrl: "https://github.com/findmydoc-platform/management/issues/418",
  githubIssueSyncStatus: "synced",
  githubIssueLastSyncedAt: "2026-09-24T09:30:00.000Z",
});

const reviewTask = taskDetailStoryTask({
  ...task,
  id: "mention-review-task",
  status: "Review",
  reviewStatus: "requested",
  reviewOwnerProfileId: "sebastian",
  reviewRequestedAt: "2026-09-24T11:30:00.000Z",
});

const meta = {
  component: TaskDetailSurface,
  decorators: [(Story) => (
    <main className="min-h-screen bg-slate-100 p-6">
      <div className="mx-auto max-w-[1320px] rounded-xl border border-slate-200 bg-white p-6 shadow-sm">
        <Story />
      </div>
    </main>
  )],
  parameters: { layout: "fullscreen" },
  tags: ["domain:tasks", "layer:organism", "status:stable"],
  title: "Features/Tasks/Organisms/TaskDetailSurface",
  args: {
    surface: "page",
    task,
    comments: [{
      id: 1,
      taskId: task.id,
      profileId: "volkan",
      comment: "Die Prüfkriterien sind abgestimmt. Bitte die GitHub-Zustellung im Review mitprüfen.",
      githubDeliveryStatus: "delivered",
      githubCommentUrl: "https://github.com/findmydoc-platform/management/issues/418#issuecomment-1",
      createdAt: "2026-09-24T10:15:00.000Z",
    }],
    externalComments: [],
    activities: [{
      id: 1,
      taskId: task.id,
      action: "task.status_changed",
      actorProfileId: "sebastian",
      message: "Status geändert: Offen → In Arbeit",
      createdAt: "2026-09-24T09:45:00.000Z",
    }],
    reviews: [],
    blockers: [],
    subIssues: [],
    teamProfiles: profiles,
    sprints: [],
    allTasks: [task],
    relations: [],
    currentProfile: { id: "sebastian", name: "Sebastian Schütze", platformRole: "ceo" },
    pending: false,
    githubInstallationAvailable: true,
    onRequestDiscardAction: (action) => action(),
    onUpdate: fn(),
    onAddComment: fn(),
    onUploadAttachment: fn(async () => ""),
    onImportGitHubComments: fn(),
    onReportBlocker: fn(async () => ({ ok: true as const })),
    onCreateSubIssue: fn(),
    onOpenTask: fn(),
    onSyncGitHub: fn(),
    onReview: fn(),
    onReopenReview: fn(),
    onWithdrawReview: fn(),
    onWithdraw: fn(),
    onAddRelation: fn(async () => ({ ok: true as const })),
    onRemoveRelation: fn(),
    onDecideApproval: fn(),
  },
} satisfies Meta<typeof TaskDetailSurface>;

export default meta;
type Story = StoryObj<typeof meta>;

export const ActivityMentionPicker: Story = {
  args: {
    activities: [],
    comments: [],
    requestedCommentTarget: "comment:new",
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const textbox = await canvas.findByRole("textbox", { name: "Kommentar oder Update" });
    textbox.scrollIntoView({ block: "center" });
    await userEvent.type(textbox, "@");
    await expect(canvas.getByRole("listbox", { name: "Person erwähnen" })).toBeVisible();
    await expect(canvas.getByRole("option", { name: "@all, Alle Personen in FounderOps, 3 Personen" })).toBeVisible();
  },
};

export const ReviewMentionPicker: Story = {
  args: {
    task: reviewTask,
    allTasks: [reviewTask],
  },
  parameters: {
    a11y: { test: "todo" },
  },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const textbox = await canvas.findByRole("textbox", { name: "Review-Kommentar" });
    await userEvent.type(textbox, "@");
    canvasElement.ownerDocument.defaultView?.scrollTo({ top: 390 });
    await expect(canvas.getByRole("listbox", { name: "Person erwähnen" })).toBeVisible();
  },
};

export const OversizedBrief: Story = {
  args: {
    task: { ...task, problemStatement: "Prüfbarer Kontext. ".repeat(3641) },
    onUpdate: fn(async () => ({ ok: true as const, task: {} })),
  },
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Bearbeiten" }));
    const title = canvas.getByRole("textbox", { name: "Titel" });
    await userEvent.type(title, " aktualisiert");
    await userEvent.click(canvas.getByRole("button", { name: "Speichern" }));
    await expect(canvas.getByRole("alert")).toHaveTextContent("maximal 65.536 Zeichen");
    await expect(canvas.getByRole("textbox", { name: "Problem" })).toHaveValue(args.task.problemStatement);
    await expect(args.onUpdate).not.toHaveBeenCalled();
  },
};

export const CorrectOversizedBrief: Story = {
  args: OversizedBrief.args,
  play: async (context) => {
    await OversizedBrief.play!(context);
    const canvas = within(context.canvasElement);
    const problem = canvas.getByRole("textbox", { name: "Problem" });
    await userEvent.clear(problem);
    await userEvent.type(problem, "Vollständiger, gekürzter Kontext.");
    await userEvent.click(canvas.getByRole("button", { name: "Speichern" }));
    await expect(context.args.onUpdate).toHaveBeenCalledWith(expect.objectContaining({ problemStatement: "Vollständiger, gekürzter Kontext." }));
  },
};

export const SummaryLoading: Story = {
  args: { task: { ...task, detailAvailability: "summary" }, detailDataLoading: true },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("status")).toHaveTextContent("Aufgabendetails werden geladen");
    await expect(canvas.queryByRole("button", { name: /bearbeiten/i })).not.toBeInTheDocument();
    await expect(canvas.queryByText(task.problemStatement!)).not.toBeInTheDocument();
  },
};

export const SummaryFailure: Story = {
  args: { task: { ...task, detailAvailability: "summary" }, detailDataError: "Task-Details konnten nicht geladen werden.", onRetryDetailData: fn() },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(canvas.getByRole("status")).toHaveTextContent("Task-Details konnten nicht geladen werden.");
    await expect(canvas.queryByRole("button", { name: /bearbeiten/i })).not.toBeInTheDocument();
  },
};

function SummaryRefreshHarness({ failFirst = false, failSave = false, ...args }: React.ComponentProps<typeof TaskDetailSurface> & { failFirst?: boolean; failSave?: boolean }) {
  const [data, setData] = useState<PlanningShellState>(() => ({ ...emptyPlanningShellState, tasks: [{ ...task, detailAvailability: "summary" as const }] }));
  const [requests, setRequests] = useState(0);
  const [dirty, setDirty] = useState(false);
  const [, startTransition] = useTransition();
  const [apiClient] = useState(() => {
    let attempts = 0;
    return {
    requestBlob: async () => { throw new Error("Unexpected blob request"); },
    requestForm: async () => { throw new Error("Unexpected form request"); },
    requestJson: async <T,>() => {
      attempts += 1;
      setRequests((count) => count + 1);
      if (failFirst && attempts === 1) return { response: new Response(null, { status: 503 }), body: { error: "Details vorübergehend nicht verfügbar." } as T };
      return {
        response: new Response(null, { status: 200 }),
        body: { taskDetail: {
          revision: "revision", project: emptyPlanningShellState.project, item: task,
          ancestors: [], children: [], relatedItems: [], people: [], sprints: [],
          discussion: { comments: [], externalComments: [] }, blockers: [], relationships: [], activity: [], reviews: [],
        } } as T,
      };
    },
  } satisfies BrowserApiClient;
  });
  const selectedTask = data.tasks[0];
  const loader = useTaskDetailDataLoader({ apiClient, applyPlanningShellStateUpdate: setData, selectedTask, source: "supabase", startTransition });
  return (
    <>
      <button onClick={() => setData((current) => ({ ...current, tasks: [{ ...task, detailAvailability: "summary" }] }))}>Refresh workspace summary</button>
      <output aria-label="Detail requests">{requests}</output>
      <output aria-label="Unsaved draft">{String(dirty)}</output>
      <TaskDetailSurface {...args} task={selectedTask} detailDataLoading={loader.selectedTaskDetailLoading} detailDataError={loader.selectedTaskDetailError} onRetryDetailData={loader.retrySelectedTaskDetail} onOverviewDirtyChange={setDirty} onUpdate={failSave ? async () => {
        setData((current) => ({ ...current, tasks: [{ ...task, detailAvailability: "summary" }] }));
        return { ok: false, status: 409, error: "Aufgabe wurde zwischenzeitlich geändert." };
      } : args.onUpdate} />
    </>
  );
}

export const HydratesAgainAfterWorkspaceRefresh: Story = {
  render: (args) => <SummaryRefreshHarness {...args} />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText(task.problemStatement!)).toBeVisible();
    await waitFor(() => expect(canvas.getByLabelText("Detail requests")).toHaveTextContent(/^1$/));
    await userEvent.click(canvas.getByRole("button", { name: "Refresh workspace summary" }));
    await expect(await canvas.findByText(task.problemStatement!)).toBeVisible();
    await waitFor(() => expect(canvas.getByLabelText("Detail requests")).toHaveTextContent(/^2$/));
  },
};

export const RetriesFailedSummaryHydration: Story = {
  render: (args) => <SummaryRefreshHarness {...args} failFirst />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText("Details vorübergehend nicht verfügbar.")).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Erneut laden" }));
    await expect(await canvas.findByText(task.problemStatement!)).toBeVisible();
    await waitFor(() => expect(canvas.getByLabelText("Detail requests")).toHaveTextContent(/^2$/));
    await expect(canvas.queryByRole("button", { name: "Erneut laden" })).not.toBeInTheDocument();
  },
};

export const PreservesDraftAfterRefreshAndFailedSave: Story = {
  render: (args) => <SummaryRefreshHarness {...args} failSave />,
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await expect(await canvas.findByText(task.problemStatement!)).toBeVisible();
    await userEvent.click(canvas.getByRole("button", { name: "Bearbeiten" }));
    const title = canvas.getByRole("textbox", { name: "Titel" });
    await userEvent.type(title, " Entwurf");
    await userEvent.click(canvas.getByRole("button", { name: "Refresh workspace summary" }));
    await expect(canvas.getByRole("textbox", { name: "Titel" })).toHaveValue(`${task.title} Entwurf`);
    await expect(canvas.getByLabelText("Unsaved draft")).toHaveTextContent("true");
    await userEvent.click(canvas.getByRole("button", { name: "Speichern" }));
    await expect(canvas.getByRole("alert")).toHaveTextContent("Aufgabe wurde zwischenzeitlich geändert.");
    await expect(canvas.getByRole("textbox", { name: "Titel" })).toHaveValue(`${task.title} Entwurf`);
    await expect(canvas.getByLabelText("Unsaved draft")).toHaveTextContent("true");
  },
};
