"use client";

import { CalendarDays, X } from "lucide-react";
import type { PublishedTeamWorkweek } from "../model/published-team-workweek";
import { TeamWorkweekMatrix } from "../molecules/team-workweek-matrix";
import type { Profile } from "@/lib/types";
import { UiBadge, UiButton, UiEmptyState, UiNotice } from "@/shared/atoms/ui-primitives";
import { useModalDialog } from "@/shared/hooks/use-modal-dialog";

export function TeamWorkweekQuickViewDialog({
  message,
  onClose,
  onOpenTeam,
  pending,
  profiles,
  workweeks,
}: {
  message: string;
  onClose: () => void;
  onOpenTeam: () => void;
  pending: boolean;
  profiles: Profile[];
  workweeks: PublishedTeamWorkweek[];
}) {
  const dialogRef = useModalDialog<HTMLDivElement>({ open: true, onClose });

  return (
    <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="team-workweek-quick-view-title" className="fixed inset-0 z-[60] flex items-stretch justify-center p-0 sm:p-4 lg:p-8">
      <button type="button" tabIndex={-1} aria-label="Team-Arbeitswoche schließen" className="absolute inset-0 cursor-default bg-slate-950/35 backdrop-blur-[1px]" onClick={onClose} />
      <section className="relative z-10 flex h-full max-h-full min-h-0 w-full max-w-7xl flex-col overflow-hidden bg-slate-50 shadow-2xl sm:rounded-2xl sm:border sm:border-slate-200">
        <header className="flex shrink-0 items-start justify-between gap-4 border-b border-slate-200 bg-white px-4 py-4 sm:px-6">
          <div className="flex min-w-0 items-start gap-3">
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full bg-blue-50 text-blue-700" aria-hidden="true"><CalendarDays size={19} /></span>
            <div className="min-w-0">
              <div className="flex flex-wrap items-center gap-2">
                <h2 id="team-workweek-quick-view-title" className="text-lg font-semibold text-slate-950">Team-Arbeitswoche</h2>
                <UiBadge tone="slate">Nur Lesen</UiBadge>
              </div>
              <p className="mt-1 text-sm leading-6 text-slate-500">Aktive veröffentlichte Grundwochen · Europe/Berlin</p>
            </div>
          </div>
          <UiButton data-autofocus size="iconLg" variant="secondary" aria-label="Schnellansicht schließen" onClick={onClose}><X size={18} /></UiButton>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-3 py-4 sm:px-6 sm:py-6">
          {pending && !workweeks.length ? (
            <UiEmptyState className="min-h-48" tone="muted">Team-Arbeitswoche wird geladen.</UiEmptyState>
          ) : message ? (
            <UiNotice tone="warning" role="status">{message}</UiNotice>
          ) : (
            <TeamWorkweekMatrix compact profiles={profiles} workweeks={workweeks} />
          )}
        </div>

        <footer className="flex shrink-0 justify-end border-t border-slate-200 bg-white px-4 py-3 sm:px-6">
          <UiButton className="min-h-11 w-full sm:w-auto" variant="primary" onClick={onOpenTeam}>Im Team öffnen</UiButton>
        </footer>
      </section>
    </div>
  );
}
