import { CustomDatePicker } from "@/shared/atoms/custom-date-picker";
import { CustomSelect } from "@/shared/atoms/custom-select";
import { formatDate } from "@/lib/display";
import { durationOptions, formatLongDateLabel, googleCalendarUrl, timeOptions, type MeetingSlot } from "@/features/meetings/model/meeting-finder";
import type { Profile } from "@/lib/types";
import { UiBadge, UiButton, UiNotice, UiPanel, UiTextArea, UiTextInput } from "@/shared/atoms/ui-primitives";

type ParticipantOption = { value: string; label: string };

export function MeetingSlotSearchSection({
  workingHoursCount,
  blockersCount,
  slots,
  selectedProfileIds,
  selectableProfiles,
  googleCalendarProfiles,
  lastGoogleSync,
  calendarSyncMessage,
  pending,
  canManageAvailability,
  canReserveMeetingSlot,
  fromDate,
  toDate,
  duration,
  customDuration,
  searchStartTime,
  searchEndTime,
  searchStartMinutes,
  searchEndMinutes,
  meetingTitle,
  meetingAgenda,
  meetingCreateMessage,
  profileNameById,
  onSyncGoogleCalendar,
  onFromDateChange,
  onToDateChange,
  onDurationChange,
  onCustomDurationChange,
  onSearchStartTimeChange,
  onSearchEndTimeChange,
  onMeetingTitleChange,
  onMeetingAgendaChange,
  onSelectedProfileIdsChange,
  onToggleParticipant,
  onReserveSlot,
}: {
  workingHoursCount: number;
  blockersCount: number;
  slots: MeetingSlot[];
  selectedProfileIds: string[];
  selectableProfiles: Profile[];
  googleCalendarProfiles: Profile[];
  lastGoogleSync: string;
  calendarSyncMessage: string;
  pending: boolean;
  canManageAvailability: boolean;
  canReserveMeetingSlot: boolean;
  fromDate: string;
  toDate: string;
  duration: string;
  customDuration: string;
  searchStartTime: string;
  searchEndTime: string;
  searchStartMinutes: number;
  searchEndMinutes: number;
  meetingTitle: string;
  meetingAgenda: string;
  meetingCreateMessage: string;
  profileNameById: Map<string, string>;
  onSyncGoogleCalendar: () => void;
  onFromDateChange: (value: string) => void;
  onToDateChange: (value: string) => void;
  onDurationChange: (value: string) => void;
  onCustomDurationChange: (value: string) => void;
  onSearchStartTimeChange: (value: string) => void;
  onSearchEndTimeChange: (value: string) => void;
  onMeetingTitleChange: (value: string) => void;
  onMeetingAgendaChange: (value: string) => void;
  onSelectedProfileIdsChange: (value: string[]) => void;
  onToggleParticipant: (profileId: string) => void;
  onReserveSlot: (slot: MeetingSlot) => void;
}) {
  const selectedProfiles = selectableProfiles.filter((profile) => selectedProfileIds.includes(profile.id));
  const fullSlots = slots.filter((slot) => slot.matchType === "full");
  const visibleSlots = slots.slice(0, 12);
  const nextRecommendedSlot = slots[0];
  const participantOptions: ParticipantOption[] = selectableProfiles.map((profile) => ({
    value: profile.id,
    label: selectedProfileIds.includes(profile.id) ? `${profile.name} aktiv` : profile.name,
  }));
  const calendarReady = googleCalendarProfiles.length > 0;

  return (
    <>
      <UiPanel className="min-w-0">
        <h2 className="text-base font-semibold text-slate-950">Meeting Finder</h2>
        <p className="mt-2 text-sm leading-6 text-slate-600">Findet gemeinsame Slots aus findmydoc-Arbeitszeiten, Arbeit, Urlaub, Krankheit, bestehenden Meetings und Kalenderblockern.</p>
        <div className="mt-4 grid grid-cols-1 gap-2 text-sm min-[360px]:grid-cols-2">
          <div className="rounded-md bg-slate-50 p-3"><div className="text-xs text-slate-500">Arbeitszeiten</div><div className="font-semibold">{workingHoursCount}</div></div>
          <div className="rounded-md bg-slate-50 p-3"><div className="text-xs text-slate-500">Blocker</div><div className="font-semibold">{blockersCount}</div></div>
          <div className="rounded-md bg-emerald-50 p-3"><div className="text-xs text-emerald-700">Volle Treffer</div><div className="font-semibold text-emerald-900">{fullSlots.length}</div></div>
          <div className="rounded-md bg-blue-50 p-3"><div className="text-xs text-blue-700">Teilnehmer</div><div className="font-semibold text-blue-900">{selectedProfiles.length}</div></div>
        </div>
        <div className="mt-4 rounded-lg border border-slate-200 bg-slate-50 p-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0">
            <div className="font-semibold text-slate-950">Kalenderverbindung</div>
            <p className="mt-1 text-sm leading-6 text-slate-600">
                {calendarReady ? `${googleCalendarProfiles.length} Teammitglied${googleCalendarProfiles.length === 1 ? "" : "er"} berücksichtigen belegte Zeiten.` : "Noch kein Kalender für die Suche verbunden."}
              </p>
            </div>
            <UiBadge tone={calendarReady ? "emerald" : "slate"}>{calendarReady ? "bereit" : "nicht verbunden"}</UiBadge>
            <UiButton
              onClick={onSyncGoogleCalendar}
              disabled={pending || !canManageAvailability}
              variant="blueOutline"
              size="md"
              className="w-full text-xs sm:w-auto"
            >
              Kalender aktualisieren
            </UiButton>
          </div>
          {(lastGoogleSync || calendarSyncMessage) && (
            <details className="mt-3 border-t border-slate-200 pt-3">
              <summary className="cursor-pointer text-xs font-semibold text-slate-600">Kalenderdetails anzeigen</summary>
              <div className="mt-2 grid gap-2 text-xs leading-5 text-slate-600">
                {lastGoogleSync && <div>Letzte Aktualisierung: {formatDate(lastGoogleSync)}</div>}
                {calendarSyncMessage && <div className="rounded-md border border-slate-200 bg-white px-2 py-1 font-semibold text-slate-700">{calendarSyncMessage}</div>}
              </div>
            </details>
          )}
        </div>
      </UiPanel>
      <UiPanel className="min-w-0">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-950">Freie Slots finden</h2>
            <p className="mt-1 text-sm text-slate-500">Volle Treffer werden zuerst gezeigt, Teilmatches bleiben sichtbar, damit du schnell entscheiden kannst.</p>
          </div>
          <UiBadge>{visibleSlots.length}/{slots.length} Slots</UiBadge>
        </div>
        <div className="mt-4 grid gap-3 lg:grid-cols-[1fr_1fr_160px_140px_140px]">
          <CustomDatePicker value={fromDate} onChange={onFromDateChange} className="h-9 text-sm" aria-label="Startdatum wählen" />
          <CustomDatePicker value={toDate} onChange={onToDateChange} className="h-9 text-sm" aria-label="Enddatum wählen" />
          <CustomSelect value={duration} onChange={onDurationChange} className="h-9 text-sm" options={durationOptions} aria-label="Meetingdauer wählen" />
          <CustomSelect value={searchStartTime} onChange={onSearchStartTimeChange} className="h-9 text-sm" options={timeOptions} aria-label="Früheste Startzeit wählen" />
          <CustomSelect value={searchEndTime} onChange={onSearchEndTimeChange} className="h-9 text-sm" options={timeOptions} aria-label="Späteste Endzeit wählen" />
        </div>
        {duration === "custom" && (
          <div className="mt-3 grid gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-3 sm:grid-cols-[180px_1fr]">
            <label className="text-xs font-semibold text-slate-500" htmlFor="meeting-custom-duration">Eigene Dauer in Minuten</label>
            <UiTextInput
              id="meeting-custom-duration"
              type="number"
              min={15}
              max={480}
              step={15}
              value={customDuration}
              onChange={(event) => onCustomDurationChange(event.target.value)}
              className="px-3"
              placeholder="z. B. 120"
            />
          </div>
        )}
        {searchStartMinutes >= searchEndMinutes && (
          <UiNotice tone="warning" className="mt-3 font-semibold leading-normal">
            Das Zeitfenster ist ungültig. Die früheste Startzeit muss vor der spätesten Endzeit liegen.
          </UiNotice>
        )}
        <div className="mt-4 grid gap-3 rounded-lg border border-slate-100 bg-slate-50 p-3">
          <div className="text-sm font-semibold text-slate-950">Meeting vormerken</div>
          <UiTextInput
            value={meetingTitle}
            onChange={(event) => onMeetingTitleChange(event.target.value)}
            className="px-3"
            placeholder="Meeting-Titel"
          />
          <UiTextArea
            value={meetingAgenda}
            onChange={(event) => onMeetingAgendaChange(event.target.value)}
            className="min-h-20 px-3"
            placeholder="Agenda oder Kontext"
          />
          <p className="text-xs leading-5 text-slate-500">
            Ein Slot legt ein internes Meeting an und aktualisiert den Kalender, wenn eine Verbindung besteht.
          </p>
          {meetingCreateMessage && <UiNotice tone="success" className="px-2 py-1 text-xs font-semibold leading-normal">{meetingCreateMessage}</UiNotice>}
        </div>
        {nextRecommendedSlot && (
          <div className="mt-4 rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-3 text-sm">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-xs font-semibold uppercase tracking-wide text-emerald-700">Empfohlener Slot</div>
                <div className="mt-1 font-semibold text-emerald-950">{formatLongDateLabel(nextRecommendedSlot.date)} · {nextRecommendedSlot.startTime}-{nextRecommendedSlot.endTime}</div>
              </div>
              <div className="flex flex-wrap gap-2">
                <UiButton
                  onClick={() => onReserveSlot(nextRecommendedSlot)}
                  disabled={pending || !canReserveMeetingSlot}
                  variant="emeraldPrimary"
                  size="sm"
                >
                  In App anlegen
                </UiButton>
                <a
                  href={googleCalendarUrl(nextRecommendedSlot, selectedProfiles, meetingTitle, meetingAgenda)}
                  target="_blank"
                  rel="noreferrer"
                  className="inline-flex h-8 items-center rounded-md border border-emerald-200 bg-white px-3 text-xs font-semibold text-emerald-800 hover:bg-emerald-100"
                >
                  Google-Termin öffnen
                </a>
              </div>
            </div>
          </div>
        )}
        <div className="mt-3 flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => onSelectedProfileIdsChange(selectedProfileIds.length === selectableProfiles.length ? [] : selectableProfiles.map((profile) => profile.id))}
            className="h-8 rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
          >
            {selectedProfileIds.length === selectableProfiles.length ? "Alle abwählen" : "Alle wählen"}
          </button>
          {participantOptions.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => onToggleParticipant(option.value)}
              className={`h-8 rounded-md border px-3 text-xs font-semibold ${selectedProfileIds.includes(option.value) ? "border-blue-300 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-600"}`}
            >
              {option.label}
            </button>
          ))}
        </div>
        <div className="mt-4 grid gap-2">
          {visibleSlots.map((slot) => (
            <div
              key={`${slot.date}-${slot.startTime}-${slot.endTime}`}
              role="button"
              tabIndex={canReserveMeetingSlot && !pending ? 0 : -1}
              onClick={() => {
                if (!pending && canReserveMeetingSlot) onReserveSlot(slot);
              }}
              onKeyDown={(event) => {
                if (!pending && canReserveMeetingSlot && (event.key === "Enter" || event.key === " ")) {
                  event.preventDefault();
                  onReserveSlot(slot);
                }
              }}
              className={`rounded-lg border px-3 py-2 text-sm ${canReserveMeetingSlot && !pending ? "cursor-pointer hover:ring-2 hover:ring-emerald-100" : ""} ${slot.matchType === "full" ? "border-emerald-200 bg-emerald-50" : "border-amber-200 bg-amber-50"}`}
            >
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="font-semibold text-slate-950">{formatLongDateLabel(slot.date)} · {slot.startTime}-{slot.endTime}</div>
                <div className="flex flex-wrap items-center gap-2">
                  <span className={`rounded-full border bg-white px-2 py-0.5 text-xs font-semibold ${slot.matchType === "full" ? "border-emerald-200 text-emerald-700" : "border-amber-200 text-amber-700"}`}>
                    {slot.availableProfileIds.length}/{selectedProfileIds.length} verfügbar
                  </span>
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation();
                      onReserveSlot(slot);
                    }}
                    disabled={pending || !canReserveMeetingSlot}
                    className="rounded-full border border-emerald-200 bg-white px-2 py-0.5 text-xs font-semibold text-emerald-700 hover:bg-emerald-50 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    In App anlegen
                  </button>
                  <a
                    href={googleCalendarUrl(slot, selectedProfiles, meetingTitle, meetingAgenda)}
                    target="_blank"
                    rel="noreferrer"
                    onClick={(event) => event.stopPropagation()}
                    className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-xs font-semibold text-slate-600 hover:bg-slate-50"
                  >
                    Kalender
                  </a>
                </div>
              </div>
              <div className="mt-1 text-xs leading-5 text-slate-600">Verfügbar: {slot.availableProfileIds.map((id) => profileNameById.get(id) || id).join(", ") || "niemand"}</div>
              {slot.unavailable.length > 0 && (
                <div className="mt-1 text-xs leading-5 text-amber-800">
                  Nicht verfügbar: {slot.unavailable.map((item) => `${profileNameById.get(item.profileId) || item.profileId} (${item.reason})`).join(", ")}
                </div>
              )}
            </div>
          ))}
          {!visibleSlots.length && (
            <div className="rounded-lg border border-dashed border-slate-300 bg-slate-50 px-4 py-8 text-center text-sm text-slate-500">
              Keine passenden Slots. Prüfe Arbeitszeiten, verkürze die Dauer oder wähle weniger Teilnehmer.
            </div>
          )}
        </div>
      </UiPanel>
    </>
  );
}
