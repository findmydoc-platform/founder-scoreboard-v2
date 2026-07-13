import { ArrowLeft, LockKeyhole } from "lucide-react";
import Link from "next/link";
import { UiBadge } from "@/shared/atoms/ui-primitives";

export function PlanningItemReadOnlyHeader({
  eyebrow,
  title,
  trashed,
}: {
  eyebrow: string;
  title: string;
  trashed: boolean;
}) {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-7xl flex-wrap items-start justify-between gap-4 px-6 py-5">
        <div className="min-w-0">
          <Link href="/planning" className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-blue-700">
            <ArrowLeft size={16} />
            Zur Planung
          </Link>
          <div className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">{eyebrow}</div>
          <h1 className="mt-1 max-w-4xl text-2xl font-semibold tracking-tight text-slate-950">{title}</h1>
        </div>
        <UiBadge tone={trashed ? "red" : "slate"} className="gap-1.5">
          <LockKeyhole size={13} />
          {trashed ? "Papierkorb · Nur lesen" : "Nur lesen"}
        </UiBadge>
      </div>
    </header>
  );
}
