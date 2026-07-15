"use client";

import { X } from "lucide-react";
import Link from "next/link";
import { forwardRef, useEffect } from "react";
import { appNavItems, appWorkspaceIds, hiddenWorkspaceIds, type AppWorkspace, type VisibleAppWorkspace } from "@/features/planning/model/workspace-routes";
import { AppBrand } from "@/shared/atoms/app-brand";

export { appNavItems, appWorkspaceIds, hiddenWorkspaceIds };
export type { AppWorkspace, VisibleAppWorkspace };

type AppSidebarProps = {
  activeWorkspace?: AppWorkspace;
  source?: "seed" | "supabase";
  localStateLoaded?: boolean;
  authAvailable?: boolean;
  authUserEmail?: string;
  currentPlatformRole?: string;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
  onMouseLeave?: () => void;
  onRequestNavigation?: (href: string) => void;
};

function AccessCard({
  authAvailable,
  authUserEmail,
  className = "",
}: {
  authAvailable: boolean;
  authUserEmail: string;
  className?: string;
}) {
  if (!authAvailable) return null;

  return (
    <div className={className}>
      <div className="rounded-lg border border-slate-200 bg-white p-3 text-xs leading-5 text-slate-600">
        <div className="font-semibold text-slate-800">Teamzugriff</div>
        <div className="mt-1 truncate">{authUserEmail || "Nicht angemeldet"}</div>
      </div>
    </div>
  );
}

export const AppSidebar = forwardRef<HTMLElement, AppSidebarProps>(function AppSidebar({
  activeWorkspace = "planning",
  authAvailable = false,
  authUserEmail = "",
  currentPlatformRole = "",
  mobileOpen = false,
  onMobileClose,
  onMouseLeave,
  onRequestNavigation,
}, ref) {
  useEffect(() => {
    if (!mobileOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onMobileClose?.();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mobileOpen, onMobileClose]);

  const renderNavItem = (item: (typeof appNavItems)[number], variant: "desktop" | "mobile") => {
    const Icon = item.icon;
    const active = activeWorkspace === item.id;
    const desktopClassName = `flex h-10 w-full items-center justify-center gap-0 rounded-md px-3 text-left text-sm font-medium transition-colors group-hover:justify-start group-hover:gap-3 group-focus-within:justify-start group-focus-within:gap-3 ${
      active ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-50"
    }`;
    const mobileClassName = `flex h-11 w-full items-center gap-3 rounded-md px-3 text-left text-sm font-semibold transition-colors ${
      active ? "bg-blue-50 text-blue-700" : "text-slate-700 hover:bg-slate-50"
    }`;
    const className = variant === "desktop" ? desktopClassName : mobileClassName;
    const content = (
      <>
        <Icon size={18} className="shrink-0" />
        <span className={variant === "desktop" ? "w-0 overflow-hidden whitespace-nowrap opacity-0 transition-opacity duration-150 group-hover:w-auto group-hover:opacity-100 group-focus-within:w-auto group-focus-within:opacity-100" : "truncate"}>{item.label}</span>
      </>
    );
    return (
      <Link
        key={item.id}
        href={item.href}
        title={item.label}
        className={className}
        data-tour-id={`workspace-nav-${item.id}`}
        onNavigate={onRequestNavigation ? (event) => {
          event.preventDefault();
          onRequestNavigation(item.href);
        } : undefined}
        onClick={variant === "mobile" && !onRequestNavigation ? onMobileClose : undefined}
      >
        {content}
      </Link>
    );
  };
  const visibleNavItems = appNavItems.filter((item) => !item.ceoOnly || currentPlatformRole === "ceo");

  return (
    <>
      <aside
        ref={ref}
        onMouseLeave={onMouseLeave}
        className="group fixed inset-y-0 left-0 z-30 hidden w-16 overflow-hidden border-r border-slate-200 bg-white shadow-none transition-[width,box-shadow] duration-200 ease-out hover:w-64 hover:shadow-xl focus-within:w-64 focus-within:shadow-xl lg:block"
      >
        <div className="border-b border-slate-100 px-3 py-5">
          <AppBrand textClassName="opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100" />
        </div>
        <nav className="space-y-1 px-3 py-4" aria-label="Hauptnavigation">
          {visibleNavItems.map((item) => renderNavItem(item, "desktop"))}
        </nav>
        <AccessCard
          authAvailable={authAvailable}
          authUserEmail={authUserEmail}
          className="absolute bottom-0 left-0 right-0 border-t border-slate-100 p-4 opacity-0 transition-opacity duration-150 group-hover:opacity-100 group-focus-within:opacity-100"
        />
      </aside>

      {mobileOpen && (
        <div className="fixed inset-0 z-40 lg:hidden" role="dialog" aria-modal="true" aria-label="Mobile Navigation">
          <button type="button" className="absolute inset-0 bg-slate-950/35" onClick={onMobileClose} aria-label="Navigation schließen" />
          <aside className="relative flex h-full w-[min(88vw,340px)] flex-col overflow-hidden border-r border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-4">
              <AppBrand />
              <button type="button" onClick={onMobileClose} className="grid h-10 w-10 place-items-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50" aria-label="Navigation schließen">
                <X size={18} />
              </button>
            </div>
            <nav className="flex-1 space-y-1 overflow-y-auto px-3 py-4" aria-label="Mobile Hauptnavigation">
              {visibleNavItems.map((item) => renderNavItem(item, "mobile"))}
            </nav>
            <AccessCard
              authAvailable={authAvailable}
              authUserEmail={authUserEmail}
              className="border-t border-slate-100 p-4"
            />
          </aside>
        </div>
      )}
    </>
  );
});
