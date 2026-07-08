import type { TaskFocusItem } from "@/lib/types";

type ExecutionMetrics = {
  criticalAlerts: number;
  reviewQueue: number;
  openBlockers: number;
};

export function ExecutionMetricsStrip({
  isOperationalLead,
  executionMetrics,
  teamFocusCoverage,
  focusItems,
}: {
  isOperationalLead: boolean;
  executionMetrics: ExecutionMetrics;
  teamFocusCoverage: number;
  focusItems: TaskFocusItem[];
}) {
  const metrics = [
    [isOperationalLead ? "Kritische Alerts" : "Meine kritischen Alerts", executionMetrics.criticalAlerts, "text-red-700"],
    [isOperationalLead ? "Review Queue" : "Meine Review Queue", executionMetrics.reviewQueue, "text-blue-700"],
    [isOperationalLead ? "Blockiert/abhängig" : "Meine Blocker", executionMetrics.openBlockers, "text-amber-700"],
    [isOperationalLead ? "Team-Fokus gesetzt" : "Mein Fokus", isOperationalLead ? `${teamFocusCoverage}%` : `${focusItems.length}/3`, "text-emerald-700"],
  ] as const;

  return (
    <section className="xl:col-span-2 grid grid-cols-1 min-w-0 gap-3 sm:grid-cols-2 xl:grid-cols-4">
      {metrics.map(([label, value, tone]) => (
        <div key={label} className="min-w-0 rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <div className="text-xs font-semibold text-slate-500">{label}</div>
          <div className={`mt-1 text-2xl font-semibold ${tone}`}>{value}</div>
        </div>
      ))}
    </section>
  );
}
