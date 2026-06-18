import type { TaskBlocker } from "@/lib/types";

export function TaskBlockerCard({
  blockers,
  openBlockerCount,
  profileName,
}: {
  blockers: TaskBlocker[];
  openBlockerCount: number;
  profileName: (profileId: string) => string;
}) {
  return (
    <section className="rounded-lg border border-slate-200 bg-white p-5">
      <h2 className="text-sm font-semibold text-slate-950">Blocker</h2>
      <div className="mt-2 text-sm text-slate-600">{openBlockerCount} offen</div>
      <div className="mt-3 grid gap-2">
        {blockers.map((blocker) => (
          <article key={blocker.id} className="rounded-md border border-orange-100 bg-orange-50 px-3 py-2 text-xs text-orange-950">
            <div className="font-semibold">{profileName(blocker.profileId)} · {blocker.status}</div>
            <p className="mt-1 leading-5">{blocker.reason}</p>
          </article>
        ))}
        {!blockers.length && <div className="text-sm text-slate-500">Keine Blocker gemeldet.</div>}
      </div>
    </section>
  );
}
