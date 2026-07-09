"use client";

import { Plus, Search } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import type { FmdTool, Profile } from "@/lib/types";
import {
  defaultFmdToolDraft,
  draftFromFmdTool,
  hasFmdToolLink,
  maxCuratedFmdToolLinks,
  sortFmdTools,
  type FmdToolDraft,
} from "@/features/tools/model/fmd-tools";
import { FmdQuickLinkCard } from "@/features/tools/molecules/fmd-quick-link-card";
import { FmdQuickLinkDialog } from "@/features/tools/molecules/fmd-quick-link-dialog";
import {
  canEditFmdQuickLinks,
  categoryCountsForLinks,
  categoryTabs,
  filterFmdQuickLinks,
  type FmdQuickLinkCategoryFilter,
  type FmdQuickLinkDialogMode,
} from "@/features/tools/model/fmd-quick-links-view";
import {
  classNames,
  UiButton,
  UiEmptyState,
  UiNotice,
  UiPanel,
  UiTextInput,
} from "@/shared/atoms/ui-primitives";

type FmdQuickLinksOverviewProps = {
  tools?: FmdTool[];
  source: "seed" | "supabase";
  currentProfile: Profile | null;
  pending?: boolean;
  message?: string;
  onCreateTool: (draft: FmdToolDraft) => boolean | Promise<boolean>;
  onUpdateTool: (tool: FmdTool, draft: FmdToolDraft) => boolean | Promise<boolean>;
};

export function FmdQuickLinksOverview({
  tools = [],
  source,
  currentProfile,
  pending = false,
  message = "",
  onCreateTool,
  onUpdateTool,
}: FmdQuickLinksOverviewProps) {
  const [dialogMode, setDialogMode] = useState<FmdQuickLinkDialogMode | null>(null);
  const [editingToolId, setEditingToolId] = useState<string | null>(null);
  const [draft, setDraft] = useState<FmdToolDraft>(() => defaultFmdToolDraft(currentProfile?.name || ""));
  const [categoryFilter, setCategoryFilter] = useState<FmdQuickLinkCategoryFilter>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [showMissingLinks, setShowMissingLinks] = useState(false);

  const sortedTools = useMemo(() => sortFmdTools(tools), [tools]);
  const visibleByLinkTools = useMemo(
    () => (showMissingLinks ? sortedTools : sortedTools.filter(hasFmdToolLink)),
    [showMissingLinks, sortedTools],
  );
  const createAllowed = source === "seed" || Boolean(currentProfile);
  const canEditLinks = canEditFmdQuickLinks(source, currentProfile);
  const editingTool = editingToolId ? sortedTools.find((tool) => tool.id === editingToolId) || null : null;
  const normalizedSearch = searchTerm.trim().toLocaleLowerCase("de");
  const curatedLinkCount = sortedTools.filter((tool) => tool.isCurated && tool.url).length;
  const missingLinkCount = sortedTools.filter((tool) => !hasFmdToolLink(tool)).length;
  const editedToolCountsAgainstLimit = Boolean(editingTool?.isCurated && editingTool.url);
  const curatedLimitReached = curatedLinkCount >= maxCuratedFmdToolLinks && !editedToolCountsAgainstLimit;

  const categoryCounts = useMemo(() => categoryCountsForLinks(visibleByLinkTools), [visibleByLinkTools]);
  const filteredTools = useMemo(
    () => filterFmdQuickLinks(visibleByLinkTools, categoryFilter, normalizedSearch),
    [categoryFilter, normalizedSearch, visibleByLinkTools],
  );
  const emptyStateLabel = emptyQuickLinksLabel(sortedTools.length, showMissingLinks);

  const filtersActive = categoryFilter !== "all" || Boolean(normalizedSearch) || showMissingLinks;

  const openCreateDialog = () => {
    setEditingToolId(null);
    setDraft(defaultFmdToolDraft(currentProfile?.name || ""));
    setDialogMode("create");
  };

  const openEditDialog = (tool: FmdTool) => {
    setEditingToolId(tool.id);
    setDraft(draftFromFmdTool(tool));
    setDialogMode("edit");
  };

  const closeDialog = () => {
    setDialogMode(null);
    setEditingToolId(null);
    setDraft(defaultFmdToolDraft(currentProfile?.name || ""));
  };

  const resetFilters = () => {
    setCategoryFilter("all");
    setSearchTerm("");
    setShowMissingLinks(false);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const accepted = await (dialogMode === "edit" && editingTool
      ? onUpdateTool(editingTool, draft)
      : onCreateTool(draft));
    if (accepted === false) return;
    closeDialog();
  };

  return (
    <div className="grid gap-4">
      <UiPanel padding="none" className="overflow-hidden">
        <div className="grid gap-4 p-4 lg:p-5">
          <div className="flex justify-end">
            <UiButton
              onClick={openCreateDialog}
              disabled={!createAllowed || pending}
              variant="primary"
              size="md"
            >
              <Plus size={16} />
              Link eintragen
            </UiButton>
          </div>

          <div className="grid gap-3">
            <div className="flex min-w-0 flex-wrap gap-2">
              {categoryTabs.map((tab) => {
                const active = categoryFilter === tab.value;
                return (
                  <button
                    key={tab.value}
                    type="button"
                    onClick={() => setCategoryFilter(tab.value)}
                    aria-pressed={active}
                    className={classNames(
                      "inline-flex h-9 min-w-0 items-center gap-2 rounded-md border px-3 text-sm font-semibold transition",
                      active ? "border-blue-300 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
                    )}
                  >
                    <span className="truncate">{tab.label}</span>
                    <span className={classNames(
                      "rounded-full px-2 py-0.5 text-[11px]",
                      active ? "bg-white text-blue-700" : "bg-slate-100 text-slate-500",
                    )}>
                      {categoryCounts[tab.value]}
                    </span>
                  </button>
                );
              })}
            </div>

            <div className="grid gap-2 lg:grid-cols-[minmax(220px,1fr)_auto] lg:items-center">
              <label className="relative min-w-0">
                <span className="sr-only">Link suchen</span>
                <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <UiTextInput
                  type="search"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  inputSize="lg"
                  inputPadding="md"
                  className="w-full pl-9"
                  placeholder="Suchen nach Link, Owner, Kategorie..."
                />
              </label>
              <div className="flex flex-wrap items-center gap-2 lg:justify-end">
                {missingLinkCount > 0 && (
                  <button
                    type="button"
                    role="switch"
                    aria-checked={showMissingLinks}
                    aria-label="Fehlende Links anzeigen"
                    onClick={() => setShowMissingLinks((value) => !value)}
                    className={classNames(
                      "inline-flex h-9 min-w-0 items-center gap-2 rounded-md border px-3 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-blue-100",
                      showMissingLinks ? "border-amber-200 bg-amber-50 text-amber-800" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
                    )}
                  >
                    <span className="truncate">Fehlende Links</span>
                    <span className={classNames(
                      "rounded-full px-2 py-0.5 text-[11px]",
                      showMissingLinks ? "bg-white text-amber-800" : "bg-slate-100 text-slate-500",
                    )}>
                      {missingLinkCount}
                    </span>
                    <span className={classNames("relative h-5 w-9 rounded-full transition", showMissingLinks ? "bg-amber-500" : "bg-slate-200")}>
                      <span className={classNames("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition", showMissingLinks ? "left-4" : "left-0.5")} />
                    </span>
                  </button>
                )}
                {filtersActive && (
                  <UiButton onClick={resetFilters} variant="ghost" size="sm" className="text-slate-500">
                    Filter zurücksetzen
                  </UiButton>
                )}
              </div>
            </div>
          </div>

          {message && <UiNotice tone="success" className="font-medium">{message}</UiNotice>}
          {!createAllowed && (
            <UiNotice tone="warning" className="font-medium">
              Link-Eintragung braucht ein angemeldetes Teamprofil.
            </UiNotice>
          )}
        </div>

        <div className="border-t border-slate-200 bg-slate-50/40 p-4 lg:p-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {filteredTools.map((tool) => (
              <FmdQuickLinkCard
                key={tool.id}
                tool={tool}
                canEditLinks={canEditLinks}
                onEdit={openEditDialog}
              />
            ))}
          </div>

          {!filteredTools.length && (
            <div className="p-4 lg:p-5">
              <UiEmptyState tone="muted" className="py-10">
                {emptyStateLabel}
              </UiEmptyState>
            </div>
          )}
        </div>
      </UiPanel>

      {dialogMode && (
        <FmdQuickLinkDialog
          mode={dialogMode}
          draft={draft}
          pending={pending}
          currentProfile={currentProfile}
          curatedLinkCount={curatedLinkCount}
          curatedLimitReached={curatedLimitReached}
          onClose={closeDialog}
          onDraftChange={setDraft}
          onSubmit={submit}
        />
      )}
    </div>
  );
}

function emptyQuickLinksLabel(toolCount: number, showMissingLinks: boolean) {
  if (!toolCount) return "Noch keine Links eingetragen.";
  return showMissingLinks ? "Keine Einträge für diese Filter." : "Keine verlinkten Einträge für diese Filter.";
}
