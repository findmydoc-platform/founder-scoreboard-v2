import { formatDate } from "@/lib/display";
import { reviewLabel } from "@/lib/platform";
import type { Profile, Task } from "@/lib/types";

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
    <section className="xl:col-span-2 min-w-0 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-950">{isOperationalLead ? "Team-Reviews" : "Meine Reviews"}</h2>
          <p className="mt-1 text-sm text-slate-500">Offene Accountable-Reviews aus Status Review.</p>
        </div>
        <div className="flex flex-wrap gap-2 text-xs font-semibold">
          <span className="rounded-full border border-blue-200 bg-blue-50 px-3 py-1 text-blue-700">{myReviewTasks.length} mir zugewiesen</span>
          {isOperationalLead && <span className="rounded-full border border-slate-200 bg-slate-50 px-3 py-1 text-slate-600">{teamReviewTasks.length} offen</span>}
          {isOperationalLead && reviewTasksWithoutOwner.length > 0 && <span className="rounded-full border border-amber-200 bg-amber-50 px-3 py-1 text-amber-700">{reviewTasksWithoutOwner.length} ohne Owner</span>}
          {overdueReviewTasks.length > 0 && <span className="rounded-full border border-red-200 bg-red-50 px-3 py-1 text-red-700">{overdueReviewTasks.length} überfällig</span>}
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
                <span className={`shrink-0 rounded-full border px-2 py-0.5 text-[11px] font-semibold ${reviewOverdue ? "border-red-200 bg-red-50 text-red-700" : "border-blue-200 bg-blue-50 text-blue-700"}`}>
                  {reviewLabel(task.reviewStatus)}
                </span>
              </div>
              <div className="mt-2 flex flex-wrap gap-1.5 text-[11px] font-semibold text-slate-600">
                <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5">{reviewOwner?.name || task.reviewOwnerProfileId || "Ohne Review Owner"}</span>
                {selfReview && <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-0.5 text-amber-700">Self-Review</span>}
                {task.reviewRequestedAt && <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5">{formatDate(task.reviewRequestedAt)}</span>}
              </div>
            </article>
          );
        })}
        {!visibleTasks.length && (
          <div className="rounded-md border border-dashed border-slate-200 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500 md:col-span-2">
            Keine offenen Reviews.
          </div>
        )}
      </div>
    </section>
  );
}
