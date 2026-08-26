"use client";

import { Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import type { usePrivateTeamWorkweek } from "../hooks/use-private-team-workweek";
import { TEAM_WORKWEEK_DAYS, TEAM_WORKWEEK_TIMEZONE } from "../model/team-workweek-draft";
import { formatDate } from "@/lib/display";
import { GoogleWorkspaceConnectionCard } from "../molecules/google-workspace-connection-card";
import { TeamWorkweekDiscardDialog } from "../molecules/team-workweek-discard-dialog";
import type { BrowserApiClient } from "@/lib/browser-api-client";
import type { Profile } from "@/lib/types";
import { CustomDatePicker } from "@/shared/atoms/custom-date-picker";
import { UiBadge, UiButton, UiNotice } from "@/shared/atoms/ui-primitives";
import { useModalDialog } from "@/shared/hooks/use-modal-dialog";

type WorkweekState = ReturnType<typeof usePrivateTeamWorkweek>;

export function PrivateTeamWorkweekEditor({
  apiClient,
  profile,
  state,
  onClose,
}: {
  apiClient: BrowserApiClient;
  profile: Profile;
  state: WorkweekState;
  onClose: () => void;
}) {
  const [discardOpen, setDiscardOpen] = useState(false);
  const requestClose = () => state.dirty ? setDiscardOpen(true) : onClose();
  const dialogRef = useModalDialog<HTMLDivElement>({ open: true, onClose: requestClose, closeDisabled: discardOpen });

  return (
    <>
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="private-workweek-editor-title" className="fixed inset-0 z-40">
        <button type="button" tabIndex={-1} aria-label="Arbeitswochen-Editor schließen" className="absolute inset-0 cursor-default bg-slate-950/30 backdrop-blur-[1px]" onClick={requestClose} />
        <aside className="absolute inset-y-0 right-0 z-10 flex w-full max-w-[440px] flex-col overflow-hidden border-l border-slate-200 bg-slate-50 shadow-2xl">
          <header className="flex items-start justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 id="private-workweek-editor-title" className="text-base font-semibold text-slate-950">Eigene Regelwoche</h2>
                <UiBadge size="xs" tone="amber">{state.publication?.syncState === "delayed" ? "Synchronisierung verzögert" : "In Vorbereitung"}</UiBadge>
              </div>
              <p className="mt-0.5 text-xs leading-5 text-slate-500">
                {profile.name} · {state.publication?.syncState === "delayed" ? "Bisherige Teamversion sichtbar" : "Privat · nicht veröffentlicht"} · {TEAM_WORKWEEK_TIMEZONE}
              </p>
            </div>
            <UiButton size="iconLg" aria-label="Editor schließen" onClick={requestClose}><X size={18} /></UiButton>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3 sm:px-4">
            <div className="grid gap-3">
              <GoogleWorkspaceConnectionCard compact apiClient={apiClient} profile={profile} />

              <section className="overflow-hidden rounded-lg border border-slate-200 bg-white" aria-labelledby="workweek-windows-title">
                <div className="px-3 py-2.5">
                  <h3 id="workweek-windows-title" className="text-sm font-semibold text-slate-950">Arbeitszeitfenster</h3>
                  <p className="mt-0.5 text-xs leading-5 text-slate-500">Mehrere Fenster sind möglich. Ohne Fenster bleibt der Tag frei.</p>
                </div>
                <div className="divide-y divide-slate-100 border-t border-slate-100">
                  {TEAM_WORKWEEK_DAYS.map((day) => (
                    <div
                      key={day.key}
                      className={state.draft.windows[day.key].length
                        ? "grid grid-cols-[1.5rem_minmax(0,1fr)] items-start gap-1.5 px-3 py-2 min-[400px]:grid-cols-[1.5rem_minmax(0,1fr)_auto]"
                        : "grid grid-cols-[1.5rem_minmax(0,1fr)_auto] items-start gap-1.5 px-3 py-2"}
                    >
                      <h4 className="pt-2 text-sm font-semibold text-slate-900" title={day.label}>{day.shortLabel}</h4>
                      {state.draft.windows[day.key].length > 0 && (
                        <div className="grid min-w-0 gap-2">
                          {state.draft.windows[day.key].map((window, index) => (
                            <div key={`${day.key}-${index}`} className="grid min-w-0 grid-cols-[minmax(0,1fr)_auto_minmax(0,1fr)_auto] items-center gap-1">
                              <label className="min-w-0">
                                <span className="sr-only">{day.label}, Fenster {index + 1}, Beginn</span>
                                <input
                                  type="time"
                                  value={window.start}
                                  disabled={state.pending}
                                  aria-label={`${day.label}, Fenster ${index + 1}, Beginn`}
                                  onChange={(event) => state.setWindow(day.key, index, { start: event.target.value })}
                                  className="h-9 w-full min-w-0 rounded-md border border-slate-200 bg-white px-1.5 text-sm text-slate-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 [@media(pointer:coarse)]:h-11"
                                />
                              </label>
                              <span className="text-xs font-semibold text-slate-400" aria-hidden="true">–</span>
                              <label className="min-w-0">
                                <span className="sr-only">{day.label}, Fenster {index + 1}, Ende</span>
                                <input
                                  type="time"
                                  value={window.end}
                                  disabled={state.pending}
                                  aria-label={`${day.label}, Fenster ${index + 1}, Ende`}
                                  onChange={(event) => state.setWindow(day.key, index, { end: event.target.value })}
                                  className="h-9 w-full min-w-0 rounded-md border border-slate-200 bg-white px-1.5 text-sm text-slate-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100 [@media(pointer:coarse)]:h-11"
                                />
                              </label>
                              <UiButton size="iconMd" variant="red" aria-label={`${day.label}, Fenster ${index + 1} entfernen`} onClick={() => state.removeWindow(day.key, index)} disabled={state.pending}>
                                <Trash2 size={16} />
                              </UiButton>
                            </div>
                          ))}
                        </div>
                      )}
                      {!state.draft.windows[day.key].length && <p className="py-2 text-sm text-slate-400">Freier Tag</p>}
                      <UiButton
                        className={state.draft.windows[day.key].length
                          ? "col-start-2 mt-1 justify-self-start min-[400px]:col-start-3 min-[400px]:row-start-1 min-[400px]:mt-0"
                          : "justify-self-start"}
                        size="iconMd"
                        onClick={() => state.addWindow(day.key)}
                        disabled={state.pending || state.draft.windows[day.key].length >= 12}
                        aria-label={state.draft.windows[day.key].length ? `${day.label}: weiteres Fenster hinzufügen` : `${day.label}: Fenster hinzufügen`}
                        title={state.draft.windows[day.key].length ? "Weiteres Fenster hinzufügen" : "Fenster hinzufügen"}
                      >
                        <Plus size={14} />
                      </UiButton>
                    </div>
                  ))}
                </div>
              </section>

              <section className="rounded-lg border border-slate-200 bg-white p-3" aria-labelledby="workweek-validity-title">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <h3 id="workweek-validity-title" className="text-sm font-semibold text-slate-950">Gültigkeitsbeginn</h3>
                    <p className="mt-0.5 text-xs leading-5 text-slate-500">Montag, frühestens {formatDate(state.minimumEffectiveFrom)}</p>
                  </div>
                  <CustomDatePicker
                    value={state.draft.effectiveFrom}
                    onChange={state.setEffectiveFrom}
                    disabled={state.pending}
                    aria-label="Gültigkeitsbeginn der Grundwoche"
                    className="h-9 w-full sm:w-[180px] [@media(pointer:coarse)]:h-11"
                  />
                </div>
              </section>

              {state.errors.length > 0 && (
                <UiNotice tone="danger" role="alert">
                  <div className="font-semibold">Bitte korrigiere die Grundwoche:</div>
                  <ul className="mt-1 list-disc pl-5">{state.errors.map((error) => <li key={error}>{error}</li>)}</ul>
                </UiNotice>
              )}
              {state.message && <UiNotice tone={state.messageTone === "success" ? "success" : "warning"} aria-live="polite">{state.message}</UiNotice>}
            </div>
          </div>

          <footer className="border-t border-slate-200 bg-white px-3 py-2.5 sm:px-4">
            <p className="mb-2 text-xs leading-4 text-slate-500">Privat speichern. Nach bestätigtem Google-Abgleich veröffentlichen.</p>
            <div className="grid w-full grid-cols-2 gap-1.5 min-[400px]:grid-cols-[auto_minmax(0,1fr)_auto]">
              <UiButton className="hidden whitespace-nowrap min-[400px]:inline-flex" size="md" onClick={requestClose} disabled={state.pending}>Schließen</UiButton>
              <UiButton className="whitespace-nowrap px-2 text-xs" variant="primary" size="md" data-autofocus onClick={() => void state.save()} disabled={state.pending || !state.dirty}>
                {state.pending ? "Speichert …" : "Privat speichern"}
              </UiButton>
              <UiButton
                variant="primary"
                size="md"
                className="whitespace-nowrap px-2 text-xs"
                aria-label="In Google & Team veröffentlichen"
                onClick={() => void state.publish().then((published) => published && onClose())}
                disabled={state.pending || state.dirty || !state.version}
              >
                Veröffentlichen
              </UiButton>
            </div>
          </footer>
        </aside>
      </div>

      <TeamWorkweekDiscardDialog
        open={discardOpen}
        onKeepEditing={() => setDiscardOpen(false)}
        onDiscard={() => {
          state.reset();
          setDiscardOpen(false);
          onClose();
        }}
      />
    </>
  );
}
