import { ScoreObjectionReviewControls } from "@/features/sprint/molecules/score-objection-review-controls";
import type { FounderSprintScore, PlanningData, Profile, ScoreObjectionResolutionInput, Sprint } from "@/lib/types";
import { UiBadge, UiButton, UiEmptyState, UiPanel, UiTextInput } from "@/shared/atoms/ui-primitives";

export function SprintScoreObjections({
  data,
  sprint,
  currentProfile,
  canManageSprint,
  pending,
  scoreObjectionDraft,
  openObjectionsCount,
  scores,
  onScoreObjectionDraftChange,
  onCreateScoreObjection,
  onReviewScoreObjection,
}: {
  data: Pick<PlanningData, "profiles" | "scoreObjections">;
  sprint: Sprint;
  currentProfile: Profile | null;
  canManageSprint: boolean;
  pending: boolean;
  scoreObjectionDraft: string;
  openObjectionsCount: number;
  scores: Array<Pick<FounderSprintScore, "profileId" | "deliveryPoints" | "formPoints" | "weeklyPoints">>;
  onScoreObjectionDraftChange: (value: string) => void;
  onCreateScoreObjection: (sprint: Sprint, comment: string) => void;
  onReviewScoreObjection: (sprint: Sprint, objectionId: number, input: ScoreObjectionResolutionInput) => void;
}) {
  return (
    <UiPanel className="min-w-0">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-950">Score-Einwände</h2>
          <p className="text-xs text-slate-500">Einwände müssen vor dem Sprint-Lock geprüft sein. Es gibt maximal einen Zweitreview.</p>
        </div>
        <UiBadge tone="white" size="md">{openObjectionsCount} offen</UiBadge>
      </div>
      <div className="mt-3 grid gap-2">
        {data.scoreObjections.filter((item) => item.sprintId === sprint.id).map((objection) => {
          const profile = data.profiles.find((item) => item.id === objection.profileId);
          const score = scores.find((item) => item.profileId === objection.profileId) || {
            deliveryPoints: 0,
            formPoints: 0,
            weeklyPoints: 0,
          };
          const reviewer = data.profiles.find((item) => item.id === objection.reviewedBy);
          const secondReviewer = data.profiles.find((item) => item.id === objection.secondReviewerProfileId);
          return (
            <div key={objection.id} className="grid gap-2 rounded-md border border-slate-100 bg-slate-50 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-slate-900">{profile?.name || objection.profileId} · {objection.status}</span>
              </div>
              <p className="text-slate-700">{objection.comment}</p>
              {objection.resolutionComment && (
                <p className="text-xs text-slate-600">Entscheidung {reviewer?.name || objection.reviewedBy}: {objection.resolutionComment}</p>
              )}
              {objection.status === "accepted" && objection.resolvedDeliveryPoints !== null && (
                <p className="text-xs font-medium text-emerald-700">
                  Korrigierter Score: {objection.resolvedDeliveryPoints + (objection.resolvedFormPoints || 0) + (objection.resolvedWeeklyPoints || 0)}/20
                  {` · Delivery ${objection.resolvedDeliveryPoints}/12 · Form ${objection.resolvedFormPoints || 0}/4 · Weekly ${objection.resolvedWeeklyPoints || 0}/4`}
                </p>
              )}
              {objection.secondReviewerProfileId && (
                <p className="text-xs text-slate-500">Zweitreview {secondReviewer?.name || objection.secondReviewerProfileId}: {objection.secondReviewDecision}</p>
              )}
              {canManageSprint && (
                <ScoreObjectionReviewControls
                  objection={objection}
                  currentProfile={currentProfile}
                  currentScore={score}
                  pending={pending}
                  onSubmit={(input) => onReviewScoreObjection(sprint, objection.id, input)}
                />
              )}
            </div>
          );
        })}
        {!data.scoreObjections.some((item) => item.sprintId === sprint.id) && <UiEmptyState>Noch keine Score-Einwände.</UiEmptyState>}
      </div>
      {!sprint.scoreLocked && currentProfile && (
        <form
          className="mt-3 flex flex-col gap-2 sm:flex-row"
          onSubmit={(event) => {
            event.preventDefault();
            if (!scoreObjectionDraft.trim()) return;
            onCreateScoreObjection(sprint, scoreObjectionDraft);
            onScoreObjectionDraftChange("");
          }}
        >
          <UiTextInput
            value={scoreObjectionDraft}
            onChange={(event) => onScoreObjectionDraftChange(event.target.value)}
            className="flex-1 px-3"
            placeholder="Sachlich begründeten Score-Einwand einreichen"
          />
          <UiButton type="submit" disabled={pending || !scoreObjectionDraft.trim()}>Einwand speichern</UiButton>
        </form>
      )}
    </UiPanel>
  );
}
