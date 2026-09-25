import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, within } from "storybook/test";
import { taskDetailStoryTask } from "@/features/tasks/molecules/task-detail-story-fixtures";
import type { Profile } from "@/lib/types";
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
