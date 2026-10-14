import { AdministratorCountdown } from "@/features/administrator-access/molecules/administrator-countdown";
import { UiButton } from "@/shared/atoms/ui-primitives";

export function AdministratorModeIndicator({
  busy,
  onEnd,
  remainingSeconds,
}: {
  busy: boolean;
  onEnd: () => void;
  remainingSeconds: number;
}) {
  const roundedMinutes = Math.max(1, Math.ceil(remainingSeconds / 60));

  return (
    <div
      role="status"
      aria-label={`Admin-Modus aktiv. Noch etwa ${roundedMinutes} Minuten verbleibend.`}
      data-tone="critical"
      className="inline-flex min-h-10 max-w-full items-center gap-2 rounded-lg border border-red-300 bg-red-50 px-2 py-1 text-sm font-semibold text-red-950 shadow-sm"
    >
      <AdministratorCountdown remainingSeconds={remainingSeconds} className="text-red-950 [&_svg]:text-red-600" />
      <UiButton
        variant="red"
        size="xs"
        disabled={busy}
        onClick={onEnd}
        aria-label="Admin-Modus beenden"
        className="ml-1"
      >
        Beenden
      </UiButton>
    </div>
  );
}
