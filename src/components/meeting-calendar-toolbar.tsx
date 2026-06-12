import { ChevronLeft, ChevronRight } from "lucide-react";
import { CustomSelect } from "@/components/custom-select";
import { profileColor } from "@/lib/meeting-finder";
import type { Profile } from "@/lib/types";

type CalendarView = "week" | "month";

export function MeetingCalendarToolbar({
  calendarView,
  calendarTitle,
  calendarSubtitle,
  currentProfile,
  selectableProfiles,
  selectedProfileIds,
  onToday,
  onMoveCalendar,
  onCalendarViewChange,
  onSelectCurrentProfile,
  onSelectAllProfiles,
  onToggleParticipant,
}: {
  calendarView: CalendarView;
  calendarTitle: string;
  calendarSubtitle: string;
  currentProfile: Profile | null;
  selectableProfiles: Profile[];
  selectedProfileIds: string[];
  onToday: () => void;
  onMoveCalendar: (direction: -1 | 1) => void;
  onCalendarViewChange: (view: CalendarView) => void;
  onSelectCurrentProfile: () => void;
  onSelectAllProfiles: () => void;
  onToggleParticipant: (profileId: string) => void;
}) {
  return (
    <>
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={onToday}
            className="h-9 rounded-full border border-slate-200 bg-white px-4 text-sm font-semibold text-slate-700 hover:bg-slate-50"
          >
            Heute
          </button>
          <div className="flex items-center rounded-full border border-slate-200 bg-white">
            <button
              type="button"
              onClick={() => onMoveCalendar(-1)}
              aria-label={calendarView === "week" ? "Vorherige Woche" : "Vorheriger Monat"}
              className="inline-flex h-9 w-9 items-center justify-center rounded-l-full text-slate-600 hover:bg-slate-50"
            >
              <ChevronLeft className="h-4 w-4" />
            </button>
            <button
              type="button"
              onClick={() => onMoveCalendar(1)}
              aria-label={calendarView === "week" ? "Nächste Woche" : "Nächster Monat"}
              className="inline-flex h-9 w-9 items-center justify-center rounded-r-full text-slate-600 hover:bg-slate-50"
            >
              <ChevronRight className="h-4 w-4" />
            </button>
          </div>
          <div className="min-w-0 px-1">
            <h2 className="truncate text-lg font-semibold text-slate-950">{calendarTitle}</h2>
            <p className="text-xs text-slate-500">{calendarSubtitle}</p>
          </div>
        </div>
        <div className="w-36">
          <CustomSelect
            value={calendarView}
            onChange={(value) => onCalendarViewChange(value as CalendarView)}
            className="h-9 text-sm"
            options={[
              { value: "week", label: "Woche" },
              { value: "month", label: "Monat" },
            ]}
            aria-label="Kalenderansicht wählen"
          />
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
        <p className="text-sm text-slate-500">
          {calendarView === "week"
            ? "Wochenraster wie im Kalender. Schraffierte Flächen liegen außerhalb der FindMyDoc-Arbeitszeit; farbige Blöcke zeigen nur Blocker und Meetings."
            : "Monatsübersicht für Orientierung und schnelle Planung. Die Tagesmarker fassen Blocker und Meetings zusammen."}
        </p>
        <div className="flex flex-wrap gap-2 text-xs font-semibold">
          <span className="rounded-full border border-red-200 bg-red-50 px-2 py-1 text-red-700">Blockiert</span>
          <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-1 text-blue-700">Meeting</span>
          <span className="rounded-full border border-slate-200 bg-[repeating-linear-gradient(135deg,rgba(239,68,68,0.10)_0,rgba(239,68,68,0.10)_6px,rgba(255,255,255,0)_6px,rgba(255,255,255,0)_12px)] px-2 py-1 text-slate-600">Nicht verfügbar</span>
        </div>
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg border border-slate-100 bg-slate-50 px-3 py-2">
        <span className="mr-1 text-xs font-semibold text-slate-500">Kalender anzeigen:</span>
        {currentProfile?.id && (
          <button
            type="button"
            onClick={onSelectCurrentProfile}
            className="h-8 rounded-md border border-blue-200 bg-white px-3 text-xs font-semibold text-blue-700 hover:bg-blue-50"
          >
            Mein Kalender
          </button>
        )}
        <button
          type="button"
          onClick={onSelectAllProfiles}
          className="h-8 rounded-md border border-slate-200 bg-white px-3 text-xs font-semibold text-slate-700 hover:bg-slate-50"
        >
          Alle anzeigen
        </button>
        {selectableProfiles.map((profile) => (
          <button
            key={`calendar-profile-${profile.id}`}
            type="button"
            onClick={() => onToggleParticipant(profile.id)}
            className={`inline-flex h-8 items-center gap-2 rounded-md border px-3 text-xs font-semibold ${selectedProfileIds.includes(profile.id) ? "border-blue-300 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-600"}`}
          >
            <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: profileColor(profile) }} />
            {profile.name}
          </button>
        ))}
      </div>
    </>
  );
}
