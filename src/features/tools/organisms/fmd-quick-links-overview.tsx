"use client";

import { Plus } from "lucide-react";
import { type FormEvent, useMemo, useState } from "react";
import type { PlanningState } from "@/features/planning/model/planning-state";
import type { FmdTool, Profile } from "@/lib/types";
import {
  defaultFmdToolDraft,
  draftFromFmdTool,
  hasFmdToolLink,
  maxCuratedFmdToolLinks,
  sortFmdTools,
  type FmdToolDraft,
  type FmdToolMetadataDraft,
  type FmdToolPreviewImageUpload,
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
} from "@/shared/atoms/ui-primitives";
import { FilterToolbar, FilterSegmentedControl, type ActiveFilter } from "@/shared/molecules/filter-toolbar";

type FmdQuickLinksOverviewProps = {
  planningState: PlanningState;
  tools?: FmdTool[];
  source: "supabase";
  currentProfile: Profile | null;
  pending?: boolean;
  message?: string;
  onCreateTool: (draft: FmdToolDraft, submissionId: string) => boolean | Promise<boolean>;
  onLoadMetadata: (url: string) => Promise<FmdToolMetadataDraft | null>;
  onUpdateTool: (tool: FmdTool, draft: FmdToolDraft, submissionId: string) => boolean | Promise<boolean>;
  onUploadPreviewImage: (file: File, uploadId: string) => Promise<FmdToolPreviewImageUpload | null>;
};

export function FmdQuickLinksOverview({
  planningState,
  tools = [],
  source,
  currentProfile,
  pending = false,
  message = "",
  onCreateTool,
  onLoadMetadata,
  onUpdateTool,
  onUploadPreviewImage,
}: FmdQuickLinksOverviewProps) {
  const [dialogMode, setDialogMode] = useState<FmdQuickLinkDialogMode | null>(null);
  const [editingTool, setEditingTool] = useState<FmdTool | null>(null);
  const [submissionId, setSubmissionId] = useState("");
  const [uploadId, setUploadId] = useState("");
  const [conflictBasis, setConflictBasis] = useState<FmdTool | null>(null);
  const [conflictAdopted, setConflictAdopted] = useState(false);
  const [draft, setDraft] = useState<FmdToolDraft>(() => defaultFmdToolDraft(currentProfile?.name || ""));
  const [categoryFilter, setCategoryFilter] = useState<FmdQuickLinkCategoryFilter>("all");
  const [searchTerm, setSearchTerm] = useState("");
  const [showMissingLinks, setShowMissingLinks] = useState(true);
  const [filtersOpen, setFiltersOpen] = useState(false);

  const sortedTools = useMemo(() => sortFmdTools(tools), [tools]);
  const visibleByLinkTools = useMemo(
    () => (showMissingLinks ? sortedTools : sortedTools.filter(hasFmdToolLink)),
    [showMissingLinks, sortedTools],
  );
  const canEditLinks = canEditFmdQuickLinks(source, currentProfile);
  const createAllowed = canEditLinks;
  const view = planningState.tools();
  const operation = view.operations.find(item => item.id === submissionId) || view.operations.find(item => item.toolId === editingTool?.id && ["saving", "unconfirmed"].includes(item.phase));
  const uploadBlocked = view.previews.some(item => item.id === uploadId && item.phase === "unconfirmed");
  const saveBlocked = operation?.phase === "saving" || operation?.phase === "unconfirmed" || (operation?.phase === "conflict" && !conflictAdopted);
  const normalizedSearch = searchTerm.trim().toLocaleLowerCase("de");
  const curatedLinkCount = view.curatedCount;
  const missingLinkCount = sortedTools.filter((tool) => !hasFmdToolLink(tool)).length;
  const editedToolCountsAgainstLimit = Boolean(editingTool?.isCurated && editingTool.url);
  const curatedLimitReached = curatedLinkCount !== null && curatedLinkCount >= maxCuratedFmdToolLinks && !editedToolCountsAgainstLimit;

  const categoryCounts = useMemo(() => categoryCountsForLinks(visibleByLinkTools), [visibleByLinkTools]);
  const filteredTools = useMemo(
    () => filterFmdQuickLinks(visibleByLinkTools, categoryFilter, normalizedSearch),
    [categoryFilter, normalizedSearch, visibleByLinkTools],
  );
  const emptyStateLabel = emptyQuickLinksLabel(sortedTools.length, showMissingLinks);

  const activeFilters: ActiveFilter[] = [
    ...(categoryFilter !== "all" ? [{ id: "category", label: `Kategorie: ${categoryTabs.find((tab) => tab.value === categoryFilter)?.label || categoryFilter}`, onRemove: () => setCategoryFilter("all") }] : []),
    ...(!showMissingLinks ? [{ id: "missing", label: "Nur verlinkte Einträge", onRemove: () => setShowMissingLinks(true) }] : []),
  ];

  const openCreateDialog = () => {
    setEditingTool(null);
    setDraft(defaultFmdToolDraft(currentProfile?.name || ""));
    setSubmissionId(crypto.randomUUID()); setUploadId(crypto.randomUUID()); setConflictBasis(null); setConflictAdopted(false);
    setDialogMode("create");
  };

  const openEditDialog = (tool: FmdTool) => {
    setEditingTool(structuredClone(tool));
    setDraft(draftFromFmdTool(tool));
    setSubmissionId(crypto.randomUUID()); setUploadId(crypto.randomUUID()); setConflictBasis(null); setConflictAdopted(false);
    setDialogMode("edit");
  };

  const closeDialog = () => {
    setDialogMode(null);
    setEditingTool(null);
    setDraft(defaultFmdToolDraft(currentProfile?.name || ""));
  };

  const resetFilters = () => {
    setCategoryFilter("all");
    setSearchTerm("");
    setShowMissingLinks(true);
  };

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (saveBlocked) return;
    setConflictAdopted(false);
    const accepted = await (dialogMode === "edit" && editingTool
      ? onUpdateTool(editingTool, draft, submissionId)
      : onCreateTool(draft, submissionId));
    if (accepted === false) return;
    closeDialog();
  };

  const saveNotice = operation?.phase === "unconfirmed" ? <UiNotice tone="warning">Ob der Link gespeichert wurde, ist noch unklar. Deine Eingaben bleiben erhalten. Prüfe zuerst die Speicherung. <UiButton className="min-h-11" disabled={operation.checking} onClick={() => void planningState.checkToolOutcome(operation.id)}>Aktuellen Stand prüfen</UiButton></UiNotice> : operation?.phase === "conflict" && !conflictAdopted ? <UiNotice tone="warning">
    <p>Der Link wurde inzwischen geändert. Vergleiche die Änderungen, bevor du erneut speicherst. Deine Eingaben bleiben erhalten.</p>
    {conflictBasis ? <><p className="mt-2">Aktuell gespeichert: {conflictBasis.name} · {conflictBasis.url || "Link fehlt"}</p><UiButton className="mt-2 min-h-11" onClick={() => { setEditingTool(conflictBasis); setConflictAdopted(true); }}>Aktuellen Stand übernehmen</UiButton></> : <UiButton className="mt-2 min-h-11" onClick={async () => { if (await planningState.refreshTools()) setConflictBasis(planningState.tools().tools.find(item => item.id === editingTool?.id) || null); }}>Aktuellen Stand laden</UiButton>}
  </UiNotice> : null;
  if (view.readStatus === "not-loaded" || view.readStatus === "forbidden") return <UiNotice>Links sind in dieser Sitzung nicht verfügbar.</UiNotice>;

  return (
    <div className="grid gap-4">
      <div className="space-y-2" aria-live="polite">
        {view.readStatus === "stale" ? <UiNotice>Die Linkdaten müssen erneut geprüft werden. <UiButton className="min-h-11" onClick={() => void planningState.refreshTools()}>Links aktualisieren</UiButton></UiNotice> : null}
        {!dialogMode ? view.operations.filter(item => item.phase === "unconfirmed").map(item => <UiNotice key={item.id} tone="warning">{item.draft.name}: Ob der Link gespeichert wurde, ist noch unklar. Deine Eingaben bleiben erhalten. <UiButton className="min-h-11" disabled={item.checking} onClick={() => void planningState.checkToolOutcome(item.id)}>Aktuellen Stand prüfen</UiButton></UiNotice>) : null}
        {view.operations.filter(item => item.phase === "saved" && item.warning).map(item => <UiNotice key={item.id} tone="warning">{item.warning}</UiNotice>)}
        {view.previews.filter(item => item.phase === "unconfirmed").map(item => <UiNotice key={item.id} tone="warning">{item.fileName}: Ob das Bild hochgeladen wurde, ist noch unklar. Nicht erneut hochladen. <UiButton className="min-h-11" onClick={() => void planningState.checkToolPreview(item.id)}>Upload-Ergebnis prüfen</UiButton>{item.verification === "no-reference" ? <p>Die Prüfung hat nichts erneut hochgeladen. Der Upload bleibt unklar.</p> : null}</UiNotice>)}
        {view.previews.filter(item => item.phase === "uploaded" && item.image && !tools.some(tool => tool.previewImageUrl === item.image!.imageUrl)).map(item => <UiNotice key={item.id}>Vorschaubild hochgeladen: {item.fileName}. Der Link ist damit noch nicht gespeichert.{dialogMode ? <UiButton className="min-h-11" onClick={() => setDraft(current => ({ ...current, previewImageUrl: item.image!.imageUrl, previewImageSource: "manual" }))}>Bild für diesen Entwurf übernehmen</UiButton> : null}</UiNotice>)}
      </div>
      <UiPanel padding="none" className="overflow-hidden">
        <h2 className="sr-only">Links und Tools</h2>
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

          {message && <UiNotice tone="success" className="font-medium">{message}</UiNotice>}
          {!createAllowed && (
            <UiNotice tone="warning" className="font-medium">
              {currentProfile
                ? "Viewer-Zugriff ist schreibgeschützt."
                : "Link-Eintragung braucht ein angemeldetes Teamprofil."}
            </UiNotice>
          )}
        </div>

        <FilterToolbar
          resetLabel="Filter zurücksetzen"
          className="rounded-none border-x-0 border-b-0 shadow-none"
          searchLabel="Links durchsuchen"
          searchPlaceholder="Link, Owner oder Kategorie suchen"
          query={searchTerm}
          onQueryChange={setSearchTerm}
          expanded={filtersOpen}
          onExpandedChange={setFiltersOpen}
          activeFilters={activeFilters}
          onReset={resetFilters}
          results={[{ id: "quicklinks", visibleCount: filteredTools.length, totalCount: sortedTools.length }]}
          panelId="quicklink-data-filters"
          primaryControls={(
            <FilterSegmentedControl
              label="Link-Kategorie"
              value={categoryFilter}
              options={categoryTabs.map((tab) => ({ value: tab.value, label: tab.label, count: categoryCounts[tab.value] }))}
              onChange={setCategoryFilter}
            />
          )}
        >
          {missingLinkCount > 0 && (
            <button
              type="button"
              role="switch"
              aria-checked={showMissingLinks}
              aria-label="Fehlende Links einbeziehen"
              onClick={() => setShowMissingLinks((value) => !value)}
              className={classNames(
                "inline-flex min-h-10 min-w-0 items-center gap-2 rounded-md border px-3 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-blue-100",
                showMissingLinks ? "border-amber-200 bg-amber-50 text-amber-800" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50",
              )}
            >
              <span className="truncate">Fehlende Links einbeziehen</span>
              <span className={classNames("rounded-full px-2 py-0.5 text-[11px]", showMissingLinks ? "bg-white text-amber-800" : "bg-slate-100 text-slate-500")}>{missingLinkCount}</span>
              <span className={classNames("relative h-5 w-9 rounded-full transition", showMissingLinks ? "bg-amber-500" : "bg-slate-200")}>
                <span className={classNames("absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition", showMissingLinks ? "left-4" : "left-0.5")} />
              </span>
            </button>
          )}
        </FilterToolbar>

        <div className="border-t border-slate-200 bg-slate-50/40 p-4 lg:p-5">
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-3">
            {filteredTools.map((tool) => (
              <FmdQuickLinkCard
                key={tool.id}
                tool={tool}
                saveStatus={view.operations.some(item => item.toolId === tool.id && item.phase === "unconfirmed") ? "unconfirmed" : view.operations.some(item => item.toolId === tool.id && item.phase === "saving") ? "saving" : undefined}
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
          saveBlocked={Boolean(saveBlocked)}
          uploadBlocked={uploadBlocked}
          saveNotice={saveNotice}
          currentProfile={currentProfile}
          curatedLinkCount={curatedLinkCount}
          curatedLimitReached={curatedLimitReached}
          onClose={closeDialog}
          onDraftChange={setDraft}
          onLoadMetadata={onLoadMetadata}
          onSubmit={submit}
          onUploadPreviewImage={async file => { const uploaded = await onUploadPreviewImage(file, uploadId); if (uploaded) setUploadId(crypto.randomUUID()); return uploaded; }}
        />
      )}
    </div>
  );
}

function emptyQuickLinksLabel(toolCount: number, showMissingLinks: boolean) {
  if (!toolCount) return "Noch keine Links eingetragen.";
  return showMissingLinks ? "Keine Einträge für diese Filter." : "Keine verlinkten Einträge für diese Filter.";
}
