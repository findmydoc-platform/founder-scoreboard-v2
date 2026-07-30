"use client";

import { ChevronsLeft, ChevronsRight, X } from "lucide-react";
import Link from "next/link";
import { forwardRef, useEffect, useState } from "react";
import { appNavigationSections, appNavItems, appWorkspaceIds, hiddenWorkspaceIds, type AppWorkspace, type VisibleAppWorkspace } from "@/features/planning/model/workspace-routes";
import { AppBrand } from "@/shared/atoms/app-brand";

export { appNavItems, appWorkspaceIds, hiddenWorkspaceIds };
export type { AppWorkspace, VisibleAppWorkspace };

type AppSidebarProps = {
  activeWorkspace?: AppWorkspace;
  source?: "supabase";
  authAvailable?: boolean;
  authUserEmail?: string;
  currentPlatformRole?: string;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
  onMouseLeave?: () => void;
  onRequestNavigation?: (href: string) => void;
};

const DESKTOP_SIDEBAR_EXPANDED_STORAGE_KEY = "founderops.desktop-sidebar-expanded";

export const AppSidebar = forwardRef<HTMLElement, AppSidebarProps>(function AppSidebar({
  activeWorkspace = "planning",
  currentPlatformRole = "",
  mobileOpen = false,
  onMobileClose,
  onMouseLeave,
  onRequestNavigation,
}, ref) {
  const [desktopSidebarExpanded, setDesktopSidebarExpanded] = useState(true);

  useEffect(() => {
    try {
      const storedValue = window.localStorage.getItem(DESKTOP_SIDEBAR_EXPANDED_STORAGE_KEY);
      if (storedValue === "false") setDesktopSidebarExpanded(false);
    } catch {
      // The default expanded state remains usable when storage is unavailable.
    }
  }, []);

  useEffect(() => {
    if (!mobileOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onMobileClose?.();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [mobileOpen, onMobileClose]);

  const visibleNavItems = appNavItems.filter((item) => !item.ceoOnly || currentPlatformRole === "ceo");
  const visibleNavigationSections = appNavigationSections.map((section) => ({
    ...section,
    items: visibleNavItems.filter((item) => item.navigationSection === section.id),
  })).filter((section) => section.items.length > 0);

  const toggleDesktopSidebar = () => {
    setDesktopSidebarExpanded((expanded) => {
      const nextExpanded = !expanded;
      try {
        window.localStorage.setItem(DESKTOP_SIDEBAR_EXPANDED_STORAGE_KEY, String(nextExpanded));
      } catch {
        // The current session still reflects the requested sidebar state.
      }
      return nextExpanded;
    });
  };

  const renderNavItem = (item: (typeof appNavItems)[number], variant: "desktop" | "mobile") => {
    const Icon = item.icon;
    const active = activeWorkspace === item.id;
    const desktopClassName = `flex h-10 w-full items-center rounded-md text-left text-sm font-medium transition-colors ${
      desktopSidebarExpanded ? "gap-3 px-3" : "justify-center px-3"
    } ${
      active ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-50"
    }`;
    const mobileClassName = `flex h-11 w-full items-center gap-3 rounded-md px-3 text-left text-sm font-semibold transition-colors ${
      active ? "bg-blue-50 text-blue-700" : "text-slate-700 hover:bg-slate-50"
    }`;
    const className = variant === "desktop" ? desktopClassName : mobileClassName;
    const content = (
      <>
        <Icon size={18} className="shrink-0" />
        <span className={variant === "desktop" ? (desktopSidebarExpanded ? "truncate" : "sr-only") : "truncate"}>{item.label}</span>
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

  const renderNavigationSections = (variant: "desktop" | "mobile") => visibleNavigationSections.map((section, index) => (
    <div
      key={section.id}
      className={variant === "desktop" && !desktopSidebarExpanded
        ? (index === 0 ? "" : "mt-3 border-t border-slate-100 pt-3")
        : (index === 0 ? "" : "mt-5")}
    >
      <div className={variant === "desktop" && !desktopSidebarExpanded ? "sr-only" : "px-1 pb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500"}>
        {section.label}
      </div>
      <div className="space-y-1">{section.items.map((item) => renderNavItem(item, variant))}</div>
    </div>
  ));

  return (
    <>
      <aside
        ref={ref}
        onMouseLeave={onMouseLeave}
        data-sidebar-state={desktopSidebarExpanded ? "expanded" : "collapsed"}
        className={`app-sidebar-peer fixed inset-y-0 left-0 z-30 hidden flex-col overflow-hidden border-r border-slate-200 bg-white shadow-none transition-[width] duration-200 ease-out lg:flex ${
          desktopSidebarExpanded ? "w-64" : "w-16"
        }`}
      >
        <div className={`border-b border-slate-100 ${desktopSidebarExpanded ? "flex items-start justify-between gap-3 px-4 py-4" : "flex flex-col items-center gap-3 px-3 py-4"}`}>
          <AppBrand textClassName={desktopSidebarExpanded ? "" : "hidden"} />
          <button
            type="button"
            onClick={toggleDesktopSidebar}
            className="grid h-8 w-8 shrink-0 place-items-center rounded-md border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600"
            aria-label={desktopSidebarExpanded ? "Navigation einklappen" : "Navigation ausklappen"}
            aria-pressed={desktopSidebarExpanded}
            title={desktopSidebarExpanded ? "Navigation einklappen" : "Navigation ausklappen"}
          >
            {desktopSidebarExpanded ? <ChevronsLeft size={17} aria-hidden="true" /> : <ChevronsRight size={17} aria-hidden="true" />}
          </button>
        </div>
        <nav className={`flex-1 overflow-y-auto py-4 ${desktopSidebarExpanded ? "px-3" : "px-2"}`} aria-label="Hauptnavigation">
          {renderNavigationSections("desktop")}
        </nav>
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
            <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Mobile Hauptnavigation">
              {renderNavigationSections("mobile")}
            </nav>
          </aside>
        </div>
      )}
    </>
  );
});
