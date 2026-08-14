import type { ReactNode } from "react";
import { Menu } from "lucide-react";

type AppHeaderProps = {
  actions?: ReactNode;
  children?: ReactNode;
  compact?: boolean;
  description: string;
  eyebrow?: string;
  mobileNavOpen: boolean;
  notices?: ReactNode;
  onOpenMobileNav: () => void;
  title: string;
};

export function AppHeader({
  actions,
  children,
  compact = false,
  description,
  eyebrow,
  mobileNavOpen,
  notices,
  onOpenMobileNav,
  title,
}: AppHeaderProps) {
  return (
    <header className="relative z-20 border-b border-slate-200 bg-white/95 backdrop-blur min-[1200px]:sticky min-[1200px]:top-0">
      {notices}
      {compact ? (
        <div className="flex min-h-12 items-center justify-between gap-3 px-4 py-2 lg:px-6">
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-[0.12em] text-blue-700">Fokusmodus</div>
            <div className="truncate text-sm font-semibold text-slate-800">{title}</div>
          </div>
          {actions ? <div className="flex shrink-0 items-center gap-2">{actions}</div> : null}
        </div>
      ) : (
        <div className="flex flex-wrap items-start justify-between gap-3 px-4 py-3 sm:gap-4 sm:px-5 sm:py-5 lg:px-6 min-[1200px]:flex-nowrap min-[1200px]:items-center min-[1200px]:px-8">
          <div className="flex min-w-0 max-w-full items-start gap-3 min-[1200px]:flex-1">
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
              {eyebrow && <div className="text-xs font-medium text-slate-500">{eyebrow}</div>}
              <h1 className="truncate text-2xl font-semibold tracking-tight text-slate-950 sm:text-3xl">{title}</h1>
              <p className="mt-1.5 hidden max-w-2xl text-sm leading-6 text-slate-500 sm:block">{description}</p>
            </div>
          </div>
          {actions && (
            <div className="flex w-full min-w-0 flex-wrap items-center gap-2 sm:w-auto sm:justify-end min-[1200px]:ml-auto min-[1200px]:max-w-[52%]">
              {actions}
            </div>
          )}
        </div>
      )}
      {children}
    </header>
  );
}
