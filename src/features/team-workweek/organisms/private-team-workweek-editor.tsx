"use client";

import { Plus, Trash2, X } from "lucide-react";
import { useEffect, useRef, useState, type RefObject } from "react";
import type { usePrivateTeamWorkweek } from "../hooks/use-private-team-workweek";
import { formatTeamWorkweekActivation, TEAM_WORKWEEK_DAYS, TEAM_WORKWEEK_TIMEZONE } from "../model/team-workweek-draft";
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
  restoreFocusRef,
}: {
  apiClient: BrowserApiClient;
  profile: Profile;
  state: WorkweekState;
  onClose: () => void;
  restoreFocusRef?: RefObject<HTMLElement | null>;
}) {
  const validityFocusRef = useRef<HTMLInputElement>(null);
  const restartFocusRequested = useRef(false);

  const [discardOpen, setDiscardOpen] = useState(false);
  const hasTransitionClockLabel = state.draft.windows.sunday.some((window) =>
    [window.start, window.end].some((clock) => clock >= "02:00" && clock < "03:00"));
  const requestClose = () => {
    if (state.pending) return;
    if (state.dirty) setDiscardOpen(true);
    else onClose();
  };
  const dialogRef = useModalDialog<HTMLDivElement>({ open: true, onClose: requestClose, closeDisabled: discardOpen || state.pending, restoreFocusRef });
  useEffect(() => {
    if (restartFocusRequested.current && !state.pending && !state.restartAvailable && !state.restartContextPending) {
      restartFocusRequested.current = false;
      (validityFocusRef.current || dialogRef.current)?.focus({ preventScroll: true });
    }
  }, [dialogRef, state.pending, state.restartAvailable, state.restartContextPending]);

  return (
    <>
      <div ref={dialogRef} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="private-workweek-editor-title" className="fixed inset-0 z-40">
        <button type="button" tabIndex={-1} aria-label="Arbeitswochen-Editor schließen" className="absolute inset-0 cursor-default bg-slate-950/30 backdrop-blur-[1px]" onClick={requestClose} />
        <aside className="absolute inset-y-0 right-0 z-10 flex w-full max-w-[440px] flex-col overflow-clip border-l border-slate-200 bg-slate-50 shadow-2xl">
          <header className="flex items-start justify-between gap-3 border-b border-slate-200 bg-white px-4 py-3">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h2 id="private-workweek-editor-title" className="text-base font-semibold text-slate-950">Meine Arbeitswoche bearbeiten</h2>
                <UiBadge size="xs" tone="amber">{state.publication?.syncState === "delayed" ? "Synchronisierung verzögert" : "Bearbeitung"}</UiBadge>
              </div>
              <p className="mt-0.5 text-xs leading-5 text-slate-500">
                {profile.name} · {state.publication?.syncState === "delayed" ? "Bisheriger Teamstand sichtbar" : "Privat · nicht veröffentlicht"} · {TEAM_WORKWEEK_TIMEZONE}
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
                  <p className="mt-0.5 text-xs leading-5 text-slate-500">Mehrere Fenster sind möglich. Ohne Fenster ist keine Arbeitszeit eingeplant.</p>
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
                        <div className="grid min-w-0 gap-2 max-[359px]:col-span-2 max-[359px]:row-start-2">
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
                      {!state.draft.windows[day.key].length && <p className="py-2 text-sm text-slate-600">Kein Arbeitszeitfenster</p>}
                      <UiButton
                        className={state.draft.windows[day.key].length
                          ? "col-start-2 mt-1 justify-self-start max-[359px]:col-start-1 max-[359px]:row-start-3 min-[400px]:col-start-3 min-[400px]:row-start-1 min-[400px]:mt-0"
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
                {hasTransitionClockLabel && (
                  <p className="border-t border-slate-100 px-3 py-2 text-xs leading-5 text-slate-500">
                    Sonntagszeiten zwischen 02:00 und 03:00: Doppelte Uhrzeiten zählen beim ersten Vorkommen; fehlende Uhrzeiten werden eine Stunde später eingeplant. Leere Fenster entfallen; überschneidende Zeiten werden zusammengefasst.
                  </p>
                )}
              </section>

              <section data-tour-id="workweek-validity" className="rounded-lg border border-slate-200 bg-white p-3" aria-labelledby="workweek-validity-title">
                <h3 id="workweek-validity-title" className="text-sm font-semibold text-slate-950">Gültigkeitsbeginn</h3>
                {state.immediateAllowed && (
                  <fieldset className="mt-2 grid gap-1" disabled={state.pending}>
                    <legend className="sr-only">Gültigkeitsbeginn wählen</legend>
                    <label className="flex min-h-11 items-center gap-2 text-sm text-slate-800">
                      <input ref={validityFocusRef} type="radio" name="workweek-activation-mode" value="immediate" checked={state.draft.activationMode === "immediate"}
                        onChange={() => state.setActivationMode("immediate")} className="h-4 w-4 accent-blue-600" />
                      Nach Bestätigung · aktuelle Woche
                    </label>
                    <label className="flex min-h-11 items-center gap-2 text-sm text-slate-800">
                      <input type="radio" name="workweek-activation-mode" value="future_monday" checked={state.draft.activationMode !== "immediate"}
                        onChange={() => state.setActivationMode("future_monday")} className="h-4 w-4 accent-blue-600" />
                      Zukünftiger Montag
                    </label>
                  </fieldset>
                )}
                {state.draft.activationMode === "immediate" && state.immediateAllowed ? (
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    {state.restartAvailable
                      ? "Beginne mit dem aktuellen Stand neu. Deine Eingaben bleiben erhalten."
                      : state.publication?.effectiveAt && !state.dirty
                      ? state.publicationExpired
                        ? "Der geplante Beginn ist abgelaufen. Wiederhole die Veröffentlichung; ein neuer zukünftiger Beginn wird bestätigt."
                        : `Geplanter Beginn: ${formatTeamWorkweekActivation(state.publication.effectiveAt)}. Erst nach vollständiger Bestätigung gültig.`
                      : "2–3 Minuten Vorlauf. Der genaue Beginn wird bestätigt; vergangene Zeiten bleiben unverändert."}
                  </p>
                ) : (
                  <div className="mt-2 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                    <p className="text-xs leading-5 text-slate-500">Montag, frühestens {formatDate(state.minimumEffectiveFrom)}</p>
                    <CustomDatePicker value={state.draft.effectiveFrom} onChange={state.setEffectiveFrom} disabled={state.pending}
                      aria-label="Gültigkeitsbeginn der Arbeitswoche" className="h-9 w-full sm:w-[180px] [@media(pointer:coarse)]:h-11" />
                  </div>
                )}
                {state.draft.activationMode === "immediate" && state.preparedSuccessor && (
                  <p className="mt-1 text-xs leading-5 text-slate-500">
                    Geplante Änderung am {new Intl.DateTimeFormat("de-DE", { timeZone: TEAM_WORKWEEK_TIMEZONE, day: "2-digit", month: "short", year: "numeric" }).format(new Date(state.preparedSuccessor.effectiveAt || `${state.preparedSuccessor.effectiveFrom}T12:00:00Z`))} bleibt erhalten. Diese Korrektur gilt bis dahin.
                  </p>
                )}
              </section>

              {state.mustRestartBeforeSaving && !state.message && (
                <UiNotice tone="warning">
                  Ein früherer Veröffentlichungsversuch ist noch offen. {state.restartAvailable
                    ? "Beginne mit dem aktuellen Stand neu, bevor du diese Änderungen speicherst oder veröffentlichst."
                    : "Der gespeicherte Versuch muss zuerst geklärt werden."} Deine Eingaben bleiben hier im Editor erhalten.
                </UiNotice>
              )}
              {(state.restartAvailable || state.restartContextPending) && (
                <UiButton className="justify-self-start whitespace-normal text-left" variant="secondary" onClick={() => { restartFocusRequested.current = true; void state.restart(); }} disabled={state.pending}>
                  {state.restartContextPending ? "Aktuellen Stand laden" : "Mit aktuellem Stand neu beginnen"}
                </UiButton>
              )}
              {state.errors.length > 0 && (
                <UiNotice tone="danger" role="alert">
                  <div className="font-semibold">Bitte korrigiere deine Arbeitswoche:</div>
                  <ul className="mt-1 list-disc pl-5">{state.errors.map((error) => <li key={error}>{error}</li>)}</ul>
                </UiNotice>
              )}
              {state.message && <UiNotice tone={state.messageTone === "success" ? "success" : "warning"} aria-live="polite">{state.message}</UiNotice>}
            </div>
          </div>

          <footer className="border-t border-slate-200 bg-white px-3 py-2.5 sm:px-4">
            <p className="mb-2 text-xs leading-4 text-slate-500">
              {state.draft.activationMode === "immediate"
                ? `${state.preparedSuccessor ? "" : "Gilt dauerhaft. "}Bei Verzögerung wird ein neuer zukünftiger Beginn geplant.`
                : `Änderungen gelten ab ${formatDate(state.draft.effectiveFrom)} und werden erst nach dem Google-Abgleich veröffentlicht.`}
            </p>
            <div className="grid w-full grid-cols-2 gap-1.5 min-[400px]:grid-cols-3">
              <UiButton className="whitespace-nowrap max-[399px]:hidden min-[400px]:inline-flex" size="md" onClick={requestClose} disabled={state.pending}>Schließen</UiButton>
              <UiButton className="whitespace-nowrap px-2 text-xs" variant="secondary" size="md" aria-label="Änderung privat speichern" onClick={() => void state.save()} disabled={state.pending || !state.dirty || state.mustRestartBeforeSaving}>
                Privat speichern
              </UiButton>
              <UiButton
                variant="primary"
                size="md"
                className="whitespace-nowrap px-2 text-xs"
                data-tour-id="workweek-publish"
                aria-label="Änderung in Google & Team veröffentlichen"
                onClick={() => void state.publish().then((result) => (result === true || result === "conflict") && onClose())}
                disabled={state.pending || state.restartContextPending || state.mustRestartBeforeSaving}
              >
                {state.pending ? "Bitte warten …" : "Veröffentlichen"}
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
