import { Bell, KeyRound, LayoutDashboard, SlidersHorizontal, UserRound } from "lucide-react";
import type { ReactNode } from "react";
import type { ProfileSettingsSectionId } from "@/features/profile/model/profile-settings-view-model";
import { classNames } from "@/shared/atoms/ui-primitives";

export const profileSettingsSections: Array<{ id: ProfileSettingsSectionId; label: string; description: string; icon: ReactNode }> = [
  { id: "profile", label: "Profil", description: "Identität, Fokus und Farbe", icon: <UserRound size={16} /> },
  { id: "notifications", label: "Benachrichtigungen", description: "Google-Chat-Hinweise", icon: <Bell size={16} /> },
  { id: "board", label: "Planung", description: "Start und Standardansicht", icon: <LayoutDashboard size={16} /> },
  { id: "process", label: "FounderOps-Prozess", description: "Globale Fristen & GitHub", icon: <SlidersHorizontal size={16} /> },
  { id: "api", label: "API-Zugänge", description: "Persönliche Planungs-API-Tokens", icon: <KeyRound size={16} /> },
];

export function ProfileSettingsNavButton({
  active,
  compact = false,
  section,
  onClick,
}: {
  active: boolean;
  compact?: boolean;
  section: (typeof profileSettingsSections)[number];
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      data-tour-id={`profile-settings-${section.id}`}
      onClick={onClick}
      className={classNames(
        "flex min-w-0 items-center gap-3 rounded-md border text-left transition",
        compact ? "h-10 shrink-0 px-3 text-sm" : "mb-1 w-full px-3 py-2",
        active ? "border-blue-200 bg-blue-50 text-blue-800" : "border-transparent text-slate-600 hover:bg-slate-50 hover:text-slate-900",
      )}
      aria-current={active ? "page" : undefined}
    >
      <span className={classNames("grid h-7 w-7 shrink-0 place-items-center rounded-md", active ? "bg-white text-blue-700" : "bg-slate-100 text-slate-500")}>
        {section.icon}
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm font-semibold">{section.label}</span>
        {!compact && <span className="mt-0.5 block truncate text-xs text-slate-500">{section.description}</span>}
      </span>
    </button>
  );
}

export function SettingsPane({ eyebrow, title, description, children }: { eyebrow: string; title: string; description: string; children: ReactNode }) {
  return (
    <section className="min-w-0">
      <header className="border-b border-slate-100 px-5 py-5">
        <div className="text-[11px] font-bold uppercase tracking-[0.18em] text-slate-500">{eyebrow}</div>
        <h2 className="mt-1 text-xl font-semibold text-slate-950">{title}</h2>
        <p className="mt-1 max-w-2xl text-sm leading-6 text-slate-500">{description}</p>
      </header>
      <div className="divide-y divide-slate-100">{children}</div>
    </section>
  );
}

export function SettingsRow({
  label,
  description,
  children,
  align = "center",
}: {
  label: string;
  description?: string;
  children: ReactNode;
  align?: "center" | "start";
}) {
  return (
    <div className={classNames("grid gap-3 px-5 py-4 md:grid-cols-[minmax(0,260px)_minmax(280px,1fr)]", align === "center" ? "md:items-center" : "md:items-start")}>
      <div className="min-w-0">
        <div className="text-sm font-semibold text-slate-950">{label}</div>
        {description && <p className="mt-1 text-sm leading-6 text-slate-500">{description}</p>}
      </div>
      <div className="min-w-0 md:justify-self-end md:text-right">{children}</div>
    </div>
  );
}

export function ToggleSwitch({ checked, disabled, label, onChange }: { checked: boolean; disabled?: boolean; label: string; onChange: (checked: boolean) => void }) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      aria-label={label}
      disabled={disabled}
      onClick={() => onChange(!checked)}
      className={classNames(
        "inline-flex h-6 w-11 items-center rounded-full p-0.5 transition focus:outline-none focus:ring-2 focus:ring-blue-100 disabled:cursor-not-allowed disabled:opacity-50",
        checked ? "bg-blue-600" : "bg-slate-300",
      )}
    >
      <span className={classNames("h-5 w-5 rounded-full bg-white shadow transition", checked ? "translate-x-5" : "translate-x-0")} />
    </button>
  );
}
