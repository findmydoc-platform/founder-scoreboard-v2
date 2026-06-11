import {
  availabilitySummaryTone,
  calendarBlockPosition,
  hexToRgba,
  minutesToTime,
  type CalendarBlock,
  type CalendarCell,
} from "@/lib/meeting-finder";
import type { AvailabilityEntry } from "@/lib/types";

type CalendarSelection = {
  date: string;
  start: number;
  end: number;
};

type CalendarDrag = {
  entry: AvailabilityEntry;
} | null;

type CalendarDragPreview = {
  date: string;
  start: number;
  end: number;
  label: string;
  color: string;
} | null;

export function MeetingCalendarWeekView({
  dates,
  hours,
  calendarSelection,
  calendarDrag,
  calendarDragPreview,
  calendarCellFor,
  calendarBlocksForDate,
  canEditAvailabilityEntry,
  onBeginCalendarSelection,
  onExtendCalendarSelection,
  onFinishCalendarSelection,
  onMoveCalendarBlockDrag,
  onFinishCalendarBlockDrag,
  onBeginCalendarBlockDrag,
  onCalendarBlockClick,
}: {
  dates: string[];
  hours: number[];
  calendarSelection: CalendarSelection | null;
  calendarDrag: CalendarDrag;
  calendarDragPreview: CalendarDragPreview;
  calendarCellFor: (date: string, start: number) => CalendarCell;
  calendarBlocksForDate: (date: string) => CalendarBlock[];
  canEditAvailabilityEntry: (entry: AvailabilityEntry) => boolean;
  onBeginCalendarSelection: (date: string, start: number) => void;
  onExtendCalendarSelection: (date: string, start: number) => void;
  onFinishCalendarSelection: () => void;
  onMoveCalendarBlockDrag: (date: string, start: number) => void;
  onFinishCalendarBlockDrag: () => void;
  onBeginCalendarBlockDrag: (entry: AvailabilityEntry, date: string, start: number, end: number) => void;
  onCalendarBlockClick: (entry: AvailabilityEntry) => void;
}) {
  return (
    <div className="mt-4 overflow-x-auto rounded-lg border border-slate-200">
      <div className="min-w-[980px] select-none">
        <div className="grid grid-cols-[72px_repeat(7,minmax(132px,1fr))] border-b border-slate-200 bg-white">
          <div className="px-3 py-3 text-xs font-semibold text-slate-500">GMT+02</div>
          {dates.map((date) => (
            <div key={date} className="border-l border-slate-200 px-3 py-2">
              <div className="text-[11px] font-semibold uppercase text-slate-500">{new Intl.DateTimeFormat("de-DE", { weekday: "short" }).format(new Date(`${date}T00:00:00`))}</div>
              <div className="mt-0.5 text-lg font-semibold text-slate-950">{new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit" }).format(new Date(`${date}T00:00:00`))}</div>
            </div>
          ))}
        </div>
        {hours.map((hour) => (
          <div key={hour} className="grid grid-cols-[72px_repeat(7,minmax(132px,1fr))] border-b border-slate-100 last:border-b-0">
            <div className="bg-white px-3 py-2 text-xs font-semibold text-slate-500">{minutesToTime(hour)}</div>
            {dates.map((date) => {
              const cell = calendarCellFor(date, hour);
              const dateBlocks = calendarBlocksForDate(date);
              const activeBlock = dateBlocks.find((block) => block.start < hour + 60 && block.end > hour);
              const visibleBlock = activeBlock?.entry && calendarDrag?.entry.id === activeBlock.entry.id ? undefined : activeBlock;
              const startsHere = visibleBlock ? visibleBlock.start >= hour && visibleBlock.start < hour + 60 : false;
              const blockPosition = visibleBlock ? calendarBlockPosition(visibleBlock.start, visibleBlock.end, hour) : null;
              const selectionStartsHere = Boolean(calendarSelection?.date === date && calendarSelection.start >= hour && calendarSelection.start < hour + 60);
              const selectionPosition = calendarSelection && selectionStartsHere ? calendarBlockPosition(calendarSelection.start, calendarSelection.end, hour) : null;
              const dragPreviewStartsHere = Boolean(calendarDragPreview?.date === date && calendarDragPreview.start >= hour && calendarDragPreview.start < hour + 60);
              const dragPreviewPosition = calendarDragPreview && dragPreviewStartsHere ? calendarBlockPosition(calendarDragPreview.start, calendarDragPreview.end, hour) : null;
              return (
                <div
                  key={`${date}-${hour}`}
                  className="relative h-16 overflow-visible border-l border-slate-100 bg-white px-1 py-1"
                  onMouseDown={(event) => {
                    event.preventDefault();
                    if (!visibleBlock && !calendarDrag) onBeginCalendarSelection(date, hour);
                  }}
                  onMouseEnter={() => calendarDrag ? onMoveCalendarBlockDrag(date, hour) : onExtendCalendarSelection(date, hour)}
                  onMouseUp={() => calendarDrag ? onFinishCalendarBlockDrag() : onFinishCalendarSelection()}
                >
                  {dragPreviewStartsHere && calendarDragPreview && dragPreviewPosition && (
                    <div
                      className="pointer-events-none absolute left-1 right-1 z-30 overflow-hidden rounded-md border bg-white/90 px-2 py-1.5 pl-3 text-left text-xs leading-4 shadow-xl ring-2 ring-blue-200"
                      style={{
                        top: `${dragPreviewPosition.top}px`,
                        height: `${dragPreviewPosition.height}px`,
                        borderColor: hexToRgba(calendarDragPreview.color, 0.5),
                        backgroundColor: hexToRgba(calendarDragPreview.color, 0.14),
                        boxShadow: `inset 3px 0 0 ${calendarDragPreview.color}`,
                      }}
                    >
                      <div className="truncate font-semibold text-slate-950">{calendarDragPreview.label}</div>
                      <div className="mt-0.5 truncate text-[11px] font-medium text-slate-700">{minutesToTime(calendarDragPreview.start)} bis {minutesToTime(calendarDragPreview.end)}</div>
                    </div>
                  )}
                  {selectionStartsHere && calendarSelection && selectionPosition && (
                    <div
                      className="pointer-events-none absolute left-1 right-1 z-10 rounded-md border border-blue-300 bg-blue-50/85 px-2 py-1.5 text-xs font-semibold text-blue-900 shadow-sm"
                      style={{ top: `${selectionPosition.top}px`, height: `${selectionPosition.height}px` }}
                    >
                      <div>Blocker anlegen</div>
                      <div className="mt-0.5 font-normal text-blue-700">{minutesToTime(calendarSelection.start)} bis {minutesToTime(calendarSelection.end)}</div>
                    </div>
                  )}
                  {startsHere && visibleBlock && blockPosition ? (
                    <button
                      type="button"
                      onMouseDown={(event) => {
                        event.preventDefault();
                        event.stopPropagation();
                        if (visibleBlock.entry) onBeginCalendarBlockDrag(visibleBlock.entry, date, visibleBlock.start, visibleBlock.end);
                      }}
                      onMouseUp={(event) => {
                        event.stopPropagation();
                        if (calendarDrag) onFinishCalendarBlockDrag();
                      }}
                      onClick={(event) => {
                        event.stopPropagation();
                        if (visibleBlock.entry) onCalendarBlockClick(visibleBlock.entry);
                      }}
                      className={`absolute left-1 right-1 z-20 overflow-hidden rounded-md border bg-white/95 px-2 py-1.5 pl-3 text-left text-xs leading-4 shadow-sm ${visibleBlock.entry && canEditAvailabilityEntry(visibleBlock.entry) ? "cursor-grab hover:ring-2 hover:ring-blue-100 active:cursor-grabbing" : "cursor-default"}`}
                      style={{
                        top: `${blockPosition.top}px`,
                        height: `${blockPosition.height}px`,
                        borderColor: hexToRgba(visibleBlock.color, 0.42),
                        backgroundColor: visibleBlock.kind === "meeting" ? hexToRgba(visibleBlock.color, 0.16) : hexToRgba(visibleBlock.color, 0.10),
                        color: visibleBlock.color,
                        boxShadow: `inset 3px 0 0 ${visibleBlock.color}`,
                      }}
                      title={`${visibleBlock.ownerName ? `${visibleBlock.ownerName} · ` : ""}${visibleBlock.label}${visibleBlock.detail ? ` · ${visibleBlock.detail}` : ""}`}
                    >
                      <div className="truncate font-semibold text-slate-950">{visibleBlock.label}</div>
                      {visibleBlock.detail && <div className="mt-0.5 truncate text-[11px] font-medium text-slate-700">{visibleBlock.detail}</div>}
                    </button>
                  ) : visibleBlock ? (
                    <div className="h-full rounded-md border border-transparent bg-white" title={`${visibleBlock.label} läuft weiter`} />
                  ) : cell.kind === "closed" ? (
                    <div
                      className="h-full min-h-12 rounded-md border border-transparent opacity-70"
                      title={cell.label}
                      style={{
                        backgroundImage: "repeating-linear-gradient(135deg, rgba(239, 68, 68, 0.08) 0, rgba(239, 68, 68, 0.08) 6px, rgba(255, 255, 255, 0) 6px, rgba(255, 255, 255, 0) 12px)",
                      }}
                    />
                  ) : cell.kind === "open" ? (
                    <div className="h-full min-h-12 rounded-md border border-transparent bg-white" title="Arbeitszeit ohne Blocker" />
                  ) : (
                    <div className={`h-full min-h-12 rounded-md border px-2 py-1.5 text-xs leading-4 shadow-sm ${availabilitySummaryTone(cell.kind)}`}>
                      <div className="flex items-center justify-between gap-2">
                        <span className="font-semibold">{cell.label}</span>
                        <span className="text-[11px] opacity-75">{minutesToTime(hour)}</span>
                      </div>
                      {cell.detail && <div className="mt-0.5 line-clamp-2 opacity-80">{cell.detail}</div>}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}
