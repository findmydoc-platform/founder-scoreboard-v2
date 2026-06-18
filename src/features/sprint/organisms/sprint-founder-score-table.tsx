import { CustomSelect } from "@/shared/atoms/custom-select";
import { formatDate } from "@/lib/display";
import { roleLabel } from "@/lib/platform";
import type { buildSprintScoreViewModel } from "@/features/sprint/model/sprint-score-view-model";
import type { CommitmentLevel, Sprint, SprintCommitment } from "@/lib/types";

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
    <section className="min-w-0 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex flex-wrap items-center justify-between gap-2 border-b border-slate-100 px-4 py-3">
        <div>
          <h2 className="text-base font-semibold text-slate-950">FounderOps Score v2.1</h2>
          <p className="text-xs text-slate-500">{sprintStatusLabel[sprint.status]} · {formatDate(sprint.startDate)} bis {formatDate(sprint.endDate)}</p>
        </div>
        <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${sprint.scoreLocked ? "border-blue-200 bg-blue-50 text-blue-700" : "border-amber-200 bg-amber-50 text-amber-700"}`}>
          {sprint.scoreLocked ? "Score gelockt" : "Score offen"}
        </span>
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-[980px] w-full border-separate border-spacing-0 text-left text-sm">
          <thead className="bg-slate-50 text-xs uppercase text-slate-500">
            <tr>
              <th className="border-b border-slate-200 px-4 py-3 font-semibold">Founder</th>
              <th className="border-b border-slate-200 px-3 py-3 font-semibold">Aufgaben</th>
              <th className="border-b border-slate-200 px-3 py-3 font-semibold">Wochenstunden</th>
              <th className="border-b border-slate-200 px-3 py-3 font-semibold">Commitment</th>
              <th className="border-b border-slate-200 px-3 py-3 font-semibold">Workflow</th>
              <th className="border-b border-slate-200 px-3 py-3 font-semibold">Review</th>
              <th className="border-b border-slate-200 px-3 py-3 font-semibold">Final</th>
              <th className="border-b border-slate-200 px-3 py-3 font-semibold">Delivery</th>
              <th className="border-b border-slate-200 px-3 py-3 font-semibold">Form / Review-Reife</th>
              <th className="border-b border-slate-200 px-3 py-3 font-semibold">Weekly</th>
              <th className="border-b border-slate-200 px-3 py-3 font-semibold">20 Punkte</th>
              <th className="border-b border-slate-200 px-3 py-3 font-semibold">Strike</th>
              <th className="border-b border-slate-200 px-3 py-3 font-semibold">Offen</th>
              <th className="border-b border-slate-200 px-3 py-3 font-semibold">Aufwand</th>
            </tr>
          </thead>
          <tbody>
            {scoreRows.map((row) => (
              <tr key={row.profile.id} className="hover:bg-slate-50">
                <td className="border-b border-slate-100 px-4 py-3">
                  <div className="font-semibold text-slate-950">{row.profile.name}</div>
                  <div className="text-xs text-slate-500">{roleLabel(row.profile)}</div>
                </td>
                <td className="border-b border-slate-100 px-3 py-3">
                  <CustomSelect value={row.commitment.commitmentLevel} disabled={pending || sprint.scoreLocked} onChange={(value) => onUpdateCommitment({ ...row.commitment, commitmentLevel: value as CommitmentLevel })} className="h-8 w-28 text-xs" options={["Lite", "Standard", "Heavy", "Away"].map((level) => ({ value: level, label: level }))} />
                </td>
                <td className="border-b border-slate-100 px-3 py-3">
                  <input
                    type="number"
                    min={0}
                    max={80}
                    value={row.commitment.weeklyHours}
                    disabled={pending || sprint.scoreLocked}
                    onChange={(event) => onUpdateCommitment({ ...row.commitment, weeklyHours: Number(event.target.value) })}
                    className="h-8 w-20 rounded-md border border-slate-200 bg-white px-2 text-xs text-slate-700 disabled:bg-slate-50 disabled:opacity-60"
                  />
                </td>
                <td className="border-b border-slate-100 px-3 py-3 font-semibold text-slate-900">{row.committed}</td>
                <td className="border-b border-slate-100 px-3 py-3 text-slate-700">{row.active} aktiv · {row.blocked} blockiert</td>
                <td className="border-b border-slate-100 px-3 py-3 text-slate-700">{row.reviewReady}</td>
                <td className="border-b border-slate-100 px-3 py-3 text-slate-700">{row.finalScore}</td>
                <td className="border-b border-slate-100 px-3 py-3 font-semibold text-slate-900">{row.v21Score.deliveryPoints}/12</td>
                <td className="border-b border-slate-100 px-3 py-3 font-semibold text-slate-900">{row.v21Score.formPoints}/4</td>
                <td className="border-b border-slate-100 px-3 py-3 font-semibold text-slate-900">{row.v21Score.weeklyPoints}/4</td>
                <td className="border-b border-slate-100 px-3 py-3">
                  <div className="text-lg font-semibold text-slate-950">{row.v21Score.totalPoints}/20</div>
                  <div className={`text-xs font-semibold ${row.v21Score.awayNeutral ? "text-blue-700" : row.v21Score.fulfilled ? "text-emerald-700" : "text-amber-700"}`}>
                    {row.v21Score.awayNeutral ? "Away-neutral" : row.v21Score.fulfilled ? "erfüllt" : "nicht erfüllt"}
                  </div>
                </td>
                <td className="border-b border-slate-100 px-3 py-3 text-slate-700">
                  <div className="font-semibold text-slate-900">{row.strikeState?.strikeLevel ?? 0}/3</div>
                  <div className="text-xs text-slate-500">{row.strikeState?.fulfilledResetStreak ? `${row.strikeState.fulfilledResetStreak} Reset-Sprint` : "kein Reset offen"}</div>
                </td>
                <td className="border-b border-slate-100 px-3 py-3 text-slate-700">{row.openScore} Score · {row.openScoreObjections} Einwand</td>
                <td className="border-b border-slate-100 px-3 py-3 text-slate-700">{row.hours}h</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </section>
  );
}
