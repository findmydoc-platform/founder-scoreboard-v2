"use client";

import { useState } from "react";
import { CustomSelect } from "@/shared/atoms/custom-select";
import { formatDate } from "@/lib/display";
import { roleLabel } from "@/lib/platform";
import { buildSprintScoreTableViewModel, DEFAULT_SPRINT_SCORE_FILTERS, type SprintScoreAttentionFilter, type SprintScoreSort, type SprintScoreTableFilters } from "@/features/sprint/model/sprint-score-table-view-model";
import type { CommitmentLevel, Sprint, SprintCommitment } from "@/lib/types";
import { UiBadge, UiEmptyState } from "@/shared/atoms/ui-primitives";
import { ColumnFilterPopover } from "@/shared/molecules/column-filter-popover";
import { DataCell, DataColumnHeader, DataEmptyRow, DataHeaderCell, DataRow, DataTableFrame, DataTableHead, type SortDirection } from "@/shared/molecules/data-surface";
import { FilterField, FilterToolbar, type ActiveFilter } from "@/shared/molecules/filter-toolbar";
import { enumUrlField, stringUrlField, useTableUrlState, type TableUrlSchema } from "@/shared/hooks/use-table-url-state";

import type { SprintScoreRow } from "@/features/sprint/model/sprint-score-table-view-model";

type SprintScoreRows = SprintScoreRow[];

const scoreFilterSchema: TableUrlSchema<SprintScoreTableFilters> = {
  query: stringUrlField(),
  role: stringUrlField("all"),
  commitment: stringUrlField("all"),
  attention: enumUrlField("all", ["all", "unfulfilled", "away", "strike", "open"] as const),
  sort: enumUrlField("name", ["name", "score", "hours", "open", "strike"] as const),
  direction: enumUrlField("asc", ["asc", "desc"] as const),
};

function quietValue(value: number | string, active: boolean) {
  return <span className={active ? "text-slate-700" : "text-slate-400"}>{value}</span>;
}

function quietDash() {
  return <span className="text-slate-400">-</span>;
}

function scoreFraction(points: number, max: number, relevantTasks: boolean) {
  const className = points === 0
    ? relevantTasks
      ? "font-semibold text-amber-700"
      : "font-semibold text-slate-400"
    : "font-semibold text-slate-900";
  return <span className={className}>{points}/{max}</span>;
}

export function SprintFounderScoreTable({
  sprint,
  scoreRows,
  pending,
  onUpdateCommitment,
}: {
  sprint: Sprint;
  scoreRows: SprintScoreRows;
  pending: boolean;
  onUpdateCommitment: (commitment: SprintCommitment) => void;
}) {
  const [filtersOpen, setFiltersOpen] = useState(false);
  const { state: filters, updateState: updateFilters, resetState: resetFilters } = useTableUrlState({ namespace: "score", schema: scoreFilterSchema });
  const { visibleRows, totalCount } = buildSprintScoreTableViewModel(scoreRows, filters);
  const sprintStatusLabel: Record<Sprint["status"], string> = {
    planning: "Planung",
    active: "Aktiv",
    review: "Review",
    closed: "Abgeschlossen",
  };
  const attentionLabel: Record<SprintScoreAttentionFilter, string> = {
    all: "Alle Hinweise",
    unfulfilled: "Nicht erfüllt",
    away: "Away-neutral",
    strike: "Mit Strike",
    open: "Offene Scores",
  };
  const activeFilters: ActiveFilter[] = [
    ...(filters.role !== "all" ? [{ id: "role", label: `Rolle: ${filters.role}`, onRemove: () => updateFilters({ role: "all" }) }] : []),
    ...(filters.commitment !== "all" ? [{ id: "commitment", label: `Commitment: ${filters.commitment}`, onRemove: () => updateFilters({ commitment: "all" }) }] : []),
    ...(filters.attention !== "all" ? [{ id: "attention", label: attentionLabel[filters.attention], onRemove: () => updateFilters({ attention: "all" }) }] : []),
  ];
  const toggleSort = (sort: SprintScoreSort) => updateFilters({
    sort,
    direction: filters.sort === sort && filters.direction === "asc" ? "desc" : "asc",
  });
  const directionFor = (sort: SprintScoreSort): SortDirection => filters.sort === sort ? filters.direction : null;
  const roleOptions = [{ value: "all", label: "Alle Rollen" }, ...Array.from(new Set(scoreRows.map((row) => row.profile.platformRole))).map((role) => ({ value: role, label: role }))];
  const commitmentOptions = [{ value: "all", label: "Alle Commitments" }, ...["Lite", "Standard", "Heavy", "Away"].map((level) => ({ value: level, label: level }))];
  const attentionOptions = (Object.keys(attentionLabel) as SprintScoreAttentionFilter[]).map((value) => ({ value, label: attentionLabel[value] }));
  const toolbar = (
    <FilterToolbar
      variant="embedded"
      density="compact"
      searchLabel="Founder Score durchsuchen"
      searchPlaceholder="Founder, Rolle oder Commitment suchen"
      query={filters.query}
      onQueryChange={(query) => updateFilters({ query }, "replace")}
      expanded={filtersOpen}
      onExpandedChange={setFiltersOpen}
      activeFilters={activeFilters}
      isDirty={JSON.stringify(filters) !== JSON.stringify(DEFAULT_SPRINT_SCORE_FILTERS)}
      onReset={resetFilters}
      results={[{ id: "score", visibleCount: visibleRows.length, totalCount }]}
      panelId="score-table-filters"
    >
      <div className="grid gap-3 md:grid-cols-3">
        <FilterField label="Rolle"><CustomSelect aria-label="Founder Score nach Rolle filtern" value={filters.role} onChange={(role) => updateFilters({ role })} options={roleOptions} className="h-10 text-sm" /></FilterField>
        <FilterField label="Commitment"><CustomSelect aria-label="Founder Score nach Commitment filtern" value={filters.commitment} onChange={(commitment) => updateFilters({ commitment })} options={commitmentOptions} className="h-10 text-sm" /></FilterField>
        <FilterField label="Aufmerksamkeit"><CustomSelect aria-label="Founder Score nach Aufmerksamkeit filtern" value={filters.attention} onChange={(attention) => updateFilters({ attention: attention as SprintScoreAttentionFilter })} options={attentionOptions} className="h-10 text-sm" /></FilterField>
      </div>
    </FilterToolbar>
  );

  return (
    <div data-tour-id="sprint-responsive-score">
      <DataTableFrame
      title="FounderOps Score v2.1"
      description={`${sprintStatusLabel[sprint.status]} · ${formatDate(sprint.startDate)} bis ${formatDate(sprint.endDate)}`}
      caption="FounderOps Score nach Founder"
      results={[{ id: "score", visibleCount: visibleRows.length, totalCount }]}
      filtering={{ mode: "embedded", toolbar }}
      minWidth={980}
      actions={<UiBadge tone={sprint.scoreLocked ? "blue" : "amber"} size="md">{sprint.scoreLocked ? "Score gelockt" : "Score offen"}</UiBadge>}
      mobileContentBreakpoint="xl"
      mobileContent={(
        <div className="grid divide-y divide-slate-200 bg-white md:grid-cols-2 md:gap-3 md:divide-y-0 md:bg-slate-50 md:p-3">
          {visibleRows.map((row) => {
            const relevantTasks = row.committed > 0;
            const strikeLevel = row.strikeState?.strikeLevel ?? 0;
            const resetStreak = row.strikeState?.fulfilledResetStreak ?? 0;
            const hasOpenScoreSignal = row.openScore > 0 || row.openScoreObjections > 0;
            const totalStatusClass = row.v21Score.awayNeutral
              ? "text-blue-700"
              : row.v21Score.fulfilled
                ? "text-emerald-700"
                : relevantTasks
                  ? "text-amber-700"
                  : "text-slate-400";
            const totalStatusLabel = row.v21Score.awayNeutral
              ? "Away-neutral"
              : row.v21Score.fulfilled
                ? "erfüllt"
                : relevantTasks
                  ? "nicht erfüllt"
                  : "–";
            return (
              <article key={row.profile.id} className="grid gap-4 px-4 py-4 md:rounded-md md:border md:border-slate-200 md:bg-white">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <h3 className="font-semibold text-slate-950">{row.profile.name}</h3>
                    <p className="text-xs text-slate-500">{roleLabel(row.profile)}</p>
                  </div>
                  <div className="shrink-0 text-right">
                    <div className="text-xl font-semibold tabular-nums text-slate-950">{row.v21Score.totalPoints}/20</div>
                    <div className={`text-xs font-semibold ${totalStatusClass}`}>{totalStatusLabel}</div>
                  </div>
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <label className="grid gap-1 text-xs font-semibold text-slate-500">
                    Commitment
                    <CustomSelect value={row.commitment.commitmentLevel} disabled={pending || sprint.scoreLocked} onChange={(value) => onUpdateCommitment({ ...row.commitment, commitmentLevel: value as CommitmentLevel })} className="h-11 w-full text-sm" options={["Lite", "Standard", "Heavy", "Away"].map((level) => ({ value: level, label: level }))} />
                  </label>
                  <label className="grid gap-1 text-xs font-semibold text-slate-500">
                    Wochenstunden
                    <input
                      type="number"
                      min={0}
                      max={80}
                      value={row.commitment.weeklyHours}
                      disabled={pending || sprint.scoreLocked}
                      onChange={(event) => onUpdateCommitment({ ...row.commitment, weeklyHours: Number(event.target.value) })}
                      className="h-11 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-700 disabled:bg-slate-50 disabled:opacity-60"
                    />
                  </label>
                </div>
                <dl className="grid grid-cols-2 gap-x-4 gap-y-3 rounded-md bg-slate-50 p-3 text-xs">
                  <div><dt className="text-slate-500">Aufgaben</dt><dd className="mt-0.5 font-semibold text-slate-900">{row.committed}</dd></div>
                  <div><dt className="text-slate-500">Workflow</dt><dd className={row.blocked > 0 ? "mt-0.5 font-semibold text-red-700" : "mt-0.5 font-semibold text-slate-900"}>{row.active} aktiv · {row.blocked} blockiert</dd></div>
                  <div><dt className="text-slate-500">Delivery</dt><dd className="mt-0.5">{scoreFraction(row.v21Score.deliveryPoints, 12, relevantTasks)}</dd></div>
                  <div><dt className="text-slate-500">Form / Review-Reife</dt><dd className="mt-0.5">{scoreFraction(row.v21Score.formPoints, 4, relevantTasks)}</dd></div>
                  <div><dt className="text-slate-500">Weekly</dt><dd className="mt-0.5">{scoreFraction(row.v21Score.weeklyPoints, 4, relevantTasks)}</dd></div>
                  <div><dt className="text-slate-500">Aufwand</dt><dd className="mt-0.5 font-semibold text-slate-900">{row.hours}h</dd></div>
                </dl>
                <div className="flex flex-wrap gap-2">
                  <UiBadge tone={strikeLevel > 0 ? "red" : "slate"}>Strike {strikeLevel}/3</UiBadge>
                  {resetStreak > 0 && <UiBadge tone="white">{resetStreak} Reset-Sprint</UiBadge>}
                  {hasOpenScoreSignal && <UiBadge tone="amber">{row.openScore} Score · {row.openScoreObjections} Einwand</UiBadge>}
                </div>
              </article>
            );
          })}
          {!visibleRows.length && <UiEmptyState className="m-4 md:col-span-2">{totalCount ? "Keine Founder für diese Filter." : "Noch keine Founder vorhanden."}</UiEmptyState>}
        </div>
      )}
    >
          <DataTableHead>
            <tr>
              <DataColumnHeader className="px-4" label="Founder" direction={directionFor("name")} onSort={() => toggleSort("name")} sticky filter={<ColumnFilterPopover label="Founder nach Rolle filtern" activeCount={filters.role === "all" ? 0 : 1} onReset={() => updateFilters({ role: "all" })}><CustomSelect aria-label="Rolle wählen" value={filters.role} onChange={(role) => updateFilters({ role })} options={roleOptions} className="h-10" /></ColumnFilterPopover>} />
              <DataColumnHeader label="Aufgaben" filter={<ColumnFilterPopover label="Nach Commitment filtern" activeCount={filters.commitment === "all" ? 0 : 1} onReset={() => updateFilters({ commitment: "all" })}><CustomSelect aria-label="Commitment wählen" value={filters.commitment} onChange={(commitment) => updateFilters({ commitment })} options={commitmentOptions} className="h-10" /></ColumnFilterPopover>} />
              <DataHeaderCell>Wochenstunden</DataHeaderCell>
              <DataHeaderCell>Commitment</DataHeaderCell>
              <DataHeaderCell>Workflow</DataHeaderCell>
              <DataHeaderCell>Review</DataHeaderCell>
              <DataHeaderCell>Final</DataHeaderCell>
              <DataHeaderCell>Delivery</DataHeaderCell>
              <DataHeaderCell>Form / Review-Reife</DataHeaderCell>
              <DataHeaderCell>Weekly</DataHeaderCell>
              <DataColumnHeader label="20 Punkte" direction={directionFor("score")} onSort={() => toggleSort("score")} filter={<ColumnFilterPopover label="Nach Score-Erfüllung filtern" activeCount={["unfulfilled", "away"].includes(filters.attention) ? 1 : 0} onReset={() => updateFilters({ attention: "all" })}><CustomSelect aria-label="Score-Erfüllung wählen" value={["unfulfilled", "away"].includes(filters.attention) ? filters.attention : "all"} onChange={(attention) => updateFilters({ attention: attention as SprintScoreAttentionFilter })} options={attentionOptions.filter((option) => ["all", "unfulfilled", "away"].includes(option.value))} className="h-10" /></ColumnFilterPopover>} />
              <DataColumnHeader label="Strike" direction={directionFor("strike")} onSort={() => toggleSort("strike")} filter={<ColumnFilterPopover label="Nach Strike filtern" activeCount={filters.attention === "strike" ? 1 : 0} onReset={() => updateFilters({ attention: "all" })}><button type="button" aria-pressed={filters.attention === "strike"} onClick={() => updateFilters({ attention: filters.attention === "strike" ? "all" : "strike" })} className="w-full rounded-md border border-slate-200 px-3 py-2 text-left font-semibold text-slate-700">Nur Founder mit Strike</button></ColumnFilterPopover>} />
              <DataColumnHeader label="Offen" direction={directionFor("open")} onSort={() => toggleSort("open")} filter={<ColumnFilterPopover label="Nach offenen Scores filtern" activeCount={filters.attention === "open" ? 1 : 0} onReset={() => updateFilters({ attention: "all" })}><button type="button" aria-pressed={filters.attention === "open"} onClick={() => updateFilters({ attention: filters.attention === "open" ? "all" : "open" })} className="w-full rounded-md border border-slate-200 px-3 py-2 text-left font-semibold text-slate-700">Nur offene Scores</button></ColumnFilterPopover>} />
              <DataColumnHeader label="Aufwand" direction={directionFor("hours")} onSort={() => toggleSort("hours")} />
            </tr>
          </DataTableHead>
          <tbody>
            {visibleRows.map((row) => {
              const relevantTasks = row.committed > 0;
              const hasWorkflowSignal = row.active > 0 || row.blocked > 0;
              const strikeLevel = row.strikeState?.strikeLevel ?? 0;
              const resetStreak = row.strikeState?.fulfilledResetStreak ?? 0;
              const hasOpenScoreSignal = row.openScore > 0 || row.openScoreObjections > 0;
              const totalStatusClass = row.v21Score.awayNeutral
                ? "text-blue-700"
                : row.v21Score.fulfilled
                  ? "text-emerald-700"
                  : relevantTasks
                    ? "text-amber-700"
                    : "text-slate-400";
              const totalStatusLabel = row.v21Score.awayNeutral
                ? "Away-neutral"
                : row.v21Score.fulfilled
                  ? "erfüllt"
                  : relevantTasks
                    ? "nicht erfüllt"
                    : "-";

              return (
                <DataRow key={row.profile.id}>
                  <DataCell className="px-4" sticky>
                    <div className="font-semibold text-slate-950">{row.profile.name}</div>
                    <div className="text-xs text-slate-500">{roleLabel(row.profile)}</div>
                  </DataCell>
                  <DataCell>
                    <CustomSelect value={row.commitment.commitmentLevel} disabled={pending || sprint.scoreLocked} onChange={(value) => onUpdateCommitment({ ...row.commitment, commitmentLevel: value as CommitmentLevel })} className="h-8 w-28 text-xs" options={["Lite", "Standard", "Heavy", "Away"].map((level) => ({ value: level, label: level }))} />
                  </DataCell>
                  <DataCell>
                    <input
                      type="number"
                      min={0}
                      max={80}
                      value={row.commitment.weeklyHours}
                      disabled={pending || sprint.scoreLocked}
                      onChange={(event) => onUpdateCommitment({ ...row.commitment, weeklyHours: Number(event.target.value) })}
                      className="h-8 w-20 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 disabled:bg-slate-50 disabled:opacity-60"
                    />
                  </DataCell>
                  <DataCell className="font-semibold">{quietValue(row.committed, relevantTasks)}</DataCell>
                  <DataCell className={row.blocked > 0 ? "font-semibold text-red-700" : "text-slate-700"}>
                    {hasWorkflowSignal ? `${row.active} aktiv · ${row.blocked} blockiert` : quietDash()}
                  </DataCell>
                  <DataCell>{quietValue(row.reviewReady, row.reviewReady > 0)}</DataCell>
                  <DataCell>{quietValue(row.finalScore, row.finalScore > 0)}</DataCell>
                  <DataCell>{scoreFraction(row.v21Score.deliveryPoints, 12, relevantTasks)}</DataCell>
                  <DataCell>{scoreFraction(row.v21Score.formPoints, 4, relevantTasks)}</DataCell>
                  <DataCell>{scoreFraction(row.v21Score.weeklyPoints, 4, relevantTasks)}</DataCell>
                  <DataCell>
                    <div className={`text-lg font-semibold ${relevantTasks || row.v21Score.totalPoints > 0 ? "text-slate-950" : "text-slate-400"}`}>{row.v21Score.totalPoints}/20</div>
                    <div className={`text-xs font-semibold ${totalStatusClass}`}>
                      {totalStatusLabel}
                    </div>
                  </DataCell>
                  <DataCell>
                    <div className={`font-semibold ${strikeLevel > 0 ? "text-red-700" : "text-slate-400"}`}>{strikeLevel}/3</div>
                    <div className="text-xs text-slate-500">{resetStreak ? `${resetStreak} Reset-Sprint` : quietDash()}</div>
                  </DataCell>
                  <DataCell className={hasOpenScoreSignal ? "font-semibold text-amber-700" : ""}>
                    {hasOpenScoreSignal ? `${row.openScore} Score · ${row.openScoreObjections} Einwand` : quietDash()}
                  </DataCell>
                  <DataCell>{row.hours ? <span className="text-slate-700">{row.hours}h</span> : quietValue("0h", false)}</DataCell>
                </DataRow>
              );
            })}
            {!visibleRows.length && <DataEmptyRow colSpan={14}>{totalCount ? "Keine Founder für diese Filter." : "Noch keine Founder vorhanden."}</DataEmptyRow>}
          </tbody>
      </DataTableFrame>
    </div>
  );
}
