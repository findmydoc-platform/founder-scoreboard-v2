"use client";

import { ExternalLink, FileText, Link2, Vote, X } from "lucide-react";
import type { NotionDecisionLogEntry } from "@/lib/notion-decision-log";
import { decisionLogFormLabel, type DecisionLogAttentionReason } from "@/features/decision-log/model/decision-log-view-model";
import { UiBadge, UiButton, type UiTone } from "@/shared/atoms/ui-primitives";
import { useModalDialog } from "@/shared/hooks/use-modal-dialog";

type DecisionDetailProps = {
  entry: NotionDecisionLogEntry;
  reasons: DecisionLogAttentionReason[];
  onClose: () => void;
};

type DecisionDetailContentProps = DecisionDetailProps & {
  titleId: string;
};

const reasonTones: Record<DecisionLogAttentionReason["tone"], UiTone> = {
  amber: "amber",
  blue: "blue",
  orange: "orange",
  red: "red",
  slate: "slate",
};

function formatDate(value: string) {
  if (!value) return "–";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("de-DE", { dateStyle: "medium" }).format(date);
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div className="grid grid-cols-[7rem_minmax(0,1fr)] gap-4 border-b border-slate-100 py-2.5 text-sm last:border-b-0">
      <dt className="min-w-0 break-words text-slate-500">{label}</dt>
      <dd className="min-w-0 break-words font-medium text-slate-800">{value || "–"}</dd>
    </div>
  );
}

function DetailLink({ href, icon: Icon, children }: { href: string; icon: typeof ExternalLink; children: string }) {
  return (
    <a
      className="inline-flex min-h-9 items-center gap-2 rounded-md px-1 text-sm font-semibold text-blue-700 hover:text-blue-900 focus:outline-none focus:ring-2 focus:ring-blue-100"
      href={href}
      rel="noreferrer"
      target="_blank"
    >
      <Icon size={16} aria-hidden="true" />
      {children}
    </a>
  );
}

function DecisionDetailContent({ entry, reasons, onClose, titleId }: DecisionDetailContentProps) {
  return (
    <>
      <header className="flex items-start justify-between gap-4 border-b border-slate-200 px-5 py-4">
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Entscheidungsdetails</div>
          <h2 id={titleId} className="mt-3 text-xl font-semibold leading-7 text-slate-950">{entry.decision}</h2>
          {entry.category && <UiBadge tone="slate" size="xs" className="mt-3">{entry.category}</UiBadge>}
        </div>
        <UiButton data-autofocus type="button" variant="ghost" size="iconMd" onClick={onClose} aria-label="Entscheidungsdetails schließen">
          <X size={18} />
        </UiButton>
      </header>

      <div className="grid gap-6 p-5">
        {entry.summary && <p className="text-sm leading-6 text-slate-600">{entry.summary}</p>}

        <section>
          <h3 className="text-sm font-semibold text-slate-800">Beschluss</h3>
          <p className="mt-2 whitespace-pre-wrap text-sm leading-6 text-slate-600">
            {entry.resolution || "Noch kein abschließender Beschluss dokumentiert."}
          </p>
        </section>

        <section className="border-t border-slate-200 pt-5">
          <h3 className="text-sm font-semibold text-slate-800">Warum Handlungsbedarf?</h3>
          {reasons.length ? (
            <ul className="mt-3 grid gap-3">
              {reasons.map((reason) => (
                <li key={reason.key} className="flex items-start gap-3 text-sm leading-6 text-slate-600">
                  <UiBadge tone={reasonTones[reason.tone]} size="xs" className="mt-0.5 shrink-0">{reason.label}</UiBadge>
                  <span>{reason.explanation}</span>
                </li>
              ))}
            </ul>
          ) : <p className="mt-2 text-sm text-slate-500">Aktuell ist kein offener Handlungsgrund abgeleitet.</p>}
        </section>

        <section className="border-t border-slate-200 pt-3">
          <h3 className="sr-only">Governance</h3>
          <dl>
            <DetailField label="Status" value={entry.status} />
            <DetailField label="Erforderliche Zustimmung" value={entry.requiredApproval} />
            <DetailField label="Abstimmung" value={entry.vote} />
            <DetailField label="Bestätigung" value={entry.confirmation} />
            <DetailField label="Owner" value={entry.owners.join(", ")} />
            <DetailField label="Entscheidungskreis" value={entry.decisionCircle.join(", ")} />
            <DetailField label="Datum" value={formatDate(entry.date)} />
            <DetailField label="Review-Datum" value={formatDate(entry.reviewDate)} />
          </dl>
        </section>

        {(entry.notionUrl || entry.googleFormUrl || entry.sourceUrl || entry.pdfArchiveUrl) && (
          <section className="grid gap-1 border-t border-slate-200 pt-4" aria-label="Quellen und Nachweise">
            {entry.googleFormUrl && <DetailLink href={entry.googleFormUrl} icon={Vote}>{decisionLogFormLabel(entry)}</DetailLink>}
            {entry.notionUrl && <DetailLink href={entry.notionUrl} icon={ExternalLink}>In Notion öffnen ↗</DetailLink>}
            {entry.sourceUrl && <DetailLink href={entry.sourceUrl} icon={Link2}>Quelle / Meeting öffnen ↗</DetailLink>}
            {entry.pdfArchiveUrl && <DetailLink href={entry.pdfArchiveUrl} icon={FileText}>PDF-Archiv öffnen ↗</DetailLink>}
          </section>
        )}
      </div>
    </>
  );
}

export function DecisionDetailPanel(props: DecisionDetailProps) {
  return (
    <aside className="sticky top-24 hidden max-h-[calc(100dvh-7rem)] overflow-y-auto border border-slate-200 bg-white xl:block" aria-labelledby="decision-detail-desktop-title">
      <DecisionDetailContent {...props} titleId="decision-detail-desktop-title" />
    </aside>
  );
}

export function DecisionDetailSheet({ entry, reasons, onClose }: DecisionDetailProps) {
  const dialogRef = useModalDialog<HTMLElement>({ open: true, onClose });
  return (
    <div className="fixed inset-0 z-50 xl:hidden">
      <button type="button" className="absolute inset-0 cursor-default bg-slate-950/30" onClick={onClose} aria-label="Detailbereich im Hintergrund schließen" />
      <aside
        ref={dialogRef}
        tabIndex={-1}
        role="dialog"
        aria-modal="true"
        aria-labelledby="decision-detail-mobile-title"
        className="absolute inset-y-0 right-0 w-full max-w-lg overflow-y-auto border-l border-slate-200 bg-white shadow-2xl"
      >
        <DecisionDetailContent entry={entry} reasons={reasons} onClose={onClose} titleId="decision-detail-mobile-title" />
      </aside>
    </div>
  );
}
