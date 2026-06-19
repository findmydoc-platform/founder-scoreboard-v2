"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { normalizeStatus, priorityBadgeTone, statusBadgeTone } from "@/lib/status";
import type { Task } from "@/lib/types";
import { UiBadge } from "@/shared/atoms/ui-primitives";

type Props = {
  title: string;
  status: Task["status"];
  priority: Task["priority"];
  hours: Task["hours"];
  actions?: ReactNode;
};

export function TaskDetailHeader({ title, status, priority, hours, actions }: Props) {
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
        <div className="flex flex-wrap items-center gap-2">
          {actions}
          <UiBadge tone={statusBadgeTone(normalizedStatus)} size="md">{normalizedStatus}</UiBadge>
          <UiBadge tone={priorityBadgeTone(priority)} size="md">{priority}</UiBadge>
          <UiBadge tone="white" size="md">{hours}h</UiBadge>
        </div>
      </div>
    </header>
  );
}
