"use client";

import { ChevronsLeft, ChevronsRight, Sparkles, X } from "lucide-react";
import Link from "next/link";
import { forwardRef, useEffect, useRef, useSyncExternalStore, type MouseEvent } from "react";
import { appNavigationSections, appNavItems, appWorkspaceIds, hiddenWorkspaceIds, type AppWorkspace, type VisibleAppWorkspace } from "@/features/planning/model/workspace-routes";
import { PlatformReleaseSidebarCard } from "@/features/platform-releases/organisms/platform-release-sidebar-card";
import { AppBrand } from "@/shared/atoms/app-brand";
import { useModalDialog } from "@/shared/hooks/use-modal-dialog";
import { desktopSidebarExpandedSnapshot, subscribeToDesktopSidebar, toggleDesktopSidebarPreference } from "@/features/planning/model/desktop-sidebar-preference";

export { appNavItems, appWorkspaceIds, hiddenWorkspaceIds };
export type { AppWorkspace, VisibleAppWorkspace };

type AppSidebarProps = {
  activeWorkspace?: AppWorkspace | "platform-releases";
  source?: "supabase";
  authAvailable?: boolean;
  authUserEmail?: string;
  currentPlatformRole?: string;
  canAccessAdministration?: boolean;
  mobileOpen?: boolean;
  onMobileClose?: () => void;
  onMouseLeave?: () => void;
  onRequestNavigation?: (href: string) => void;
};

const expandedServerSnapshot = () => true;

export const AppSidebar = forwardRef<HTMLElement, AppSidebarProps>(function AppSidebar({
  activeWorkspace = "planning",
  canAccessAdministration = false,
  currentPlatformRole = "",
  mobileOpen = false,
  onMobileClose,
  onMouseLeave,
  onRequestNavigation,
}, ref) {
  const desktopSidebarExpanded = useSyncExternalStore(subscribeToDesktopSidebar, desktopSidebarExpandedSnapshot, expandedServerSnapshot);
  const animationTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const mobileDialogRef = useModalDialog<HTMLDivElement>({
    open: mobileOpen,
    onClose: () => onMobileClose?.(),
  });

  useEffect(() => () => {
    if (animationTimer.current !== null) clearTimeout(animationTimer.current);
  }, []);

  const visibleNavItems = appNavItems.filter((item) => (
    (!item.ceoOnly || currentPlatformRole === "ceo")
    && (item.id !== "administration" || canAccessAdministration)
  ));
  const platformReleasesNavItem = { id: "platform-releases" as const, label: "Releases", icon: Sparkles, href: "/team/platform-releases", navigationSection: "steering" as const };
  const visibleNavigationSections = appNavigationSections.map((section) => ({
    ...section,
    items: [
      ...visibleNavItems.filter((item) => item.navigationSection === section.id),
      ...(section.id === "steering" ? [platformReleasesNavItem] : []),
    ],
  })).filter((section) => section.items.length > 0);

  const toggleDesktopSidebar = (event: MouseEvent<HTMLButtonElement>) => {
    const sidebar = event.currentTarget.closest("aside")!;
    sidebar.dataset.sidebarAnimate = "true";
    // Commit transition styles before changing the shared width.
    sidebar.getBoundingClientRect();
    if (animationTimer.current !== null) clearTimeout(animationTimer.current);
    animationTimer.current = setTimeout(() => { delete sidebar.dataset.sidebarAnimate; }, 250);
    toggleDesktopSidebarPreference();
  };

  const renderNavItem = (item: (typeof appNavItems)[number] | typeof platformReleasesNavItem, variant: "desktop" | "mobile") => {
    const Icon = item.icon;
    const active = activeWorkspace === item.id;
    const desktopClassName = `app-sidebar-link flex h-11 w-full items-center justify-center rounded-md px-3 text-left text-sm font-medium transition-colors min-[1200px]:h-10 ${
      active ? "bg-blue-50 text-blue-700" : "text-slate-600 hover:bg-slate-50"
    }`;
    const mobileClassName = `flex h-11 w-full items-center gap-3 rounded-md px-3 text-left text-sm font-semibold transition-colors ${
      active ? "bg-blue-50 text-blue-700" : "text-slate-700 hover:bg-slate-50"
    }`;
    const className = variant === "desktop" ? desktopClassName : mobileClassName;
    const content = (
      <>
        <Icon size={18} className="shrink-0" />
        <span className={variant === "desktop" ? "app-sidebar-label sr-only" : "truncate"}>{item.label}</span>
      </>
    );
    return (
      <Link
        key={item.id}
        href={item.href}
        title={item.label}
        className={className}
        data-tour-id={`workspace-nav-${item.id}`}
        onClick={(event) => {
          if (event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
          if (!onRequestNavigation) {
            if (variant === "mobile") onMobileClose?.();
            return;
          }
          event.preventDefault();
          onRequestNavigation(item.href);
        }}
      >
        {content}
      </Link>
    );
  };

  const renderNavigationSections = (variant: "desktop" | "mobile") => visibleNavigationSections.map((section, index) => (
    <div
      key={section.id}
      className={variant === "desktop"
        ? (index === 0 ? "" : "app-sidebar-section mt-3 border-t border-slate-100 pt-3")
        : (index === 0 ? "" : "mt-5")}
    >
      <div className={variant === "desktop"
        ? "app-sidebar-label app-sidebar-section-label sr-only"
        : "px-1 pb-2 text-[11px] font-semibold uppercase tracking-[0.12em] text-slate-500"}>
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
        className="app-sidebar-peer fixed inset-y-0 left-0 z-30 hidden w-16 flex-col overflow-hidden border-r border-slate-200 bg-white shadow-none lg:flex"
      >
        <div className="app-sidebar-header flex flex-col items-center gap-3 border-b border-slate-100 px-3 py-4">
          <AppBrand textClassName="app-sidebar-brand-text hidden" />
          <button
            type="button"
            onClick={toggleDesktopSidebar}
            className="hidden h-8 w-8 shrink-0 place-items-center rounded-md border border-slate-200 bg-white text-slate-500 transition-colors hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 min-[1200px]:grid"
            aria-label={desktopSidebarExpanded ? "Navigation einklappen" : "Navigation ausklappen"}
            aria-pressed={desktopSidebarExpanded}
            title={desktopSidebarExpanded ? "Navigation einklappen" : "Navigation ausklappen"}
          >
            {desktopSidebarExpanded ? <ChevronsLeft size={17} aria-hidden="true" /> : <ChevronsRight size={17} aria-hidden="true" />}
          </button>
        </div>
        <nav className="app-sidebar-nav flex-1 overflow-y-auto px-2 py-4" aria-label="Hauptnavigation">
          {renderNavigationSections("desktop")}
        </nav>
        <div className="app-sidebar-footer border-t border-slate-100 px-2 py-3">
          <PlatformReleaseSidebarCard compact={!desktopSidebarExpanded} onRequestNavigation={onRequestNavigation} />
        </div>
      </aside>

      {mobileOpen && (
        <div ref={mobileDialogRef} tabIndex={-1} className="fixed inset-0 z-40 outline-none lg:hidden" role="dialog" aria-modal="true" aria-label="Mobile Navigation">
          <button type="button" tabIndex={-1} className="absolute inset-0 bg-slate-950/35" onClick={onMobileClose} aria-label="Navigation schließen" />
          <aside className="relative flex h-full w-[min(90vw,360px)] flex-col overflow-hidden border-r border-slate-200 bg-white shadow-2xl">
            <div className="flex items-center justify-between border-b border-slate-100 px-4 py-4">
              <AppBrand />
              <button type="button" data-autofocus onClick={onMobileClose} className="grid h-11 w-11 place-items-center rounded-md border border-slate-200 text-slate-500 hover:bg-slate-50" aria-label="Navigation schließen">
                <X size={18} />
              </button>
            </div>
            <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Mobile Hauptnavigation">
              {renderNavigationSections("mobile")}
            </nav>
            <div className="border-t border-slate-100 p-3">
              <PlatformReleaseSidebarCard mobile onNavigate={onMobileClose} onRequestNavigation={onRequestNavigation} />
            </div>
          </aside>
        </div>
      )}
    </>
  );
});
