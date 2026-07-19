"use client";

import { ArrowLeft } from "lucide-react";
import Link from "next/link";
import type { ReactNode } from "react";
import { PlanningHeaderDataActions } from "@/features/planning/molecules/planning-header-data-actions";
import type { HeaderNotification, PlanningHeaderData } from "@/lib/types";

type Props = {
  title: string;
  headerData: PlanningHeaderData;
  actions?: ReactNode;
  notificationsOpen?: boolean;
  onToggleNotifications?: () => void;
  onOpenNotification?: (event: HeaderNotification) => void;
  onDismissNotification?: (eventId: number) => void;
  onBack?: () => void;
};

export function TaskDetailHeader({ headerData, actions, notificationsOpen, onToggleNotifications, onOpenNotification, onDismissNotification, onBack }: Props) {
  return (
    <header className="border-b border-slate-200 bg-white">
      <div className="mx-auto flex min-h-16 max-w-[1392px] flex-wrap items-center justify-between gap-4 px-6 py-3 sm:px-8">
        {onBack ? (
          <button type="button" onClick={onBack} className="inline-flex min-h-11 items-center gap-2 rounded-md px-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-400">
            <ArrowLeft size={16} aria-hidden="true" />Zur Planung
          </button>
        ) : (
          <Link href="/planning" className="inline-flex min-h-11 items-center gap-2 rounded-md px-2 text-sm font-semibold text-slate-600 hover:bg-slate-50 hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-400">
            <ArrowLeft size={16} aria-hidden="true" />Zur Planung
          </Link>
        )}
        <div className="flex flex-wrap items-center gap-2">
          <PlanningHeaderDataActions
            headerData={headerData}
            notificationsOpen={notificationsOpen}
            onToggleNotifications={onToggleNotifications}
            onOpenNotification={onOpenNotification}
            onDismissNotification={onDismissNotification}
          />
          {actions}
        </div>
      </div>
    </header>
  );
}
