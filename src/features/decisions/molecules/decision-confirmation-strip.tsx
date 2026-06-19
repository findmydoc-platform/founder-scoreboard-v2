import type { DecisionItem } from "@/features/decisions/model/decision-log-view-model";
import type { Profile } from "@/lib/types";
import { UiBadge, UiButton } from "@/shared/atoms/ui-primitives";

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
            <UiBadge key={profileId} tone={confirmed ? "emerald" : "slate"} size="sm" className={!confirmed ? "text-slate-500" : undefined}>
              {profile?.name || profileId}: {confirmed ? "bestätigt" : "offen"}
            </UiBadge>
          );
        })}
      </div>
      <UiButton
        type="button"
        disabled={pending || decision.status === "locked" || !currentProfileId || decision.confirmedProfileIds.includes(currentProfileId)}
        onClick={onConfirm}
      >
        {decision.confirmedProfileIds.includes(currentProfileId) ? "Bestätigt" : "Bestätigen"}
      </UiButton>
    </div>
  );
}
