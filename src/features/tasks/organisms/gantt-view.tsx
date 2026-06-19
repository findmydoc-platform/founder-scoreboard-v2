"use client";

import { ChevronRight } from "lucide-react";
import { taskRelationsFor } from "@/lib/platform";
import type { Package, Sprint, Task, TaskRelation } from "@/lib/types";
import { DataOverflow, DataSurface } from "@/shared/molecules/data-surface";

function parseIsoDate(value: string) {
  if (!value) return null;
  const date = new Date(`${value}T00:00:00`);
  return Number.isNaN(date.getTime()) ? null : date;
}

function packageById(packages: Package[], id: string) {
  return packages.find((item) => item.id === id);
}

export function GanttView({ tasks, packages, sprints, relations, onOpen }: { tasks: Task[]; packages: Package[]; sprints: Sprint[]; relations: TaskRelation[]; onOpen: (task: Task) => void }) {
  const firstTaskStart = tasks
    .map((task) => parseIsoDate(sprints.find((sprint) => sprint.id === task.sprintId)?.startDate || "") || parseIsoDate(task.startDate))
    .filter((date): date is Date => Boolean(date))
    .sort((a, b) => a.getTime() - b.getTime())[0];
  const start = firstTaskStart || parseIsoDate(sprints[0]?.startDate || "") || new Date("2026-05-25T00:00:00");
  const days = Array.from({ length: 42 }, (_, index) => {
    const date = new Date(start);
    date.setDate(start.getDate() + index);
    return date;
  });

  return (
    <DataSurface>
      <DataOverflow>
      <div className="grid min-w-[1180px] grid-cols-[360px_1fr]">
        <div className="border-r border-slate-200">
          <div className="sticky top-0 border-b border-slate-200 bg-slate-50 px-4 py-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Aufgabe</div>
          {tasks.map((task) => (
            <button key={task.id} type="button" onClick={() => onOpen(task)} className="flex h-12 w-full items-center gap-2 border-b border-slate-100 px-4 text-left text-sm hover:bg-slate-50">
              <ChevronRight size={14} className="text-slate-400" />
              <span className="min-w-0 truncate font-medium">{task.title}</span>
            </button>
          ))}
        </div>
        <div>
          <div className="grid border-b border-slate-200 bg-slate-50" style={{ gridTemplateColumns: `repeat(${days.length}, minmax(28px, 1fr))` }}>
            {days.map((day) => (
              <div key={day.toISOString()} className="border-r border-slate-100 py-3 text-center text-[10px] font-semibold text-slate-500">
                {day.getDate()}
              </div>
            ))}
          </div>
          {tasks.map((task) => {
            const sprint = sprints.find((item) => item.id === task.sprintId);
            const taskStart = parseIsoDate(sprint?.startDate || "") || parseIsoDate(task.startDate) || start;
            const taskEnd = parseIsoDate(sprint?.endDate || "") || parseIsoDate(task.endDate) || parseIsoDate(task.startDate) || taskStart;
            const left = Math.max(0, Math.floor((taskStart.getTime() - start.getTime()) / 86400000));
            const length = Math.max(1, Math.floor((taskEnd.getTime() - taskStart.getTime()) / 86400000) + 1);
            const pack = packageById(packages, task.packageId);
            return (
              <div key={task.id} className="relative h-12 border-b border-slate-100" style={{ backgroundImage: "linear-gradient(to right, transparent calc(100% - 1px), #eef2f7 1px)", backgroundSize: `${100 / days.length}% 100%` }}>
                <button
                  type="button"
                  onClick={() => onOpen(task)}
                  className="absolute top-3 h-6 rounded bg-blue-500 px-2 text-left text-[11px] font-semibold text-white shadow-sm"
                  style={{ left: `${(left / days.length) * 100}%`, width: `${Math.min(100 - (left / days.length) * 100, (length / days.length) * 100)}%` }}
                  title={`${task.title} · ${pack?.title || "ohne Initiative"}`}
                >
                  <span className="block truncate">{task.title}</span>
                </button>
                {taskRelationsFor(task.id, relations).waitsOn.length > 0 && <span className="absolute right-2 top-4 h-2 w-2 rounded-full bg-amber-400" title="Wartet auf andere Aufgabe" />}
                {taskRelationsFor(task.id, relations).blocks.length > 0 && <span className="absolute right-5 top-4 h-2 w-2 rounded-full bg-blue-400" title="Blockiert andere Aufgabe" />}
              </div>
            );
          })}
        </div>
      </div>
      </DataOverflow>
    </DataSurface>
  );
}
