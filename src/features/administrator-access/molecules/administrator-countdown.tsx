import { Clock3, ShieldCheck } from "lucide-react";

function countdownLabel(seconds: number) {
  const minutes = Math.floor(seconds / 60);
  const remainder = seconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(remainder).padStart(2, "0")}`;
}

export function AdministratorCountdown({
  className = "",
  remainingSeconds,
}: {
  className?: string;
  remainingSeconds: number;
}) {
  const roundedMinutes = Math.max(1, Math.ceil(remainingSeconds / 60));

  return (
    <div
      className={`inline-flex min-h-9 items-center gap-2 whitespace-nowrap text-sm font-semibold ${className}`}
      aria-label={`Admin-Modus aktiv. Noch etwa ${roundedMinutes} Minuten verbleibend.`}
    >
      <ShieldCheck size={16} className="shrink-0" aria-hidden="true" />
      <span className="sm:hidden">Admin · {countdownLabel(remainingSeconds)}</span>
      <span className="hidden sm:inline">Admin-Modus aktiv</span>
      <span className="hidden sm:inline" aria-hidden="true">·</span>
      <span className="hidden items-center gap-1 sm:inline-flex" aria-hidden="true">
        <Clock3 size={13} />
        {countdownLabel(remainingSeconds)} verbleibend
      </span>
    </div>
  );
}

