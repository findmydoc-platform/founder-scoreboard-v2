import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState, useSyncExternalStore } from "react";
import { expect, fn, userEvent, waitFor, within } from "storybook/test";
import { createPlanningState } from "@/features/planning/model/internal/planning-state-owner";
import { emptyPlanningShellState } from "@/features/planning/model/planning-shell-state";
import { taskDetailStoryTask } from "@/features/tasks/molecules/task-detail-story-fixtures";
import { buildSprintScoreViewModel } from "../model/sprint-score-view-model";
import { SprintScoreTableOverview } from "./sprint-score-overview";

const sprint = {
  id: "assessment-story",
  name: "Ausgewählter Sprint",
  status: "active" as const,
  startDate: "2026-11-15",
  endDate: "2026-11-30",
  reviewDueAt: "",
  scoreLocked: false,
};
const profile = {
  id: "founder-story",
  name: "Synthetischer Founder",
  platformRole: "ceo" as const,
  orgRole: "CEO",
  githubLogin: "",
  weeklyCapacity: 40,
};
const task = taskDetailStoryTask({ id: "selected-story-task", title: "Sprint-Aufgabe bleibt benutzbar", sprintId: sprint.id, ownerId: profile.id });
const complete = { ...emptyPlanningShellState, sprints: [sprint], profiles: [profile], tasks: [task] };
let failFirst: (() => void) | undefined;
let changeSupportingSource: (() => void) | undefined;

function AssessmentStory({ onOpenTask, locked = false, hold = true }: { onOpenTask: (id: string) => void; locked?: boolean; hold?: boolean }) {
  const [reads, setReads] = useState(0);
  const [writes, setWrites] = useState(0);
  const [owner] = useState(() => {
    let attempt = 0, sourceRevision = "scoped-source";
    changeSupportingSource = () => { sourceRevision = "support-changed"; window.dispatchEvent(new Event("online")); };
    return createPlanningState({
      userId: "story", initialWorkspace: "sprint", initialData: complete, initialCurrentProfile: profile,
      initialSession: { userId: "story", user: { id: "story" }, revision: "story-session", expiresAt: 4102444800 },
      adapter: {
        saveTask: async () => ({ task: {} }),
        readWorkspace: async () => { throw new Error("Independent scope must not reload the Sprint workspace"); },
        readSprintAssessment: async sprintId => {
          setReads(count => count + 1);
          if (++attempt === 1 && !locked && hold) await new Promise<void>((_, reject) => { failFirst = () => reject(Object.assign(new Error("Attendance unavailable"), { status: 503 })); });
          const evaluatedAt = Date.now(), validUntil = evaluatedAt + 60_000;
          return {
            sprintId, sourceRevision, evaluatedAt: new Date(evaluatedAt).toISOString(), validUntil: new Date(validUntil).toISOString(),
            readAuthority: { userId: "story", deadline: validUntil }, readActor: { profileId: profile.id, platformRole: profile.platformRole },
            inputCounts: { people: 1, items: 1, commitments: 0, scores: 0, strikeStates: 0, objections: 0, meetings: 0, attendance: 0 },
            scoreLocked: locked,
            scoreRows: buildSprintScoreViewModel({ data: complete, selectedSprintId: sprintId }).scoreRows,
          };
        },
        observeSprintAssessment: async sprintId => ({
          sprintId, sourceRevision, readAuthority: { userId: "story", deadline: Date.now() + 60_000 },
          readActor: { profileId: profile.id, platformRole: profile.platformRole },
        }),
        saveSprintCommitment: async (basis, patch) => {
          setWrites(count => count + 1);
          return { commitment: { ...basis, ...patch, id: 1, updatedAt: new Date().toISOString() } };
        },
      },
    });
  });
  useSyncExternalStore(owner.planning.subscribe, owner.internal.getSnapshot, owner.internal.getSnapshot);
  return <main className="p-4">
    <output aria-label="Abrufe für Sprint-Bewertung">{reads}</output>
    <output aria-label="Gesendete Commitment-Änderungen">{writes}</output>
    <SprintScoreTableOverview
      planningState={owner.planning}
      pending={false}
      onOpenTask={onOpenTask}
      onRequestReview={() => false}
      onChangeStatus={() => {}}
      onAssignSprint={() => {}}
      sprintPlanningOptions={{ firstSprintNumber: 1, anchorStartDate: sprint.startDate, rhythmWeeks: 2, horizonWeeks: 4, targetSprintNumber: 2 }}
      plannedSprintCount={1}
      onUpdateSprintPlanning={() => {}}
      currentProfile={profile}
      canManageSprint
      reviewObjectionWindowHours={24}
    />
  </main>;
}

const meta = {
  title: "Features/Sprint/Organisms/SprintScoreOverview",
  component: AssessmentStory,
  parameters: { layout: "fullscreen" },
  beforeEach: () => { failFirst = undefined; changeSupportingSource = undefined; },
  args: { onOpenTask: fn() },
} satisfies Meta<typeof AssessmentStory>;
export default meta;

export const AssessmentRetryKeepsIndependentSprintTasks: StoryObj<typeof meta> = {
  play: async ({ canvasElement, args }) => {
    const canvas = within(canvasElement);
    const assessment = within(canvas.getByRole("region", { name: "Sprint-Bewertung" }));
    await expect(await assessment.findByText("Die Grundlage der Sprint-Bewertung wird geladen.")).toBeVisible();
    await expect(assessment.queryByRole("searchbox")).not.toBeInTheDocument();
    await expect(assessment.queryByRole("spinbutton", { name: "Wochenstunden" })).not.toBeInTheDocument();
    const openTask = canvas.getByRole("link", { name: task.title });
    await userEvent.click(openTask);
    await expect(args.onOpenTask).toHaveBeenCalledWith(task.id);
    await expect(args.onOpenTask).toHaveBeenCalledTimes(1);
    failFirst?.();
    const retry = await assessment.findByRole("button", { name: "Sprint-Bewertung neu laden" });
    await expect(openTask).toHaveFocus();
    await expect(assessment.getByText("Die Sprint-Bewertung konnte nicht vollständig geladen werden.")).toBeVisible();
    await userEvent.click(retry);
    const scoreSearch = await assessment.findByRole("searchbox", { name: "Founder Score durchsuchen" });
    await expect(scoreSearch).toBeVisible();
    await waitFor(() => expect(scoreSearch).toHaveFocus());
    await expect(assessment.getByRole("spinbutton", { name: "Wochenstunden" })).toHaveValue(40);
    await expect(canvas.getByLabelText("Abrufe für Sprint-Bewertung")).toHaveTextContent("2");
  },
};

export const AssessedLockKeepsScoreVisibleAndBlocksCommitmentEdits: StoryObj<typeof meta> = {
  args: { locked: true },
  play: async ({ canvasElement }) => {
    const assessment = within(within(canvasElement).getByRole("region", { name: "Sprint-Bewertung" }));
    await expect(await assessment.findByRole("searchbox", { name: "Founder Score durchsuchen" })).toBeVisible();
    await expect(assessment.getByText("Score gelockt")).toBeVisible();
    await expect(assessment.getByRole("spinbutton", { name: "Wochenstunden" })).toBeDisabled();
  },
};

export const SupportingChangePreservesUnsubmittedCommitmentDraft: StoryObj<typeof meta> = {
  args: { hold: false },
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    const assessment = within(canvas.getByRole("region", { name: "Sprint-Bewertung" }));
    const hours = await assessment.findByRole("spinbutton", { name: "Wochenstunden" });
    await userEvent.clear(hours);
    await userEvent.type(hours, "26");
    await expect(hours).toHaveFocus();
    changeSupportingSource?.();
    const retry = await assessment.findByRole("button", { name: "Sprint-Bewertung neu laden" });
    await expect(assessment.queryByRole("spinbutton", { name: "Wochenstunden" })).not.toBeInTheDocument();
    await expect(canvas.getByLabelText("Gesendete Commitment-Änderungen")).toHaveTextContent("0");
    await userEvent.click(retry);
    await expect(await assessment.findByRole("spinbutton", { name: "Wochenstunden" })).toHaveValue(26);
    await expect(canvas.getByLabelText("Gesendete Commitment-Änderungen")).toHaveTextContent("0");
  },
};
