import { UiBadge, UiPanel } from "@/shared/atoms/ui-primitives";

export function DecisionLogSummary({ decisionCount }: { decisionCount: number }) {
  return (
    <UiPanel>
      <div className="flex items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-slate-950">Decision Log</h2>
          <p className="mt-1 text-sm text-slate-500">CEO-only Edit, Founder-Bestätigung und Locking nach vollständiger Zustimmung.</p>
        </div>
        <UiBadge tone="white" size="md">{decisionCount} Decisions</UiBadge>
      </div>
    </UiPanel>
  );
}
