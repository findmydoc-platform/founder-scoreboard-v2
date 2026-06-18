import type { PlanningData, Profile, Sprint } from "@/lib/types";

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
    <section className="min-w-0 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-950">Score-Einwände</h2>
          <p className="text-xs text-slate-500">Einwände müssen vor dem Sprint-Lock geprüft sein. Es gibt maximal einen Zweitreview.</p>
        </div>
        <span className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600">{openObjectionsCount} offen</span>
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
                    <button type="button" disabled={pending} onClick={() => onReviewScoreObjection(sprint, objection.id, "reviewed")} className="h-8 rounded-md border border-blue-200 bg-blue-50 px-3 text-xs font-semibold text-blue-700 disabled:opacity-50">Geprüft</button>
                    <button type="button" disabled={pending} onClick={() => onReviewScoreObjection(sprint, objection.id, "dismissed")} className="h-8 rounded-md border border-amber-200 bg-amber-50 px-3 text-xs font-semibold text-amber-700 disabled:opacity-50">Ablehnen</button>
                    <button type="button" disabled={pending} onClick={() => onReviewScoreObjection(sprint, objection.id, "accepted")} className="h-8 rounded-md border border-emerald-200 bg-emerald-50 px-3 text-xs font-semibold text-emerald-700 disabled:opacity-50">Annehmen</button>
                  </div>
                )}
              </div>
              <p className="text-slate-700">{objection.comment}</p>
              {objection.secondReviewerProfileId && <p className="text-xs text-slate-500">Zweitreview: {objection.secondReviewerProfileId}</p>}
            </div>
          );
        })}
        {!data.scoreObjections.some((item) => item.sprintId === sprint.id) && <div className="rounded-md border border-dashed border-slate-200 px-3 py-4 text-center text-sm text-slate-500">Noch keine Score-Einwände.</div>}
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
          <input
            value={scoreObjectionDraft}
            onChange={(event) => onScoreObjectionDraftChange(event.target.value)}
            className="h-9 flex-1 rounded-md border border-slate-200 px-3 text-sm outline-none focus:border-blue-400"
            placeholder="Sachlich begründeten Score-Einwand einreichen"
          />
          <button type="submit" disabled={pending || !scoreObjectionDraft.trim()} className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 disabled:opacity-50">Einwand speichern</button>
        </form>
      )}
    </section>
  );
}
