import type { PlanningData, Profile, Sprint } from "@/lib/types";
import { UiBadge, UiButton, UiEmptyState, UiPanel, UiTextInput } from "@/shared/atoms/ui-primitives";

export function SprintScoreObjections({
  data,
  sprint,
  currentProfile,
  canManageSprint,
  pending,
  scoreObjectionDraft,
  openObjectionsCount,
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
  onScoreObjectionDraftChange: (value: string) => void;
  onCreateScoreObjection: (sprint: Sprint, comment: string) => void;
  onReviewScoreObjection: (sprint: Sprint, objectionId: number, status: "reviewed" | "dismissed" | "accepted") => void;
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
          return (
            <div key={objection.id} className="grid gap-2 rounded-md border border-slate-100 bg-slate-50 p-3 text-sm">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <span className="font-semibold text-slate-900">{profile?.name || objection.profileId} · {objection.status}</span>
                {canManageSprint && objection.status === "open" && (
                  <div className="flex gap-2">
                    <UiButton disabled={pending} onClick={() => onReviewScoreObjection(sprint, objection.id, "reviewed")} variant="blue" size="sm">Geprüft</UiButton>
                    <UiButton disabled={pending} onClick={() => onReviewScoreObjection(sprint, objection.id, "dismissed")} variant="amber" size="sm">Ablehnen</UiButton>
                    <UiButton disabled={pending} onClick={() => onReviewScoreObjection(sprint, objection.id, "accepted")} variant="emerald" size="sm">Annehmen</UiButton>
                  </div>
                )}
              </div>
              <p className="text-slate-700">{objection.comment}</p>
              {objection.secondReviewerProfileId && <p className="text-xs text-slate-500">Zweitreview: {objection.secondReviewerProfileId}</p>}
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
