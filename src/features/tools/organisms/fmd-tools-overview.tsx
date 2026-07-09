"use client";

import { Plus, Search } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import type { FmdTool, Profile } from "@/lib/types";
import {
  defaultFmdToolDraft,
  draftFromFmdTool,
  maxCuratedFmdToolLinks,
  sortFmdTools,
  type FmdToolDraft,
} from "@/features/tools/model/fmd-tools";
import { FmdToolRegistryDialog } from "@/features/tools/molecules/fmd-tool-registry-dialog";
import { FmdToolRegistryRow } from "@/features/tools/molecules/fmd-tool-registry-row";
import {
  canEditFmdTools,
  categoryCountsForTools,
  categoryTabs,
  filterFmdTools,
  type FmdToolCategoryFilter,
  type FmdToolDialogMode,
} from "@/features/tools/model/fmd-tool-registry-view";
import {
  classNames,
  UiButton,
  UiEmptyState,
  UiNotice,
  UiPanel,
  UiTextInput,
} from "@/shared/atoms/ui-primitives";

type FmdToolsOverviewProps = {
  tools?: FmdTool[];
  source: "seed" | "supabase";
  currentProfile: Profile | null;
  pending?: boolean;
  message?: string;
  onCreateTool: (draft: FmdToolDraft) => boolean | Promise<boolean>;
  onUpdateTool: (tool: FmdTool, draft: FmdToolDraft) => boolean | Promise<boolean>;
};

export function FmdToolsOverview({
  tools = [],
  source,
  currentProfile,
  pending = false,
  message = "",
  onCreateTool,
  onUpdateTool,
}: FmdToolsOverviewProps) {
  const [dialogMode, setDialogMode] = useState<FmdToolDialogMode | null>(null);
  const [editingToolId, setEditingToolId] = useState<string | null>(null);
  const [draft, setDraft] = useState<FmdToolDraft>(() => defaultFmdToolDraft(currentProfile?.name || ""));
  const [categoryFilter, setCategoryFilter] = useState<FmdToolCategoryFilter>("all");
  const [searchTerm, setSearchTerm] = useState("");

  const sortedTools = useMemo(() => sortFmdTools(tools), [tools]);
  const createAllowed = source === "seed" || Boolean(currentProfile);
  const canEditTools = canEditFmdTools(source, currentProfile);
  const editingTool = editingToolId ? sortedTools.find((tool) => tool.id === editingToolId) || null : null;
  const normalizedSearch = searchTerm.trim().toLocaleLowerCase("de");
  const curatedLinkCount = sortedTools.filter((tool) => tool.isCurated && tool.url).length;
  const editedToolCountsAgainstLimit = Boolean(editingTool?.isCurated && editingTool.url);
  const curatedLimitReached = curatedLinkCount >= maxCuratedFmdToolLinks && !editedToolCountsAgainstLimit;

  const categoryCounts = useMemo(() => categoryCountsForTools(sortedTools), [sortedTools]);
  const filteredTools = useMemo(
    () => filterFmdTools(sortedTools, categoryFilter, normalizedSearch),
    [categoryFilter, normalizedSearch, sortedTools],
  );

  const filtersActive = categoryFilter !== "all" || Boolean(normalizedSearch);

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
              Tool eintragen
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
                <span className="sr-only">Werkzeug suchen</span>
                <Search size={16} className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" />
                <UiTextInput
                  type="search"
                  value={searchTerm}
                  onChange={(event) => setSearchTerm(event.target.value)}
                  inputSize="lg"
                  inputPadding="md"
                  className="w-full pl-9"
                  placeholder="Suchen nach Tool, Owner, Kategorie..."
                />
              </label>
              {filtersActive && (
                <UiButton onClick={resetFilters} variant="ghost" size="sm" className="justify-self-start text-slate-500 lg:justify-self-end">
                  Filter zurücksetzen
                </UiButton>
              )}
            </div>
          </div>

          {message && <UiNotice tone="success" className="font-medium">{message}</UiNotice>}
          {!createAllowed && (
            <UiNotice tone="warning" className="font-medium">
              Tool-Eintragung braucht ein angemeldetes Teamprofil.
            </UiNotice>
          )}
        </div>

        <div className="border-t border-slate-200 bg-slate-50/40 p-4 lg:p-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {filteredTools.map((tool) => (
              <FmdToolRegistryRow
                key={tool.id}
                tool={tool}
                canEditTools={canEditTools}
                onEdit={openEditDialog}
              />
            ))}
          </div>

          {!filteredTools.length && (
            <div className="p-4 lg:p-5">
              <UiEmptyState tone="muted" className="py-10">
                {sortedTools.length ? "Keine Einträge für diese Filter." : "Noch keine Werkzeuge eingetragen."}
              </UiEmptyState>
            </div>
          )}
        </div>
      </UiPanel>

      {dialogMode && (
        <FmdToolRegistryDialog
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
