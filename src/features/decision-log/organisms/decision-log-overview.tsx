"use client";

import { Info } from "lucide-react";
import { useId, useMemo, useState } from "react";
import type { NotionDecisionLogEntry, NotionDecisionLogResult } from "@/lib/notion-decision-log";
import {
  buildDecisionLogViewModel,
  DECISION_LOG_PAGE_SIZE,
  decisionLogFilterKey,
  decisionLogFormLabel,
  decisionLogReasonKeys,
  decisionLogReasonOptions,
  decisionLogScopes,
  DEFAULT_DECISION_LOG_FILTERS,
  type DecisionLogFilters,
  type DecisionLogReasonKey,
  type DecisionLogScope,
  type DecisionLogSort,
  visibleDecisionLogEntries,
} from "@/features/decision-log/model/decision-log-view-model";
import { DecisionDetailPanel, DecisionDetailSheet } from "@/features/decision-log/molecules/decision-detail-panel";
import { classNames, UiBadge, UiButton, UiNotice, type UiTone } from "@/shared/atoms/ui-primitives";
import { ColumnFilterPopover } from "@/shared/molecules/column-filter-popover";
import { DataCell, DataColumnHeader, DataEmptyRow, DataRow, DataTableFrame, DataTableHead, type SortDirection } from "@/shared/molecules/data-surface";
import { FilterField, FilterSegmentedControl, FilterToggleGroup, FilterToolbar, type ActiveFilter } from "@/shared/molecules/filter-toolbar";
import { enumUrlField, multiEnumUrlField, stringUrlField, useTableUrlState, type TableUrlField, type TableUrlSchema } from "@/shared/hooks/use-table-url-state";

const scopeOptions: Array<{ value: DecisionLogScope; label: string }> = [
  { value: "attention", label: "Handlungsbedarf" },
  { value: "all", label: "Alle Entscheidungen" },
  { value: "decided", label: "Beschlossen" },
  { value: "archive", label: "Archiv" },
];

function DecisionReasonInfo() {
  const tooltipId = useId();
  return (
    <span className="group/reason-info relative inline-flex shrink-0 normal-case">
      <button
        type="button"
        aria-label="Warum jetzt erklären"
        aria-describedby={tooltipId}
        className="grid h-6 w-6 cursor-help place-items-center rounded-full text-slate-400 outline-none transition hover:bg-blue-50 hover:text-blue-700 focus:bg-blue-50 focus:text-blue-700 focus:ring-2 focus:ring-blue-100"
      >
        <Info size={14} aria-hidden="true" />
      </button>
      <span
        id={tooltipId}
        role="tooltip"
        className="pointer-events-none absolute right-0 top-7 z-30 w-72 rounded-md border border-slate-200 bg-white px-3 py-2 text-left text-xs font-medium leading-5 tracking-normal text-slate-700 opacity-0 shadow-lg transition group-hover/reason-info:opacity-100 group-focus-within/reason-info:opacity-100"
      >
        Automatisch abgeleitete Gründe für aktuellen Handlungsbedarf, zum Beispiel offene Entscheidung, Abstimmung, Bestätigung oder Prüfung. Das Review-Datum allein zählt nicht.
      </span>
    </span>
  );
}

function categoryUrlField(categories: string[]): TableUrlField<string[]> {
  return {
    defaultValue: [],
    parse: (values) => {
      if (!values.length) return undefined;
      const selected = Array.from(new Set(values.filter((value) => categories.includes(value))));
      return selected.length ? selected : undefined;
    },
    serialize: (values) => values,
    equals: (left, right) => left.length === right.length && left.every((value, index) => value === right[index]),
  };
}

function createFilterSchema(categories: string[]): TableUrlSchema<DecisionLogFilters> {
  return {
    scope: enumUrlField("attention", decisionLogScopes),
    query: stringUrlField(),
    reasons: multiEnumUrlField<DecisionLogReasonKey>([], decisionLogReasonKeys),
    categories: categoryUrlField(categories),
    sort: enumUrlField("date", ["date", "decision", "status", "owner"] as const),
    direction: enumUrlField("desc", ["asc", "desc"] as const),
  };
}

function formatDate(value: string) {
  if (!value) return "–";
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("de-DE", { day: "2-digit", month: "2-digit", year: "numeric" }).format(date);
}

function formatFetchedAt(value: string) {
  const date = new Date(value);
  return Number.isNaN(date.getTime())
    ? value
    : new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function statusTone(status: string): UiTone {
  const normalized = status.toLocaleLowerCase("de");
  if (normalized.includes("bestätigt")) return "emerald";
  if (normalized.includes("prüfung")) return "blue";
  if (normalized.includes("entwurf")) return "amber";
  return "slate";
}

function statusLabel(entry: NotionDecisionLogEntry) {
  return entry.status || "Ohne Status";
}

function DecisionLogLoadedOverview({ entries, fetchedAt }: { entries: NotionDecisionLogEntry[]; fetchedAt: string }) {
  const categories = useMemo(
    () => Array.from(new Set(entries.map((entry) => entry.category).filter(Boolean))).sort((left, right) => left.localeCompare(right, "de")),
    [entries],
  );
  const filterSchema = useMemo(() => createFilterSchema(categories), [categories]);
  const { state: filters, updateState: updateUrlState, resetState: resetUrlState } = useTableUrlState({ namespace: "decisions", schema: filterSchema });
  const [filtersOpen, setFiltersOpen] = useState(false);
  const [selectedId, setSelectedId] = useState<string | null | undefined>(undefined);
  const [mobileDetailOpen, setMobileDetailOpen] = useState(false);
  const viewModel = useMemo(() => buildDecisionLogViewModel({ entries, filters }), [entries, filters]);
  const filterKey = decisionLogFilterKey(filters);
  const [visibleRowsState, setVisibleRowsState] = useState(() => ({ filterKey, limit: DECISION_LOG_PAGE_SIZE }));
  if (visibleRowsState.filterKey !== filterKey) {
    setVisibleRowsState({ filterKey, limit: DECISION_LOG_PAGE_SIZE });
  }
  const visibleLimit = visibleRowsState.filterKey === filterKey ? visibleRowsState.limit : DECISION_LOG_PAGE_SIZE;
  const visibleEntries = visibleDecisionLogEntries(viewModel.filteredEntries, visibleLimit);
  const selectedEntry = selectedId === null
    ? null
    : viewModel.filteredEntries.find((entry) => entry.id === selectedId) || viewModel.filteredEntries[0] || null;
  const selectedReasons = selectedEntry ? viewModel.reasonsById.get(selectedEntry.id) || [] : [];

  const updateFilters = (patch: Partial<DecisionLogFilters>, history: "push" | "replace" = "push") => {
    updateUrlState(patch, history);
  };
  const resetFilters = () => {
    resetUrlState();
  };
  const openEntry = (entry: NotionDecisionLogEntry) => {
    setSelectedId(entry.id);
    if (!window.matchMedia("(min-width: 1280px)").matches) setMobileDetailOpen(true);
  };
  const toggleSort = (sort: DecisionLogSort) => {
    updateFilters({ sort, direction: filters.sort === sort && filters.direction === "asc" ? "desc" : "asc" });
  };
  const directionFor = (sort: DecisionLogSort): SortDirection => filters.sort === sort ? filters.direction : null;
  const scopeCounts = viewModel.counts;
  const activeFilters: ActiveFilter[] = [
    ...filters.reasons.map((reason) => ({
      id: `reason-${reason}`,
      label: `Grund: ${decisionLogReasonOptions.find((option) => option.value === reason)?.label || reason}`,
      onRemove: () => updateFilters({ reasons: filters.reasons.filter((value) => value !== reason) }),
    })),
    ...filters.categories.map((category) => ({
      id: `category-${category}`,
      label: `Kategorie: ${category}`,
      onRemove: () => updateFilters({ categories: filters.categories.filter((value) => value !== category) }),
    })),
  ];
  const isDirty = filters.scope !== DEFAULT_DECISION_LOG_FILTERS.scope
    || Boolean(filters.query)
    || Boolean(filters.reasons.length)
    || Boolean(filters.categories.length)
    || filters.sort !== DEFAULT_DECISION_LOG_FILTERS.sort
    || filters.direction !== DEFAULT_DECISION_LOG_FILTERS.direction;
  const categoryOptions = categories.map((category) => ({ value: category, label: category }));
  const toolbar = (
    <FilterToolbar
      variant="embedded"
      searchLabel="Entscheidungen durchsuchen"
      searchPlaceholder="Entscheidung, Kurzfassung, Owner oder Beschluss suchen"
      query={filters.query}
      onQueryChange={(query) => updateFilters({ query }, "replace")}
      expanded={filtersOpen}
      onExpandedChange={setFiltersOpen}
      activeFilters={activeFilters}
      isDirty={isDirty}
      onReset={resetFilters}
      results={[{ id: "decisions", visibleCount: viewModel.filteredEntries.length, totalCount: viewModel.scopedEntries.length }]}
      panelId="decision-log-filters"
      primaryControls={(
        <FilterSegmentedControl
          label="Decision-Log-Ansicht"
          value={filters.scope}
          options={scopeOptions.map((option) => ({ ...option, count: scopeCounts[option.value] }))}
          onChange={(scope) => updateFilters({ scope })}
        />
      )}
    >
      <div className="grid gap-4 lg:grid-cols-2">
        <FilterField label="Handlungsgrund">
          <FilterToggleGroup label="Nach Handlungsgrund filtern" values={filters.reasons} options={decisionLogReasonOptions} onChange={(reasons) => updateFilters({ reasons })} />
        </FilterField>
        <FilterField label="Kategorie">
          {categoryOptions.length ? (
            <FilterToggleGroup label="Nach Kategorie filtern" values={filters.categories} options={categoryOptions} onChange={(nextCategories) => updateFilters({ categories: nextCategories })} />
          ) : <span className="text-sm font-normal text-slate-500">Keine Kategorien vorhanden.</span>}
        </FilterField>
      </div>
    </FilterToolbar>
  );

  return (
    <div className="grid gap-3">
      <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
        <span>Direkt aus Notion · keine Speicherung</span>
        <span>Zuletzt geladen: {formatFetchedAt(fetchedAt)}</span>
      </div>

      <div className={classNames("grid items-start gap-0", selectedEntry && "xl:grid-cols-[minmax(0,1fr)_380px]")}>
        <div className="min-w-0">
          <p id="decision-detail-selection-status" className="sr-only" aria-live="polite">
            {selectedEntry ? `Details für ${selectedEntry.decision} geöffnet.` : "Keine Entscheidungsdetails geöffnet."}
          </p>
          <DataTableFrame
            title="Entscheidungen"
            description={`${Math.min(visibleLimit, viewModel.filteredEntries.length)} aktuell dargestellt`}
            caption="Read-only Decision Log aus Notion"
            results={[{ id: "decisions", visibleCount: viewModel.filteredEntries.length, totalCount: viewModel.scopedEntries.length }]}
            filtering={{ mode: "embedded", toolbar }}
            minWidth={940}
            surfaceVariant="structural"
          >
            <DataTableHead>
              <tr>
                <DataColumnHeader className="w-32" label="Datum" direction={directionFor("date")} onSort={() => toggleSort("date")} />
                <DataColumnHeader
                  className="min-w-72"
                  label="Entscheidung"
                  direction={directionFor("decision")}
                  onSort={() => toggleSort("decision")}
                  filter={categoryOptions.length ? (
                    <ColumnFilterPopover label="Entscheidungen nach Kategorie filtern" activeCount={filters.categories.length} onReset={() => updateFilters({ categories: [] })}>
                      <FilterToggleGroup label="Kategorien wählen" values={filters.categories} options={categoryOptions} onChange={(nextCategories) => updateFilters({ categories: nextCategories })} />
                    </ColumnFilterPopover>
                  ) : undefined}
                />
                <DataColumnHeader
                  className="min-w-64"
                  label="Warum jetzt"
                  filter={(
                    <div className="flex items-center gap-0.5">
                      <DecisionReasonInfo />
                      <ColumnFilterPopover label="Entscheidungen nach Handlungsgrund filtern" activeCount={filters.reasons.length} onReset={() => updateFilters({ reasons: [] })}>
                        <FilterToggleGroup label="Handlungsgründe wählen" values={filters.reasons} options={decisionLogReasonOptions} onChange={(reasons) => updateFilters({ reasons })} />
                      </ColumnFilterPopover>
                    </div>
                  )}
                />
                <DataColumnHeader className="w-40" label="Status" direction={directionFor("status")} onSort={() => toggleSort("status")} />
                <DataColumnHeader className="w-48" label="Owner" direction={directionFor("owner")} onSort={() => toggleSort("owner")} />
              </tr>
            </DataTableHead>
            <tbody>
              {visibleEntries.map((entry) => {
                const reasons = viewModel.reasonsById.get(entry.id) || [];
                const selected = selectedEntry?.id === entry.id;
                const cellClassName = selected ? "bg-blue-50/70" : undefined;
                const showOpenVote = Boolean(entry.googleFormUrl) && decisionLogFormLabel(entry) === "Zur Abstimmung ↗";
                return (
                  <DataRow
                    key={entry.id}
                    className="cursor-pointer"
                    onClick={() => openEntry(entry)}
                  >
                    <DataCell className={classNames("whitespace-nowrap text-slate-600", cellClassName)}>{formatDate(entry.date)}</DataCell>
                    <DataCell className={classNames("max-w-sm", cellClassName)}>
                      <button
                        type="button"
                        aria-describedby={selected ? "decision-detail-selection-status" : undefined}
                        aria-pressed={selected}
                        className="rounded-sm text-left font-semibold leading-5 text-slate-950 hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-100"
                        onClick={(event) => {
                          event.stopPropagation();
                          openEntry(entry);
                        }}
                      >
                        {entry.decision}
                      </button>
                      {entry.summary && <p className="mt-1 line-clamp-2 text-xs leading-5 text-slate-500">{entry.summary}</p>}
                      {entry.category && <UiBadge tone="slate" size="xs" className="mt-2">{entry.category}</UiBadge>}
                    </DataCell>
                    <DataCell className={classNames("max-w-xs", cellClassName)}>
                      {reasons.length ? (
                        <ul className="grid gap-1.5">
                          {reasons.map((reason) => <li key={reason.key} className="text-sm font-medium text-slate-700">• {reason.label}</li>)}
                        </ul>
                      ) : <span className="text-slate-400">–</span>}
                      {showOpenVote && (
                        <a
                          className="mt-2 inline-flex text-sm font-semibold text-blue-700 hover:text-blue-900 focus:outline-none focus:ring-2 focus:ring-blue-100"
                          href={entry.googleFormUrl}
                          rel="noreferrer"
                          target="_blank"
                          onClick={(event) => event.stopPropagation()}
                        >
                          Zur Abstimmung ↗
                        </a>
                      )}
                    </DataCell>
                    <DataCell className={cellClassName}><UiBadge tone={statusTone(entry.status)} shape="rectangular">{statusLabel(entry)}</UiBadge></DataCell>
                    <DataCell className={classNames("text-slate-700", cellClassName)}>{entry.owners.join(", ") || "–"}</DataCell>
                  </DataRow>
                );
              })}
              {!visibleEntries.length && (
                <DataEmptyRow colSpan={5}>
                  {entries.length ? "Keine Entscheidungen für diese Ansicht und Filter." : "Noch keine Entscheidungen in Notion vorhanden."}
                </DataEmptyRow>
              )}
            </tbody>
          </DataTableFrame>

          {visibleLimit < viewModel.filteredEntries.length && (
            <div className="flex justify-center border-x border-b border-slate-300 bg-white px-4 py-3">
              <UiButton
                onClick={() => setVisibleRowsState({ filterKey, limit: visibleLimit + DECISION_LOG_PAGE_SIZE })}
                variant="secondary"
              >
                Mehr anzeigen ({Math.min(DECISION_LOG_PAGE_SIZE, viewModel.filteredEntries.length - visibleLimit)} weitere)
              </UiButton>
            </div>
          )}
        </div>

        {selectedEntry && <DecisionDetailPanel entry={selectedEntry} reasons={selectedReasons} onClose={() => setSelectedId(null)} />}
      </div>

      {mobileDetailOpen && selectedEntry && (
        <DecisionDetailSheet
          entry={selectedEntry}
          reasons={selectedReasons}
          onClose={() => {
            setMobileDetailOpen(false);
            setSelectedId(null);
          }}
        />
      )}
    </div>
  );
}

export function DecisionLogOverview({ result }: { result: NotionDecisionLogResult }) {
  if (!result.ok) {
    return (
      <UiNotice role="alert" tone={result.code === "missing_configuration" ? "warning" : "danger"} className="p-5">
        <h2 className="font-semibold">Decision Log nicht verfügbar</h2>
        <p className="mt-1">{result.message}</p>
        <p className="mt-2 text-xs">Abruf: {formatFetchedAt(result.fetchedAt)}</p>
      </UiNotice>
    );
  }
  return <DecisionLogLoadedOverview entries={result.entries} fetchedAt={result.fetchedAt} />;
}
