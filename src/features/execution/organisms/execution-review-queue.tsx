import { formatDate } from "@/lib/display";
import { reviewLabel } from "@/lib/platform";
import type { Profile, Task } from "@/lib/types";
import { UiBadge, UiEmptyState, UiPanel } from "@/shared/atoms/ui-primitives";

export function ExecutionReviewQueue({
  profiles,
  isOperationalLead,
  myReviewTasks,
  teamReviewTasks,
  reviewTasksWithoutOwner,
  overdueReviewTasks,
  onOpenTask,
}: {
  profiles: Profile[];
  isOperationalLead: boolean;
  myReviewTasks: Task[];
  teamReviewTasks: Task[];
  reviewTasksWithoutOwner: Task[];
  overdueReviewTasks: Task[];
  onOpenTask: (task: Task) => void;
}) {
  const visibleTasks = isOperationalLead ? teamReviewTasks : myReviewTasks;

  return (
    <UiPanel className="min-w-0 xl:col-span-2">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-950">{isOperationalLead ? "Team-Reviews" : "Meine Reviews"}</h2>
          <p className="mt-1 text-sm text-slate-500">Offene Accountable-Reviews aus Status Review.</p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs font-semibold">
          <UiBadge tone="blue" size="md">{myReviewTasks.length} mir zugewiesen</UiBadge>
          {isOperationalLead && <UiBadge size="md">{teamReviewTasks.length} offen</UiBadge>}
          {isOperationalLead && reviewTasksWithoutOwner.length > 0 && <UiBadge tone="amber" size="md">{reviewTasksWithoutOwner.length} ohne Owner</UiBadge>}
          {overdueReviewTasks.length > 0 && <UiBadge tone="red" size="md">{overdueReviewTasks.length} überfällig</UiBadge>}
        </div>
      </div>
      <div className="mt-4 grid gap-2 md:grid-cols-2">
        {visibleTasks.slice(0, 8).map((task) => {
          const reviewOwner = profiles.find((profile) => profile.id === task.reviewOwnerProfileId);
          const selfReview = Boolean(task.reviewOwnerProfileId && (task.ownerId === task.reviewOwnerProfileId || task.owner === task.reviewOwnerProfileId));
          const reviewOverdue = overdueReviewTasks.some((item) => item.id === task.id);
          return (
            <article key={task.id} className="rounded-md border border-slate-200 bg-slate-50 p-3">
              <div className="flex flex-wrap items-start justify-between gap-2">
                <button type="button" onClick={() => onOpenTask(task)} className="min-w-0 text-left text-sm font-semibold leading-5 text-slate-950 hover:text-blue-700">
                  {task.title}
                </button>
                <UiBadge tone={reviewOverdue ? "red" : "blue"} size="xs" className="shrink-0">
                  {reviewLabel(task.reviewStatus)}
                </UiBadge>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-semibold text-slate-600">
                <UiBadge tone="white" size="xs">{reviewOwner?.name || task.reviewOwnerProfileId || "Ohne Review Owner"}</UiBadge>
                {selfReview && <UiBadge tone="amber" size="xs">Self-Review</UiBadge>}
                {task.reviewRequestedAt && <UiBadge tone="white" size="xs">{formatDate(task.reviewRequestedAt)}</UiBadge>}
              </div>
            </article>
          );
        })}
        {!visibleTasks.length && (
          <UiEmptyState tone="muted" className="px-4 py-8 md:col-span-2">
            Keine offenen Reviews.
          </UiEmptyState>
        )}
      </div>
    </UiPanel>
  );
}
