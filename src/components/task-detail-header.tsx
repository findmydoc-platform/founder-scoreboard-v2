"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import { normalizeStatus, priorityTone, statusTone } from "@/lib/status";
import type { Task } from "@/lib/types";

type Props = {
  title: string;
  status: Task["status"];
  priority: Task["priority"];
  hours: Task["hours"];
};

export function TaskDetailHeader({ title, status, priority, hours }: Props) {
  const normalizedStatus = normalizeStatus(status);

  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-4 px-6 py-4">
        <div>
          <Link href="/" className="inline-flex items-center gap-2 text-sm font-semibold text-slate-600 hover:text-blue-700">
            <ArrowLeft size={16} />
            Zur Planung
          </Link>
          <div className="mt-3 text-xs font-semibold uppercase tracking-wide text-slate-500">Aufgabendetail</div>
          <h1 className="mt-1 max-w-4xl text-2xl font-semibold tracking-tight text-slate-950">{title}</h1>
        </div>
        <div className="flex flex-wrap gap-2">
          <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${statusTone(normalizedStatus)}`}>{normalizedStatus}</span>
          <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${priorityTone(priority)}`}>{priority}</span>
          <span className="rounded-full border border-slate-200 bg-white px-3 py-1 text-xs font-semibold text-slate-600">{hours}h</span>
        </div>
      </div>
    </header>
  );
}
