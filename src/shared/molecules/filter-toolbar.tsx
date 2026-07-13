import { Search, SlidersHorizontal, X } from "lucide-react";
import { useId, type ReactNode } from "react";
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

export type FilterResult = {
  id: string;
  label?: string;
  visibleCount: number;
  totalCount: number;
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
  results,
  filterCount = activeFilters.length,
  primaryControls,
  children,
  className,
  panelId,
  density = "default",
  variant = "standalone",
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
  results: FilterResult[];
  filterCount?: number;
  primaryControls?: ReactNode;
  children?: ReactNode;
  className?: string;
  panelId?: string;
  density?: "default" | "compact";
  variant?: "standalone" | "embedded";
}) {
  const generatedId = useId();
  const resolvedPanelId = panelId || `${generatedId}-filters`;
  const content = (
    <>
      {primaryControls && (
        <div className={classNames("border-b border-slate-100", density === "compact" ? "px-3 py-2.5" : "px-4 py-3")}>
          {primaryControls}
        </div>
      )}
      <div className={classNames("grid gap-3 lg:grid-cols-[minmax(260px,1fr)_auto_auto] lg:items-center", density === "compact" ? "px-3 py-2.5" : "px-4 py-3")}>
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
            aria-controls={resolvedPanelId}
            variant={filterCount ? "blue" : "secondary"}
            size="md"
          >
            <SlidersHorizontal size={16} />
            Filter{filterCount ? ` (${filterCount})` : ""}
          </UiButton>
          {(isDirty ?? (activeFilters.length > 0 || Boolean(query))) && (
            <UiButton onClick={onReset} variant="ghost" size="md" className="text-slate-500">
              {resetLabel}
            </UiButton>
          )}
        </div>
        <div className="flex flex-wrap justify-start gap-x-3 gap-y-1 whitespace-nowrap text-sm text-slate-500 lg:justify-end" aria-live="polite" aria-atomic="true">
          {results.map((result) => (
            <span key={result.id}>
              {result.label && <span>{result.label}: </span>}
              <strong className="text-slate-900">{result.visibleCount}</strong> von {result.totalCount}
            </span>
          ))}
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
        <div id={resolvedPanelId} hidden={!expanded} className={classNames("border-t border-slate-100 bg-slate-50/60", density === "compact" ? "px-3 py-3" : "px-4 py-4")}>
          {children}
        </div>
      )}
    </>
  );

  if (variant === "embedded") return <div className={classNames("min-w-0", className)}>{content}</div>;
  return <UiPanel padding="none" className={classNames("min-w-0 overflow-hidden", className)}>{content}</UiPanel>;
}

export function FilterField({ label, children, className, labelId }: { label: string; children: ReactNode; className?: string; labelId?: string }) {
  const generatedId = useId();
  const resolvedLabelId = labelId || `${generatedId}-label`;
  return (
    <div className={classNames("grid min-w-0 gap-1.5", className)}>
      <div id={resolvedLabelId} className="text-xs font-semibold text-slate-600">{label}</div>
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
  variant = "default",
}: {
  label: string;
  value: Value;
  options: Array<FilterOption<Value>>;
  onChange: (value: Value) => void;
  className?: string;
  variant?: "default" | "structural";
}) {
  return (
    <div className={classNames(
      variant === "structural" ? "flex min-w-0 max-w-full overflow-x-auto border border-slate-300 bg-white" : "flex min-w-0 flex-wrap gap-2",
      className,
    )} role="group" aria-label={label}>
      {options.map((option) => {
        const active = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            onClick={() => onChange(option.value)}
            aria-pressed={active}
            className={classNames(
              "inline-flex min-h-9 min-w-0 items-center gap-2 px-3 text-sm font-semibold transition focus:outline-none focus:ring-2",
              variant === "structural" ? "shrink-0 border-r border-slate-300 last:border-r-0 focus:ring-blue-500 focus:ring-inset" : "rounded-md border focus:ring-blue-100",
              variant === "structural" && active ? "bg-slate-900 text-white" : variant === "structural" ? "bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900" : active ? "border-blue-300 bg-blue-50 text-blue-700" : "border-slate-200 bg-white text-slate-600 hover:bg-slate-50 hover:text-slate-900",
            )}
          >
            <span className="truncate">{option.label}</span>
            {option.count !== undefined && (
              <span className={classNames(
                variant === "structural" ? "rounded-none px-2 py-0.5 text-[11px]" : "rounded-full px-2 py-0.5 text-[11px]",
                variant === "structural" && active ? "bg-white/20 text-white" : active ? "bg-white text-blue-700" : "bg-slate-100 text-slate-500",
              )}>{option.count}</span>
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
