"use client";

import Link from "next/link";
import { CustomSelect } from "@/shared/atoms/custom-select";
import { classNames, UiBadge, UiLinkButton, UiPanel } from "@/shared/atoms/ui-primitives";
import { ReviewTaskAttentionBadges } from "@/features/tasks/molecules/task-attention-badges";
import { dateRange, taskAssigneeLabel } from "@/lib/display";
import { reviewLabel } from "@/lib/platform";
import { buildReviewWorkspaceViewModel, isBlockedReviewTask, reviewStatusFilterOptions, type ReviewOwnerFilter, type ReviewStatusFilter } from "@/features/reviews/model/review-workspace-view-model";
import { normalizeStatus } from "@/lib/status";
import type { PlanningData, Profile } from "@/lib/types";

type Props = {
  data: PlanningData;
  currentProfile: Profile | null;
  statusFilter: ReviewStatusFilter;
  ownerFilter: ReviewOwnerFilter;
  onStatusFilterChange: (value: ReviewStatusFilter) => void;
  onOwnerFilterChange: (value: ReviewOwnerFilter) => void;
};

export function ReviewWorkspaceOverview({
  data,
  currentProfile,
  statusFilter,
  ownerFilter,
  onStatusFilterChange,
  onOwnerFilterChange,
}: Props) {
  const { visibleTasks, ownerOptions, metrics } = buildReviewWorkspaceViewModel({
    data,
    currentProfile,
    filters: { status: statusFilter, owner: ownerFilter },
  });
  const profileName = (profileId = "") => data.profiles.find((profile) => profile.id === profileId)?.name || profileId || "Ohne Review Owner";
  const statusCounts: Record<ReviewStatusFilter, number> = {
    open: metrics.open,
    completed: metrics.completed,
    rework: metrics.rework,
    blocked: metrics.blocked,
    all: metrics.total,
  };
  const showStatusColumn = statusFilter === "all";

  return (
    <div className="grid gap-4">
      <UiPanel>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-950">Review-Zentrale</h2>
            <p className="mt-1 text-sm text-slate-600">Reviews nach Status und Owner priorisieren.</p>
          </div>
          <div className="flex w-full flex-wrap items-center justify-between gap-2 sm:w-auto sm:justify-end">
            <UiBadge tone="white" size="md">{visibleTasks.length}/{metrics.total}</UiBadge>
            <CustomSelect
              value={ownerFilter}
              onChange={(value) => onOwnerFilterChange(value)}
              className="h-9 min-w-40 text-sm"
              options={ownerOptions}
            />
          </div>
        </div>
        <div className="mt-4 flex flex-wrap gap-2" role="group" aria-label="Review-Status filtern">
          {reviewStatusFilterOptions.map((option) => {
            const active = statusFilter === option.value;
            return (
              <button
                key={option.value}
                type="button"
                onClick={() => onStatusFilterChange(option.value)}
                className={classNames(
                  "inline-flex h-9 items-center gap-2 rounded-md border px-3 text-xs font-semibold transition",
                  active ? "border-blue-300 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
                )}
                aria-pressed={active}
              >
                {option.label}
                <span className={classNames("rounded-full px-2 py-0.5", active ? "bg-white text-blue-700" : "bg-slate-100 text-slate-500")}>{statusCounts[option.value]}</span>
              </button>
            );
          })}
        </div>
      </UiPanel>

      <UiPanel padding="none" className="overflow-hidden">
        <div className="border-b border-slate-100 px-4 py-3">
          <h2 className="text-base font-semibold text-slate-950">Reviews</h2>
          <p className="text-xs text-slate-500">{visibleTasks.length} Treffer.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[860px] w-full border-separate border-spacing-0 text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="border-b border-slate-200 px-4 py-3 font-semibold">Aufgabe</th>
                <th className="border-b border-slate-200 px-3 py-3 font-semibold">Zuständig</th>
                <th className="border-b border-slate-200 px-3 py-3 font-semibold">Review Owner</th>
                {showStatusColumn && <th className="border-b border-slate-200 px-3 py-3 font-semibold">Status</th>}
                <th className="border-b border-slate-200 px-3 py-3 font-semibold">Zeitraum</th>
                <th className="border-b border-slate-200 px-3 py-3 font-semibold">Aktion</th>
              </tr>
            </thead>
            <tbody>
              {visibleTasks.map((task) => (
                <tr key={task.id} className="hover:bg-slate-50">
                  <td className="max-w-[360px] border-b border-slate-100 px-4 py-3">
                    <Link href={`/reviews/${encodeURIComponent(task.id)}`} className="block truncate font-semibold text-slate-950 hover:text-blue-700">
                      {task.title}
                    </Link>
                    <div className="mt-1 flex flex-wrap gap-1.5">
                      <ReviewTaskAttentionBadges task={task} />
                    </div>
                    <div className="mt-1 truncate text-xs text-slate-500">{task.priority} · {task.hours}h · {task.workstream || "ohne Bereich"}</div>
                  </td>
                  <td className="border-b border-slate-100 px-3 py-3 text-slate-700">{taskAssigneeLabel(task)}</td>
                  <td className="border-b border-slate-100 px-3 py-3 text-slate-700">{profileName(task.reviewOwnerProfileId)}</td>
                  {showStatusColumn && (
                    <td className="border-b border-slate-100 px-3 py-3 text-slate-700">
                      <div>{reviewLabel(task.reviewStatus)} · {normalizeStatus(task.status)}</div>
                      {task.scoreFinal ? <div className="mt-1 text-xs text-emerald-700">{task.scorePoints} Punkte final</div> : null}
                      {isBlockedReviewTask(task, data) ? <div className="mt-1 text-xs font-semibold text-orange-700">Geblockt</div> : null}
                    </td>
                  )}
                  <td className="border-b border-slate-100 px-3 py-3 text-slate-700">{dateRange(task)}</td>
                  <td className="border-b border-slate-100 px-3 py-3">
                    <UiLinkButton href={`/reviews/${encodeURIComponent(task.id)}`} variant="blue" size="sm">
                      Review öffnen
                    </UiLinkButton>
                  </td>
                </tr>
              ))}
              {!visibleTasks.length && (
                <tr>
                  <td colSpan={showStatusColumn ? 6 : 5} className="px-4 py-8 text-center text-sm text-slate-500">
                    Keine Reviews für diesen Filter.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </UiPanel>
    </div>
  );
}
