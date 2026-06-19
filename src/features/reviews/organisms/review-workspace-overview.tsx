"use client";

import Link from "next/link";
import { CustomSelect } from "@/shared/atoms/custom-select";
import { UiLinkButton, UiPanel } from "@/shared/atoms/ui-primitives";
import { dateRange, taskOwnerLabel } from "@/lib/display";
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

  return (
    <div className="grid gap-4">
      <UiPanel>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-950">Review-Zentrale</h2>
            <p className="mt-1 text-sm text-slate-600">Alle angefragten, abgeschlossenen und wieder geöffneten Reviews an einem Ort.</p>
          </div>
          <div className="grid w-full gap-2 sm:w-auto sm:grid-cols-2">
            <CustomSelect
              value={statusFilter}
              onChange={(value) => onStatusFilterChange(value as ReviewStatusFilter)}
              className="h-9 min-w-40 text-sm"
              options={reviewStatusFilterOptions}
            />
            <CustomSelect
              value={ownerFilter}
              onChange={(value) => onOwnerFilterChange(value)}
              className="h-9 min-w-40 text-sm"
              options={ownerOptions}
            />
          </div>
        </div>
        <div className="mt-4 grid gap-2 text-sm text-slate-600 sm:grid-cols-4">
          <ReviewMetric label="Offen" value={metrics.open} />
          <ReviewMetric label="Abgeschlossen" value={metrics.completed} />
          <ReviewMetric label="Nacharbeit" value={metrics.rework} />
          <ReviewMetric label="Geblockt" value={metrics.blocked} />
        </div>
      </UiPanel>

      <UiPanel padding="none" className="overflow-hidden">
        <div className="border-b border-slate-100 px-4 py-3">
          <h2 className="text-base font-semibold text-slate-950">Reviews</h2>
          <p className="text-xs text-slate-500">{visibleTasks.length} Treffer mit aktuellem Filter.</p>
        </div>
        <div className="overflow-x-auto">
          <table className="min-w-[980px] w-full border-separate border-spacing-0 text-left text-sm">
            <thead className="bg-slate-50 text-xs uppercase text-slate-500">
              <tr>
                <th className="border-b border-slate-200 px-4 py-3 font-semibold">Aufgabe</th>
                <th className="border-b border-slate-200 px-3 py-3 font-semibold">Assignee</th>
                <th className="border-b border-slate-200 px-3 py-3 font-semibold">Review Owner</th>
                <th className="border-b border-slate-200 px-3 py-3 font-semibold">Status</th>
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
                    <div className="mt-1 truncate text-xs text-slate-500">{task.priority} · {task.hours}h · {task.workstream || "ohne Workstream"}</div>
                  </td>
                  <td className="border-b border-slate-100 px-3 py-3 text-slate-700">{taskOwnerLabel(task)}</td>
                  <td className="border-b border-slate-100 px-3 py-3 text-slate-700">{profileName(task.reviewOwnerProfileId)}</td>
                  <td className="border-b border-slate-100 px-3 py-3 text-slate-700">
                    <div>{reviewLabel(task.reviewStatus)} · {normalizeStatus(task.status)}</div>
                    {task.scoreFinal ? <div className="mt-1 text-xs text-emerald-700">{task.scorePoints} Punkte final</div> : null}
                    {isBlockedReviewTask(task, data) ? <div className="mt-1 text-xs font-semibold text-orange-700">Geblockt</div> : null}
                  </td>
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
                  <td colSpan={6} className="px-4 py-8 text-center text-sm text-slate-500">
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

function ReviewMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2">
      <div className="text-xs font-semibold text-slate-500">{label}</div>
      <div className="mt-1 text-lg font-semibold text-slate-950">{value}</div>
    </div>
  );
}
