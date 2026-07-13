import { ArchiveX } from "lucide-react";
import type { PlanningTrashMetadata } from "@/lib/planning-trash-detail";
import { formatTrashDateTime, trashCauseLabel, trashRootLabel } from "@/features/planning-trash/model/planning-trash-display";
import { UiBadge } from "@/shared/atoms/ui-primitives";

export function PlanningTrashBanner({
  trash,
  githubLifecycle,
}: {
  trash: PlanningTrashMetadata;
  githubLifecycle: string;
}) {
  return (
    <section className="rounded-lg border border-red-200 bg-red-50 p-5 text-red-950" aria-label="Papierkorb-Status">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="flex items-start gap-3">
          <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-red-100 text-red-700">
            <ArchiveX size={18} />
          </div>
          <div>
            <h2 className="font-semibold">Dieses Element befindet sich im Papierkorb.</h2>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-red-800">
              Es bleibt bis zur automatischen Bereinigung sichtbar, kann hier aber nicht bearbeitet oder freigegeben werden.
            </p>
          </div>
        </div>
        <UiBadge tone="red">{trashCauseLabel(trash.cause)}</UiBadge>
      </div>

      <dl className="mt-4 grid gap-3 border-t border-red-200 pt-4 text-sm sm:grid-cols-2 xl:grid-cols-4">
        <div><dt className="font-semibold text-red-700">Begründung</dt><dd className="mt-1 whitespace-pre-wrap">{trash.reason}</dd></div>
        <div><dt className="font-semibold text-red-700">Ausgeführt von</dt><dd className="mt-1">{trash.actorName}</dd></div>
        <div><dt className="font-semibold text-red-700">Zeitpunkt</dt><dd className="mt-1">{formatTrashDateTime(trash.trashedAt)}</dd></div>
        <div><dt className="font-semibold text-red-700">Bereinigung ab</dt><dd className="mt-1">{formatTrashDateTime(trash.purgeAfter)}</dd></div>
        <div><dt className="font-semibold text-red-700">Papierkorb-Wurzel</dt><dd className="mt-1 break-all">{trashRootLabel(trash)}</dd></div>
        <div><dt className="font-semibold text-red-700">Papierkorb-Revision</dt><dd className="mt-1">{trash.revision}</dd></div>
        <div className="sm:col-span-2"><dt className="font-semibold text-red-700">GitHub-Lifecycle</dt><dd className="mt-1">{githubLifecycle}</dd></div>
      </dl>
    </section>
  );
}
