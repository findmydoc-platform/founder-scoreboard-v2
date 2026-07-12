import { Search, SlidersHorizontal, X } from "lucide-react";
import type { ReactNode } from "react";
import { classNames, UiButton, UiPanel, UiTextInput } from "@/shared/atoms/ui-primitives";

export type ActiveFilter = {
  id: string;
  label: string;
  onRemove: () => void;
};

export type FilterOption<Value extends string = string> = {
  value: Value;
  label: string;
  count?: number;
};

export function FilterToolbar({
  searchLabel,
  searchPlaceholder,
  query,
  onQueryChange,
  expanded,
  onExpandedChange,
  activeFilters,
  onReset,
  resetLabel = "Filter zurücksetzen",
  isDirty,
  visibleCount,
  totalCount,
  primaryControls,
  children,
  className,
  panelId = "data-filters",
}: {
  searchLabel: string;
  searchPlaceholder: string;
  query: string;
  onQueryChange: (value: string) => void;
  expanded: boolean;
  onExpandedChange: (expanded: boolean) => void;
  activeFilters: ActiveFilter[];
  onReset: () => void;
  resetLabel?: string;
  isDirty?: boolean;
  visibleCount: number;
  totalCount: number;
  primaryControls?: ReactNode;
  children?: ReactNode;
  className?: string;
  panelId?: string;
}) {
  return (
    <UiPanel padding="none" className={classNames("min-w-0 overflow-hidden", className)}>
      {primaryControls && (
        <div className="border-b border-slate-100 px-4 py-3">
          {primaryControls}
        </div>
      )}
      <div className="grid gap-3 px-4 py-3 lg:grid-cols-[minmax(260px,1fr)_auto_auto] lg:items-center">
        <label className="relative min-w-0">
          <span className="sr-only">{searchLabel}</span>
          <Search className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
          <UiTextInput
            type="search"
            value={query}
            onChange={(event) => onQueryChange(event.target.value)}
            inputSize="lg"
            inputPadding="md"
            className="w-full pl-9 pr-9"
            placeholder={searchPlaceholder}
            aria-label={searchLabel}
          />
          {query && (
            <button
              type="button"
              onClick={() => onQueryChange("")}
              className="absolute right-2 top-1/2 grid h-7 w-7 -translate-y-1/2 place-items-center rounded-md text-slate-400 hover:bg-slate-100 hover:text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-100"
              aria-label="Suche löschen"
            >
              <X size={14} />
            </button>
          )}
        </label>
        <div className="flex items-center gap-2">
          <UiButton
            onClick={() => onExpandedChange(!expanded)}
            aria-expanded={expanded}
            aria-controls={panelId}
            variant={activeFilters.length ? "blue" : "secondary"}
            size="md"
          >
            <SlidersHorizontal size={16} />
            Filter{activeFilters.length ? ` (${activeFilters.length})` : ""}
          </UiButton>
          {(isDirty ?? (activeFilters.length > 0 || Boolean(query))) && (
            <UiButton onClick={onReset} variant="ghost" size="md" className="text-slate-500">
              {resetLabel}
            </UiButton>
          )}
        </div>
        <div className="whitespace-nowrap text-sm text-slate-500" aria-live="polite" aria-atomic="true">
          <strong className="text-slate-900">{visibleCount}</strong> von {totalCount}
        </div>
      </div>
      {activeFilters.length > 0 && (
        <div className="flex flex-wrap gap-2 border-t border-slate-100 px-4 py-2.5" aria-label="Aktive Filter">
          {activeFilters.map((filter) => (
            <button
              key={filter.id}
              type="button"
              onClick={filter.onRemove}
              className="inline-flex min-h-8 max-w-full items-center gap-1.5 rounded-full border border-blue-200 bg-blue-50 px-3 text-xs font-semibold text-blue-700 hover:bg-blue-100 focus:outline-none focus:ring-2 focus:ring-blue-100"
              aria-label={`${filter.label} entfernen`}
            >
              <span className="truncate">{filter.label}</span>
              <X size={13} aria-hidden="true" />
            </button>
          ))}
        </div>
      )}
      {children && (
        <div id={panelId} hidden={!expanded} className="border-t border-slate-100 bg-slate-50/60 px-4 py-4">
          {children}
        </div>
      )}
    </UiPanel>
  );
}

export function FilterField({ label, children, className }: { label: string; children: ReactNode; className?: string }) {
  return (
    <div className={classNames("grid min-w-0 gap-1.5", className)}>
      <div className="text-xs font-semibold text-slate-600">{label}</div>
      {children}
    </div>
  );
}

export function FilterSegmentedControl<Value extends string>({
  label,
  value,
  options,
  onChange,
  className,
}: {
  label: string;
  value: Value;
  options: Array<FilterOption<Value>>;
  onChange: (value: Value) => void;
  className?: string;
}) {
  return (
    <div className={classNames("flex min-w-0 flex-wrap gap-2", className)} role="group" aria-label={label}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={active}
            className={classNames(
              "inline-flex min-h-9 min-w-0 items-center gap-2 rounded-md border px-3 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-blue-100",
              active ? "border-blue-300 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900",
            )}
          >
            <span className="truncate">{option.label}</span>
            {option.count !== undefined && (
              <span className={classNames("rounded-full px-2 py-0.5 text-[11px]", active ? "bg-white text-blue-700" : "bg-slate-100 text-slate-500")}>{option.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}

export function FilterToggleGroup<Value extends string>({
  label,
  values,
  options,
  onChange,
  className,
}: {
  label: string;
  values: Value[];
  options: Array<FilterOption<Value>>;
  onChange: (values: Value[]) => void;
  className?: string;
}) {
  return (
    <div className={classNames("flex min-w-0 flex-wrap gap-2", className)} role="group" aria-label={label}>
      {options.map((option) => {
        const active = values.includes(option.value);
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(active ? values.filter((value) => value !== option.value) : [...values, option.value])}
            aria-pressed={active}
            className={classNames(
              "inline-flex min-h-9 min-w-0 items-center gap-2 rounded-md border px-3 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-blue-100",
              active ? "border-blue-300 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900",
            )}
          >
            <span className="truncate">{option.label}</span>
            {option.count !== undefined && (
              <span className={classNames("rounded-full px-2 py-0.5 text-[11px]", active ? "bg-white text-blue-700" : "bg-slate-100 text-slate-500")}>{option.count}</span>
            )}
          </button>
        );
      })}
    </div>
  );
}
