import { CustomSelect } from "@/shared/atoms/custom-select";
import { formatDate } from "@/lib/display";
import { roleLabel } from "@/lib/platform";
import type { buildSprintScoreViewModel } from "@/features/sprint/model/sprint-score-view-model";
import type { CommitmentLevel, Sprint, SprintCommitment } from "@/lib/types";
import { UiBadge } from "@/shared/atoms/ui-primitives";
import { DataCell, DataHeaderCell, DataOverflow, DataRow, DataSurface, DataTable, DataTableHead } from "@/shared/molecules/data-surface";

type SprintScoreRows = ReturnType<typeof buildSprintScoreViewModel>["scoreRows"];

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
  const sprintStatusLabel: Record<Sprint["status"], string> = {
    planning: "Planung",
    active: "Aktiv",
    review: "Review",
    closed: "Abgeschlossen",
  };

  return (
    <DataSurface
      title="FounderOps Score v2.1"
      description={`${sprintStatusLabel[sprint.status]} · ${formatDate(sprint.startDate)} bis ${formatDate(sprint.endDate)}`}
      actions={(
        <UiBadge tone={sprint.scoreLocked ? "blue" : "amber"} size="md">
          {sprint.scoreLocked ? "Score gelockt" : "Score offen"}
        </UiBadge>
      )}
    >
      <DataOverflow>
        <DataTable minWidth={980}>
          <DataTableHead>
            <tr>
              <DataHeaderCell className="px-4">Founder</DataHeaderCell>
              <DataHeaderCell>Aufgaben</DataHeaderCell>
              <DataHeaderCell>Wochenstunden</DataHeaderCell>
              <DataHeaderCell>Commitment</DataHeaderCell>
              <DataHeaderCell>Workflow</DataHeaderCell>
              <DataHeaderCell>Review</DataHeaderCell>
              <DataHeaderCell>Final</DataHeaderCell>
              <DataHeaderCell>Delivery</DataHeaderCell>
              <DataHeaderCell>Form / Review-Reife</DataHeaderCell>
              <DataHeaderCell>Weekly</DataHeaderCell>
              <DataHeaderCell>20 Punkte</DataHeaderCell>
              <DataHeaderCell>Strike</DataHeaderCell>
              <DataHeaderCell>Offen</DataHeaderCell>
              <DataHeaderCell>Aufwand</DataHeaderCell>
            </tr>
          </DataTableHead>
          <tbody>
            {scoreRows.map((row) => {
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
                  <DataCell className="px-4">
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
          </tbody>
        </DataTable>
      </DataOverflow>
    </DataSurface>
  );
}
