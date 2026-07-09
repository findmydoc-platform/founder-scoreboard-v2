import type { ReactNode } from "react";
import { Menu } from "lucide-react";

type AppHeaderProps = {
  actions?: ReactNode;
  children?: ReactNode;
  eyebrow?: string;
  mobileNavOpen: boolean;
  notices?: ReactNode;
  onOpenMobileNav: () => void;
  subtitle: string;
  title: string;
};

export function AppHeader({
  actions,
  children,
  eyebrow,
  mobileNavOpen,
  notices,
  onOpenMobileNav,
  subtitle,
  title,
}: AppHeaderProps) {
  return (
    <header className="sticky top-0 z-20 border-b border-slate-200 bg-white/95 backdrop-blur">
      {notices}
      <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-4 lg:items-center lg:px-6">
        <div className="flex min-w-0 max-w-full items-start gap-3">
          <button
            type="button"
            onClick={onOpenMobileNav}
            className="grid h-10 w-10 shrink-0 place-items-center rounded-md border border-slate-200 bg-white text-slate-600 hover:bg-slate-50 lg:hidden"
            aria-label="Navigation öffnen"
            aria-expanded={mobileNavOpen}
          >
            <Menu size={19} />
          </button>
          <div className="min-w-0">
            {eyebrow && <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">{eyebrow}</div>}
            <h1 className="truncate text-xl font-semibold text-slate-950">{title}</h1>
            <div className="mt-1 text-sm text-slate-500">{subtitle}</div>
          </div>
        </div>
        {actions && (
          <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto sm:justify-end">
            {actions}
          </div>
        )}
      </div>
      {children}
    </header>
  );
}
