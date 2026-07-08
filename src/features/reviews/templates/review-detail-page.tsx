"use client";

import { AppSidebar } from "@/features/planning/organisms/app-sidebar";
import { TaskReviewSheet } from "@/features/reviews/organisms/task-review-sheet";
import { canActOnReview, isReviewRelevantTask } from "@/features/reviews/model/review-workspace-view-model";
import type { PlanningData, Profile, Task } from "@/lib/types";
import { UiLinkButton, UiPanel } from "@/shared/atoms/ui-primitives";

type Props = {
  data: PlanningData;
  task: Task | null;
  currentProfile: Profile | null;
  pending: boolean;
  source: "seed" | "supabase";
  onReview: (
    task: Task,
    reviewStatus: "accepted" | "partial" | "changes_requested",
    scorePoints: number,
    checklist?: { acceptanceCriteriaMet?: boolean; evidenceProvided?: boolean; communicationClear?: boolean; blockerHandled?: boolean },
    comment?: string,
  ) => void;
  onReopen: (task: Task) => void;
};

export function ReviewDetailPage({ data, task, currentProfile, pending, source, onReview, onReopen }: Props) {
  if (!task || !isReviewRelevantTask(task, data)) {
    return (
      <main className="min-h-screen bg-slate-50 text-slate-950 lg:pl-16">
        <AppSidebar activeWorkspace="reviews" source={source} currentPlatformRole={currentProfile?.platformRole || ""} />
        <div className="mx-auto max-w-4xl px-6 py-10">
          <UiPanel padding="xl">
            <h1 className="text-lg font-semibold text-slate-950">Review nicht gefunden</h1>
            <p className="mt-2 text-sm leading-6 text-slate-600">Diese Aufgabe existiert nicht oder ist aktuell keine Review.</p>
            <UiLinkButton href="/reviews" variant="blue" className="mt-4">
              Zur Review-Zentrale
            </UiLinkButton>
          </UiPanel>
        </div>
      </main>
    );
  }

  const reviewOwnerName = task.reviewOwnerProfileId
    ? data.profiles.find((profile) => profile.id === task.reviewOwnerProfileId)?.name || task.reviewOwnerProfileId
    : "Ohne Review Owner";
  const canAct = canActOnReview(task, currentProfile);

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950 lg:pl-16">
      <AppSidebar activeWorkspace="reviews" source={source} currentPlatformRole={currentProfile?.platformRole || ""} />
      <div className="mx-auto max-w-7xl px-6 py-6">
        <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
          <div>
            <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Review</div>
            <h1 className="mt-1 text-xl font-semibold text-slate-950">{task.title}</h1>
          </div>
          <UiLinkButton href="/reviews">
            Zur Review-Zentrale
          </UiLinkButton>
        </div>
        <TaskReviewSheet
          task={task}
          reviewOwnerName={reviewOwnerName}
          canReview={canAct}
          canReopen={canAct}
          pending={pending}
          onReview={onReview}
          onReopen={onReopen}
        />
      </div>
    </main>
  );
}
