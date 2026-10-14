"use client";

import type { ReactNode } from "react";
import { useRef } from "react";

export type AdministrationTab = "overview" | "people" | "integrations";

export const administrationTabs = [
  { id: "overview", label: "Übersicht" },
  { id: "people", label: "Personen & Zugänge" },
  { id: "integrations", label: "Integrationen & Zustellung" },
] as const;

export function AdministrationWorkspaceTemplate({
  activeTab,
  children,
  visibleTabs,
  onTabChange,
}: {
  activeTab: AdministrationTab;
  children: ReactNode;
  visibleTabs: readonly AdministrationTab[];
  onTabChange: (tab: AdministrationTab) => void;
}) {
  const buttonRefs = useRef<Array<HTMLButtonElement | null>>([]);
  const tabs = administrationTabs.filter((tab) => visibleTabs.includes(tab.id));
  const onKeyDown = (event: React.KeyboardEvent<HTMLButtonElement>, index: number) => {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    const nextIndex = event.key === "Home" ? 0
      : event.key === "End" ? tabs.length - 1
        : (index + (event.key === "ArrowRight" ? 1 : -1) + tabs.length) % tabs.length;
    const next = tabs[nextIndex];
    if (!next) return;
    onTabChange(next.id);
    buttonRefs.current[nextIndex]?.focus();
  };
  return (
    <div className="grid min-w-0" data-tour-id="administration-workspace">
      <div className="-mx-4 overflow-x-auto border-b border-slate-200 px-4 lg:-mx-6 lg:px-6" role="tablist" aria-label="Administrationsbereiche">
        <div className="flex min-w-max gap-8">
        {tabs.map((tab, index) => {
          const active = tab.id === activeTab;
          return (
            <button ref={(element) => { buttonRefs.current[index] = element; }} id={`administration-tab-${tab.id}`} key={tab.id} type="button" role="tab" aria-selected={active} aria-controls={`administration-panel-${tab.id}`} tabIndex={active ? 0 : -1} onKeyDown={(event) => onKeyDown(event, index)} onClick={() => onTabChange(tab.id)} className={`inline-flex min-h-12 shrink-0 items-center border-b-2 px-1 text-sm font-semibold transition ${active ? "border-blue-600 text-blue-700" : "border-transparent text-slate-600 hover:border-slate-300 hover:text-slate-900"}`}>
              {tab.label}
            </button>
          );
        })}
        </div>
      </div>
      <div id={`administration-panel-${activeTab}`} role="tabpanel" aria-labelledby={`administration-tab-${activeTab}`} className="pt-4" tabIndex={0}>{children}</div>
    </div>
  );
}
