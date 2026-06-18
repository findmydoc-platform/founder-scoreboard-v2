type PlanningMetricsProps = {
  metrics: {
    total: number;
    open: number;
    blocked: number;
    done: number;
  };
};

export function PlanningMetrics({ metrics }: PlanningMetricsProps) {
  return (
    <section className="grid gap-3 px-4 py-4 sm:grid-cols-2 xl:grid-cols-4 lg:px-6">
      {[
        ["Alle Aufgaben", metrics.total],
        ["Offen", metrics.open],
        ["Blockiert/abhängig", metrics.blocked],
        ["Erledigt", metrics.done],
      ].map(([label, value]) => (
        <div key={label} className="rounded-lg border border-slate-200 bg-white px-4 py-3 shadow-sm">
          <div className="text-xs font-medium text-slate-500">{label}</div>
          <div className="mt-1 text-2xl font-semibold text-slate-950">{value}</div>
        </div>
      ))}
    </section>
  );
}
