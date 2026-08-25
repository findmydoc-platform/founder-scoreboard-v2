"use client";

import { Clock3, Plus, Trash2, X } from "lucide-react";
import { useState } from "react";
import type { usePrivateTeamWorkweek } from "../hooks/use-private-team-workweek";
import { TEAM_WORKWEEK_DAYS, TEAM_WORKWEEK_TIMEZONE, nextMondayIso } from "../model/team-workweek-draft";
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
        <aside className="absolute inset-y-0 right-0 z-10 flex w-full max-w-3xl flex-col overflow-hidden border-l border-slate-200 bg-slate-50 shadow-2xl">
          <header className="flex items-start justify-between gap-4 border-b border-slate-200 bg-white px-4 py-4 sm:px-6">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 id="private-workweek-editor-title" className="text-lg font-semibold text-slate-950">Private Grundwoche</h2>
                <UiBadge tone="amber">In Vorbereitung</UiBadge>
              </div>
              <p className="mt-1 text-sm leading-6 text-slate-500">Neue Version für {profile.name} · {TEAM_WORKWEEK_TIMEZONE}</p>
            </div>
            <UiButton size="iconLg" aria-label="Editor schließen" onClick={requestClose}><X size={18} /></UiButton>
          </header>

          <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5 sm:px-6">
            <div className="grid gap-4">
              <section className="rounded-lg border border-slate-200 bg-white p-4" aria-labelledby="workweek-identity-title">
                <h3 id="workweek-identity-title" className="text-sm font-semibold text-slate-950">Identität & Teamfreigabe</h3>
                <div className="mt-3 grid gap-3 sm:grid-cols-2">
                  <div className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2">
                    <div className="text-xs font-semibold text-slate-500">Eigentümer</div>
                    <div className="mt-1 text-sm font-semibold text-slate-900">{profile.name}</div>
                  </div>
                  <div className="rounded-md border border-slate-100 bg-slate-50 px-3 py-2">
                    <div className="text-xs font-semibold text-slate-500">Teamfreigabe</div>
                    <div className="mt-1 text-sm font-semibold text-slate-900">Privat · nicht veröffentlicht</div>
                  </div>
                </div>
              </section>

              <GoogleWorkspaceConnectionCard apiClient={apiClient} profile={profile} />

              <section className="rounded-lg border border-slate-200 bg-white p-4" aria-labelledby="workweek-validity-title">
                <h3 id="workweek-validity-title" className="text-sm font-semibold text-slate-950">Gültigkeitsbeginn</h3>
                <p className="mt-1 text-sm leading-6 text-slate-500">Montag in Europe/Berlin, frühestens {nextMondayIso()}.</p>
                <CustomDatePicker
                  value={state.draft.effectiveFrom}
                  onChange={state.setEffectiveFrom}
                  disabled={state.pending}
                  aria-label="Gültigkeitsbeginn der Grundwoche"
                  className="mt-3 h-11 w-full sm:max-w-xs"
                />
              </section>

              <section className="rounded-lg border border-slate-200 bg-white p-4" aria-labelledby="workweek-windows-title">
                <div className="flex items-start gap-3">
                  <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-blue-50 text-blue-700" aria-hidden="true"><Clock3 size={17} /></span>
                  <div>
                    <h3 id="workweek-windows-title" className="text-sm font-semibold text-slate-950">Arbeitszeitfenster</h3>
                    <p className="mt-1 text-sm leading-6 text-slate-500">Mehrere Fenster pro Tag sind möglich. Ein Tag ohne Fenster ist frei.</p>
                  </div>
                </div>
                <div className="mt-4 grid gap-3">
                  {TEAM_WORKWEEK_DAYS.map((day) => (
                    <div key={day.key} className="rounded-lg border border-slate-200 p-3">
                      <div className="flex items-center justify-between gap-3">
                        <div>
                          <h4 className="text-sm font-semibold text-slate-900">{day.label}</h4>
                          {!state.draft.windows[day.key].length && <p className="mt-0.5 text-xs text-slate-500">Freier Tag</p>}
                        </div>
                        <UiButton size="sm" onClick={() => state.addWindow(day.key)} disabled={state.pending || state.draft.windows[day.key].length >= 12}>
                          <Plus size={15} /> Fenster
                        </UiButton>
                      </div>
                      {state.draft.windows[day.key].length > 0 && (
                        <div className="mt-3 grid gap-2">
                          {state.draft.windows[day.key].map((window, index) => (
                            <div key={`${day.key}-${index}`} className="grid grid-cols-[1fr_1fr_auto] items-end gap-2">
                              <label className="text-xs font-semibold text-slate-500">
                                Beginn
                                <input
                                  type="time"
                                  value={window.start}
                                  disabled={state.pending}
                                  aria-label={`${day.label}, Fenster ${index + 1}, Beginn`}
                                  onChange={(event) => state.setWindow(day.key, index, { start: event.target.value })}
                                  className="mt-1 h-11 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                                />
                              </label>
                              <label className="text-xs font-semibold text-slate-500">
                                Ende
                                <input
                                  type="time"
                                  value={window.end}
                                  disabled={state.pending}
                                  aria-label={`${day.label}, Fenster ${index + 1}, Ende`}
                                  onChange={(event) => state.setWindow(day.key, index, { end: event.target.value })}
                                  className="mt-1 h-11 w-full rounded-md border border-slate-200 bg-white px-3 text-sm text-slate-900 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
                                />
                              </label>
                              <UiButton size="iconLg" variant="red" aria-label={`${day.label}, Fenster ${index + 1} entfernen`} onClick={() => state.removeWindow(day.key, index)} disabled={state.pending}>
                                <Trash2 size={16} />
                              </UiButton>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  ))}
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

          <footer className="flex flex-col items-stretch justify-between gap-3 border-t border-slate-200 bg-white px-4 py-4 sm:flex-row sm:items-center sm:px-6">
            <p className="text-xs leading-5 text-slate-500">Speichern bleibt privat. Veröffentlichen schreibt zuerst sicher nach Google und gibt die Woche danach im Team frei.</p>
            <div className="grid w-full grid-cols-3 gap-2 sm:flex sm:w-auto">
              <UiButton size="lg" onClick={requestClose} disabled={state.pending}>Schließen</UiButton>
              <UiButton variant="primary" size="lg" data-autofocus onClick={() => void state.save()} disabled={state.pending || !state.dirty}>
                {state.pending ? "Speichert …" : <><span className="sm:hidden">Speichern</span><span className="hidden sm:inline">Private Version speichern</span></>}
              </UiButton>
              <UiButton
                variant="primary"
                size="lg"
                onClick={() => void state.publish().then((published) => published && onClose())}
                disabled={state.pending || state.dirty || !state.version}
              >
                <span className="sm:hidden">Veröffentlichen</span><span className="hidden sm:inline">In Google & Team veröffentlichen</span>
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
