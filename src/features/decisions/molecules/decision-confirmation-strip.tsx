import type { DecisionItem } from "@/features/decisions/model/decision-log-view-model";
import type { Profile } from "@/lib/types";

type DecisionConfirmationStripProps = {
  currentProfileId: string;
  decision: DecisionItem;
  pending: boolean;
  profiles: Profile[];
  onConfirm: () => void;
};

export function DecisionConfirmationStrip({ currentProfileId, decision, pending, profiles, onConfirm }: DecisionConfirmationStripProps) {
  return (
    <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
      <div className="flex flex-wrap gap-2 text-xs text-slate-600">
        {decision.requiredProfileIds.map((profileId) => {
          const profile = profiles.find((item) => item.id === profileId);
          const confirmed = decision.confirmedProfileIds.includes(profileId);
          return (
            <span key={profileId} className={`rounded-full border px-2 py-1 font-semibold ${confirmed ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-500"}`}>
              {profile?.name || profileId}: {confirmed ? "bestätigt" : "offen"}
            </span>
          );
        })}
      </div>
      <button
        type="button"
        disabled={pending || decision.status === "locked" || !currentProfileId || decision.confirmedProfileIds.includes(currentProfileId)}
        onClick={onConfirm}
        className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
      >
        {decision.confirmedProfileIds.includes(currentProfileId) ? "Bestätigt" : "Bestätigen"}
      </button>
    </div>
  );
}
