type CalendarDaySummary = {
  open: number;
  blocked: number;
  meetings: number;
  closed: number;
};

export function MeetingCalendarMonthView({
  dates,
  activeMonth,
  today,
  daySummary,
}: {
  dates: string[];
  activeMonth: number;
  today: string;
  daySummary: (date: string) => CalendarDaySummary;
}) {
  return (
    <div className="mt-4 overflow-hidden rounded-lg border border-slate-200">
      <div className="grid grid-cols-7 border-b border-slate-200 bg-slate-50">
        {["Mo", "Di", "Mi", "Do", "Fr", "Sa", "So"].map((weekday) => (
          <div key={`month-head-${weekday}`} className="border-l border-slate-200 px-3 py-2 text-xs font-semibold uppercase text-slate-500 first:border-l-0">
            {weekday}
          </div>
        ))}
      </div>
      <div className="grid grid-cols-7 bg-white">
        {dates.map((date) => {
          const summary = daySummary(date);
          const isMuted = new Date(`${date}T00:00:00`).getMonth() !== activeMonth;
          const dayNumber = new Intl.DateTimeFormat("de-DE", { day: "2-digit" }).format(new Date(`${date}T00:00:00`));
          return (
            <div key={`month-cell-${date}`} className={`min-h-32 border-l border-t border-slate-100 p-2 first:border-l-0 ${isMuted ? "bg-slate-50 text-slate-400" : "bg-white text-slate-900"}`}>
              <div className="flex items-center justify-between gap-2">
                <span className="text-sm font-semibold">{dayNumber}</span>
                {date === today && <span className="rounded-full bg-blue-600 px-2 py-0.5 text-[10px] font-semibold text-white">Heute</span>}
              </div>
              <div className="mt-3 grid gap-1 text-[11px] font-semibold">
                {summary.blocked > 0 && <div className="rounded border border-red-200 bg-red-50 px-2 py-1 text-red-700">{summary.blocked} blockiert</div>}
                {summary.meetings > 0 && <div className="rounded border border-blue-200 bg-blue-50 px-2 py-1 text-blue-700">{summary.meetings} Meeting</div>}
                {summary.open === 0 && summary.blocked === 0 && summary.meetings === 0 && (
                  <div
                    className="min-h-14 rounded border border-transparent"
                    title="Nicht verfügbar"
                    style={{
                      backgroundImage: "repeating-linear-gradient(135deg, rgba(239, 68, 68, 0.08) 0, rgba(239, 68, 68, 0.08) 6px, rgba(255, 255, 255, 0) 6px, rgba(255, 255, 255, 0) 12px)",
                    }}
                  />
                )}
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
