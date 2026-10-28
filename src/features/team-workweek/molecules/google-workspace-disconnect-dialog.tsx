"use client";

import { Unplug } from "lucide-react";
import type { GoogleWorkspaceDisconnectView } from "../model/google-workspace-connection";
import { UiButton } from "@/shared/atoms/ui-primitives";
import { useModalDialog } from "@/shared/hooks/use-modal-dialog";

export function GoogleWorkspaceDisconnectDialog({
  disconnect,
  onCancel,
  onConfirm,
  open,
  pending,
  previewPending = false,
  previewReady = true,
  previewError = "",
  confirmationCurrent = true,
}: {
  disconnect: GoogleWorkspaceDisconnectView;
  onCancel: () => void;
  onConfirm: () => void;
  open: boolean;
  pending: boolean;
  previewPending?: boolean;
  previewReady?: boolean;
  previewError?: string;
  confirmationCurrent?: boolean;
}) {
  const dialogRef = useModalDialog<HTMLDivElement>({ open, onClose: onCancel, closeDisabled: pending });
  if (!open) return null;

  return (
    <div
      ref={dialogRef}
      tabIndex={-1}
      role="alertdialog"
      aria-modal="true"
      aria-labelledby="google-disconnect-title"
      aria-describedby={previewReady ? "google-disconnect-description" : undefined}
      className="fixed inset-0 z-[80] grid place-items-center bg-slate-950/40 p-4"
    >
      <div className="w-full max-w-lg rounded-xl border border-slate-200 bg-white shadow-2xl">
        <div className="flex items-start gap-3 px-5 py-5">
          <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-amber-50 text-amber-700" aria-hidden="true">
            <Unplug size={19} />
          </span>
          <div>
            <h2 id="google-disconnect-title" className="text-lg font-semibold text-slate-950">Google-Verbindung wirklich trennen?</h2>
            {previewPending && <p role="status" className="mt-2 text-sm text-slate-600">Trennungsvorschau wird geladen …</p>}
            {previewError && <p role="alert" className="mt-2 text-sm text-amber-800">{previewError} Schließe die Vorschau und versuche es erneut.</p>}
            {previewReady && <><p id="google-disconnect-description" className="mt-2 text-sm leading-6 text-slate-600">
              Beim Trennen:
            </p>
            <ul className="mt-3 list-disc space-y-2 pl-5 text-sm leading-6 text-slate-700">
              <li>{disconnect.futureSeriesCount} FounderOps-Terminserie{disconnect.futureSeriesCount === 1 ? "" : "n"} für die Zukunft entfernen oder am letzten vergangenen Termin beenden.</li>
              <li>Deine Arbeitswoche aus der Teamansicht entfernen. Sie bleibt privat gespeichert und inaktiv.</li>
              <li>Danach die Verbindung und gespeicherten Zugangsdaten entfernen. Die Freigabe bei Google bleibt bestehen, bis du sie dort widerrufst.</li>
            </ul>
            <p className="mt-3 text-sm leading-6 text-slate-600">
              Vergangene FounderOps-Termine und andere Kalendertermine bleiben unverändert. Eine spätere Verbindung veröffentlicht die Woche nicht automatisch.
            </p></>}
          </div>
        </div>
        <div className="flex flex-wrap justify-end gap-2 border-t border-slate-200 px-5 py-4">
          <UiButton variant="secondary" size="lg" onClick={onCancel} disabled={pending}>Abbrechen</UiButton>
          <UiButton variant="red" size="lg" data-autofocus onClick={onConfirm} disabled={pending || !previewReady || previewPending || !confirmationCurrent}>
            {pending ? "Trennung läuft …" : "Verbindung trennen"}
          </UiButton>
        </div>
      </div>
    </div>
  );
}
