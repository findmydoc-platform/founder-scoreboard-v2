"use client";

import {
  Archive,
  CalendarDays,
  CheckCircle2,
  FileText,
  GanttChart,
  LayoutDashboard,
  Settings,
  Target,
  Users,
  Wrench,
} from "lucide-react";
import Link from "next/link";
import { forwardRef } from "react";
import { AppBrand } from "@/components/app-brand";

export type AppWorkspace = "planning" | "execution" | "mine" | "sprint" | "decisions" | "meetings" | "projects" | "tools" | "team" | "settings";

export const appNavItems = [
  { id: "planning", label: "Planung", icon: LayoutDashboard, href: "/" },
  { id: "execution", label: "Execution", icon: Target, href: "/?workspace=execution" },
  { id: "mine", label: "Meine Aufgaben", icon: CheckCircle2, href: "/?workspace=mine" },
  { id: "sprint", label: "Sprint & Score", icon: GanttChart, href: "/?workspace=sprint" },
  { id: "decisions", label: "Decision Log", icon: FileText, href: "/?workspace=decisions" },
  { id: "meetings", label: "Meeting Finder", icon: CalendarDays, href: "/?workspace=meetings" },
  { id: "projects", label: "Projekte", icon: Archive, href: "/?workspace=projects" },
  { id: "tools", label: "FMD-Tools", icon: Wrench, href: "/?workspace=tools" },
  { id: "team", label: "Team", icon: Users, href: "/?workspace=team" },
  { id: "settings", label: "Einstellungen", icon: Settings, href: "/?workspace=settings" },
] satisfies Array<{ id: AppWorkspace; label: string; icon: typeof LayoutDashboard; href: string }>;

type AppSidebarProps = {
  activeWorkspace?: AppWorkspace;
  onSelect?: (workspace: AppWorkspace) => void;
  source?: "seed" | "supabase";
  localStateLoaded?: boolean;
  authAvailable?: boolean;
  authUserEmail?: string;
  onMouseLeave?: () => void;
};

export const AppSidebar = forwardRef<HTMLElement, AppSidebarProps>(function AppSidebar({
  activeWorkspace = "planning",
  onSelect,
  source,
  localStateLoaded = true,
  authAvailable = false,
  authUserEmail = "",
  onMouseLeave,
}, ref) {
  return (
    <aside
      ref={ref}
      onMouseLeave={onMouseLeave}
      className="group fixed inset-y-0 left-0 z-30 hidden w-16 overflow-hidden border-r border-slate-200 bg-white shadow-none transition-[width,box-shadow] duration-200 ease-out hover:w-64 hover:shadow-xl focus-within:w-64 focus-within:shadow-xl lg:block"
    >
      <div className="border-b border-slate-100 px-3 py-5">
        <AppBrand textClassName="opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100" />
      </div>
      <nav className="space-y-1 px-3 py-4" aria-label="Hauptnavigation">
        {appNavItems.map((item) => {
          const Icon = item.icon;
          const active = activeWorkspace === item.id;
          const className = `flex h-10 w-full items-center justify-center gap-0 rounded-md px-3 text-left text-sm font-medium transition-colors group-hover:justify-start group-hover:gap-3 group-focus-within:justify-start group-focus-within:gap-3 ${
            active ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-50"
          }`;
          const content = (
            <>
              <Icon size={18} className="shrink-0" />
              <span className="w-0 overflow-hidden whitespace-nowrap opacity-0 transition-opacity duration-150 group-hover:w-auto group-hover:opacity-100 group-focus-within:w-auto group-focus-within:opacity-100">{item.label}</span>
            </>
          );

          if (onSelect) {
            return (
              <button key={item.id} type="button" onClick={() => onSelect(item.id)} title={item.label} className={className}>
                {content}
              </button>
            );
          }

          return (
            <Link key={item.id} href={item.href} title={item.label} className={className}>
              {content}
            </Link>
          );
        })}
      </nav>
      {source && (
        <div className="absolute bottom-0 left-0 right-0 border-t border-slate-100 p-4 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100">
          <div className="rounded-lg bg-slate-50 p-3 text-xs leading-5 text-slate-600">
            Datenquelle: <span className="font-semibold">{source === "supabase" ? "Supabase" : "Seed-Fallback"}</span>
            <br />
            {source === "supabase" ? "Änderungen werden in Postgres gespeichert." : localStateLoaded ? "Änderungen werden lokal im Browser gespeichert." : "Lokaler Status wird geladen."}
          </div>
          {authAvailable && (
            <div className="mt-3 rounded-lg border border-slate-200 bg-white p-3 text-xs leading-5 text-slate-600">
              <div className="font-semibold text-slate-800">Teamzugriff</div>
              <div className="mt-1 truncate">{authUserEmail || "Nicht angemeldet"}</div>
            </div>
          )}
        </div>
      )}
    </aside>
  );
});
