import { CustomSelect } from "@/shared/atoms/custom-select";
import { formatDate } from "@/lib/display";
import { roleLabel } from "@/lib/platform";
import type { buildSprintScoreViewModel } from "@/features/sprint/model/sprint-score-view-model";
import type { CommitmentLevel, Sprint, SprintCommitment } from "@/lib/types";
import { UiBadge } from "@/shared/atoms/ui-primitives";
import { DataCell, DataHeaderCell, DataOverflow, DataRow, DataSurface, DataTable, DataTableHead } from "@/shared/molecules/data-surface";

type SprintScoreRows = ReturnType<typeof buildSprintScoreViewModel>["scoreRows"];

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
            {scoreRows.map((row) => (
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
                <DataCell className="font-semibold text-slate-900">{row.committed}</DataCell>
                <DataCell className="text-slate-700">{row.active} aktiv · {row.blocked} blockiert</DataCell>
                <DataCell className="text-slate-700">{row.reviewReady}</DataCell>
                <DataCell className="text-slate-700">{row.finalScore}</DataCell>
                <DataCell className="font-semibold text-slate-900">{row.v21Score.deliveryPoints}/12</DataCell>
                <DataCell className="font-semibold text-slate-900">{row.v21Score.formPoints}/4</DataCell>
                <DataCell className="font-semibold text-slate-900">{row.v21Score.weeklyPoints}/4</DataCell>
                <DataCell>
                  <div className="text-lg font-semibold text-slate-950">{row.v21Score.totalPoints}/20</div>
                  <div className={`text-xs font-semibold ${row.v21Score.awayNeutral ? "text-blue-700" : row.v21Score.fulfilled ? "text-emerald-700" : "text-amber-700"}`}>
                    {row.v21Score.awayNeutral ? "Away-neutral" : row.v21Score.fulfilled ? "erfüllt" : "nicht erfüllt"}
                  </div>
                </DataCell>
                <DataCell className="text-slate-700">
                  <div className="font-semibold text-slate-900">{row.strikeState?.strikeLevel ?? 0}/3</div>
                  <div className="text-xs text-slate-500">{row.strikeState?.fulfilledResetStreak ? `${row.strikeState.fulfilledResetStreak} Reset-Sprint` : "kein Reset offen"}</div>
                </DataCell>
                <DataCell className="text-slate-700">{row.openScore} Score · {row.openScoreObjections} Einwand</DataCell>
                <DataCell className="text-slate-700">{row.hours}h</DataCell>
              </DataRow>
            ))}
          </tbody>
        </DataTable>
      </DataOverflow>
    </DataSurface>
  );
}
