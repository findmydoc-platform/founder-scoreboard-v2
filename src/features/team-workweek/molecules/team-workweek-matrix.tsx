"use client";

import { useId, useState, type KeyboardEvent } from "react";
import { currentTeamWorkweekDayKey, TEAM_WORKWEEK_DAYS, type TeamWorkweekDayKey } from "../model/team-workweek-draft";
import { projectActiveTeamWorkweekRows } from "../model/team-workweek-matrix";
import { formatDate } from "@/lib/display";
import type { PublishedTeamWorkweek } from "../model/published-team-workweek";
import type { Profile } from "@/lib/types";
import { classNames } from "@/shared/atoms/ui-primitives";
import {
  DataCell,
  DataHeaderCell,
  DataOverflow,
  DataTable,
  DataTableHead,
} from "@/shared/molecules/data-surface";

export function TeamWorkweekMatrix({
  compact = false,
  profiles,
  workweeks,
}: {
  compact?: boolean;
  profiles: Profile[];
  workweeks: PublishedTeamWorkweek[];
}) {
  const rows = projectActiveTeamWorkweekRows(profiles, workweeks);
  const [selectedDayKey, setSelectedDayKey] = useState<TeamWorkweekDayKey>(currentTeamWorkweekDayKey);
  const tabGroupId = useId();
  const tabPanelId = `${tabGroupId}-panel`;
  const selectedDay = TEAM_WORKWEEK_DAYS.find((day) => day.key === selectedDayKey) ?? TEAM_WORKWEEK_DAYS[0];
  const scheduledCount = rows.filter(({ workweek }) => Boolean(workweek?.windows[selectedDay.key]?.length)).length;
  const mobileClassName = compact ? "lg:hidden" : "xl:hidden";
  const desktopClassName = compact ? "hidden lg:block" : "hidden xl:block";

  function selectDayFromKeyboard(event: KeyboardEvent<HTMLButtonElement>, dayKey: TeamWorkweekDayKey) {
    const currentIndex = TEAM_WORKWEEK_DAYS.findIndex((day) => day.key === dayKey);
    const lastIndex = TEAM_WORKWEEK_DAYS.length - 1;
    const nextIndex = event.key === "ArrowRight"
      ? (currentIndex + 1) % TEAM_WORKWEEK_DAYS.length
      : event.key === "ArrowLeft"
        ? (currentIndex - 1 + TEAM_WORKWEEK_DAYS.length) % TEAM_WORKWEEK_DAYS.length
        : event.key === "Home"
          ? 0
          : event.key === "End"
            ? lastIndex
            : null;

    if (nextIndex === null) return;
    event.preventDefault();
    const nextDay = TEAM_WORKWEEK_DAYS[nextIndex];
    setSelectedDayKey(nextDay.key);
    document.getElementById(`${tabGroupId}-${nextDay.key}-tab`)?.focus();
  }

  return (
    <>
      <section
        className={classNames(
          "rounded-lg border border-slate-200 bg-white",
          compact ? "overflow-visible" : "overflow-hidden",
          mobileClassName,
        )}
        aria-label="Team-Arbeitswoche nach Wochentag"
      >
        <div
          className={classNames(
            "grid grid-cols-7 border-b border-slate-200 bg-slate-50",
            compact ? "sticky top-0 z-20 rounded-t-lg" : "",
          )}
          role="tablist"
          aria-label="Wochentag auswählen"
        >
          {TEAM_WORKWEEK_DAYS.map((day) => {
            const selected = day.key === selectedDay.key;
            return (
              <button
                key={day.key}
                id={`${tabGroupId}-${day.key}-tab`}
                type="button"
                role="tab"
                aria-controls={tabPanelId}
                aria-label={day.label}
                aria-selected={selected}
                tabIndex={selected ? 0 : -1}
                title={day.label}
                className={classNames(
                  "min-h-11 border-r border-slate-200 px-1 text-xs font-semibold outline-none last:border-r-0 focus-visible:relative focus-visible:z-10 focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600",
                  selected ? "bg-white text-blue-700 shadow-[inset_0_-2px_0_0_rgb(37_99_235)]" : "text-slate-500 hover:bg-white hover:text-slate-900",
                )}
                onClick={() => setSelectedDayKey(day.key)}
                onKeyDown={(event) => selectDayFromKeyboard(event, day.key)}
              >
                {day.shortLabel}
              </button>
            );
          })}
        </div>

        <div
          id={tabPanelId}
          role="tabpanel"
          aria-labelledby={`${tabGroupId}-${selectedDay.key}-tab`}
          tabIndex={0}
          className="outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-blue-600"
        >
          <div
            className={classNames(
              "flex min-h-11 items-center justify-between gap-3 border-b border-slate-100 bg-white px-3 py-2",
              compact ? "sticky top-11 z-10" : "",
            )}
          >
            <h3 className="text-sm font-semibold text-slate-950">{selectedDay.label}</h3>
            <span className="text-xs font-medium text-slate-500">{scheduledCount} eingeplant</span>
          </div>
          <ul className="divide-y divide-slate-100">
            {rows.map(({ profile, workweek }) => {
              const windows = workweek?.windows[selectedDay.key] || [];
              const profileColor = profile.color || "#64748b";
              return (
                <li key={profile.id} className="grid min-h-14 grid-cols-[minmax(0,1fr)_auto] items-start gap-3 px-3 py-2">
                  <div className="flex min-w-0 items-start gap-2">
                    <span className="mt-1 h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: profileColor }} aria-hidden="true" />
                    <div className="min-w-0">
                      <p className="truncate text-sm font-semibold text-slate-950">{profile.name}</p>
                      {workweek ? (
                        <p className="mt-0.5 text-xs font-medium leading-4 text-slate-500">
                          Bestätigt {formatDate(workweek.lastSyncAt.slice(0, 10))}
                        </p>
                      ) : (
                        <p className="mt-0.5 whitespace-nowrap text-xs font-medium leading-4 text-slate-500">Nicht veröffentlicht</p>
                      )}
                    </div>
                  </div>
                  <div className="flex max-w-[10rem] flex-wrap justify-end gap-1 pt-0.5 text-right">
                    {!workweek ? (
                      <span className="text-sm text-slate-300" aria-label={`${profile.name}, ${selectedDay.label}: keine veröffentlichte Arbeitswoche`}>—</span>
                    ) : windows.length ? (
                      windows.map((window, index) => (
                        <span
                          key={`${window.start}-${window.end}-${index}`}
                          className="inline-flex whitespace-nowrap rounded border px-1.5 py-0.5 text-xs font-semibold text-slate-900"
                          style={{
                            backgroundColor: `color-mix(in srgb, ${profileColor} 12%, white)`,
                            borderColor: `color-mix(in srgb, ${profileColor} 22%, white)`,
                          }}
                        >
                          {window.start}–{window.end}
                        </span>
                      ))
                    ) : (
                      <span className="text-sm font-medium text-slate-400">Frei</span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      </section>

      <DataOverflow
        className={classNames("rounded-lg border border-slate-200 bg-white", desktopClassName)}
        aria-label="Team-Arbeitswoche mit sieben Wochentagen"
      >
        <DataTable minWidth={compact ? 840 : 1040} className="table-fixed">
          <DataTableHead>
            <tr className="border-b border-slate-200 bg-slate-50">
              <DataHeaderCell sticky className="w-40 border-r text-xs tracking-wide">
                Team
              </DataHeaderCell>
              {TEAM_WORKWEEK_DAYS.map((day) => (
                <DataHeaderCell key={day.key} title={day.label} className={classNames("text-xs tracking-wide", compact ? "w-24" : "w-28")}>
                  {day.shortLabel}
                </DataHeaderCell>
              ))}
            </tr>
          </DataTableHead>
          <tbody>
            {rows.map(({ profile, workweek }) => (
              <tr key={profile.id} className="border-b border-slate-100 last:border-b-0">
                <th scope="row" className={classNames("sticky left-0 z-10 border-b border-r border-slate-200 bg-white text-left align-top shadow-[2px_0_0_0_rgb(241_245_249)]", compact ? "px-2.5 py-2" : "px-4 py-3")}>
                  <div className="flex items-start gap-2">
                    <span className="mt-0.5 h-3 w-3 shrink-0 rounded-full" style={{ backgroundColor: profile.color || "#64748b" }} aria-hidden="true" />
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-semibold text-slate-950">{profile.name}</span>
                      {workweek ? (
                        <span className="mt-1 block text-xs font-medium leading-4 text-slate-500">
                          Bestätigt {formatDate(workweek.lastSyncAt.slice(0, 10))}
                        </span>
                      ) : (
                        <span className="mt-0.5 block whitespace-nowrap text-xs font-medium leading-4 text-slate-500">Nicht veröffentlicht</span>
                      )}
                    </span>
                  </div>
                </th>
                {TEAM_WORKWEEK_DAYS.map((day) => {
                  const windows = workweek?.windows[day.key] || [];
                  return (
                    <DataCell key={day.key} className={classNames("align-top text-slate-700", compact ? "px-1.5 py-2 text-xs" : "text-sm")}>
                      {!workweek ? (
                        <span className="text-slate-300" aria-label={`${profile.name}, ${day.label}: keine veröffentlichte Arbeitswoche`}>—</span>
                      ) : windows.length ? (
                        <span className="grid gap-1">
                          {windows.map((window, index) => (
                            <span
                              key={`${window.start}-${window.end}-${index}`}
                              className={classNames("inline-flex w-fit whitespace-nowrap rounded border py-0.5 font-semibold text-slate-900", compact ? "px-1.5 text-xs" : "px-1.5 text-[11px]")}
                              style={{
                                backgroundColor: `color-mix(in srgb, ${profile.color || "#2563eb"} 12%, white)`,
                                borderColor: `color-mix(in srgb, ${profile.color || "#2563eb"} 22%, white)`,
                              }}
                            >
                              {window.start}–{window.end}
                            </span>
                          ))}
                        </span>
                      ) : (
                        <span className="font-medium text-slate-400">Frei</span>
                      )}
                    </DataCell>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </DataTable>
      </DataOverflow>
    </>
  );
}
