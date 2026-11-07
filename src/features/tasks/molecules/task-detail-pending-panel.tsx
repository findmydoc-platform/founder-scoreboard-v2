"use client";

import { useState, type RefObject } from "react";
import { X } from "lucide-react";
import { useModalDialog } from "@/shared/hooks/use-modal-dialog";
import { UiButton } from "@/shared/atoms/ui-primitives";

type Props = {
  restoreFocusRef?: RefObject<HTMLElement | null>;
  error: string;
  loading: boolean;
  onRetry: () => void;
  onClose: () => void;
  onBack?: () => void;
};

export function TaskDetailPendingPanel({ error, loading, onRetry, onClose, onBack, restoreFocusRef }: Props) {
  const [retryRequested, setRetryRequested] = useState(false);
  const dialogRef = useModalDialog<HTMLDivElement>({ open: true, onClose, restoreFocusRef });
  return <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-label="Item-Detail" className="fixed inset-0 z-30">
    <button type="button" tabIndex={-1} aria-label="Detailpanel schließen" onClick={onClose} className="absolute inset-0 cursor-default bg-slate-950/25 backdrop-blur-[1px]" />
    <aside className="absolute inset-y-0 right-0 z-10 flex w-full max-w-[920px] flex-col border-l border-slate-200 bg-white shadow-xl">
      <div className="flex items-center justify-between gap-3 border-b border-slate-200 px-4 py-3 sm:px-6">
        {onBack ? <UiButton type="button" size="lg" onClick={onBack}>Zurück</UiButton> : <span className="text-xs font-semibold uppercase tracking-wide text-slate-500">Item-Detail</span>}
        <UiButton type="button" size="lg" aria-label="Detailpanel schließen" onClick={onClose}><X size={17} aria-hidden="true" /></UiButton>
      </div>
      <div className="p-4 text-sm text-slate-700 sm:p-6" aria-busy={loading}>
        {loading || !error ? <p role="status">Aufgabendetails werden geladen …</p> : <p role="alert">{error}</p>}
        {error || retryRequested ? <UiButton type="button" size="lg" aria-disabled={loading} className="mt-3" onClick={() => { if (!loading) { setRetryRequested(true); onRetry(); } }}>Erneut laden</UiButton> : null}
      </div>
    </aside>
  </div>;
}
