import { ArrowDown, ArrowUp, ArrowUpDown } from "lucide-react";
import type { HTMLAttributes, ReactNode, TableHTMLAttributes, TdHTMLAttributes, ThHTMLAttributes } from "react";
import { classNames, UiEmptyState, UiPanel } from "@/shared/atoms/ui-primitives";

type DataSurfaceProps = HTMLAttributes<HTMLElement> & {
  as?: "section" | "div" | "article";
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
  headerClassName?: string;
};

export function DataSurface({
  as = "section",
  title,
  description,
  actions,
  headerClassName,
  className,
  children,
  ...props
}: DataSurfaceProps) {
  const hasHeader = title || description || actions;

  return (
    <UiPanel as={as} padding="none" className={classNames("min-w-0 overflow-hidden", className)} {...props}>
      {hasHeader && (
        <DataSurfaceHeader title={title} description={description} actions={actions} className={headerClassName} />
      )}
      {children}
    </UiPanel>
  );
}

type DataSurfaceHeaderProps = HTMLAttributes<HTMLDivElement> & {
  title?: ReactNode;
  description?: ReactNode;
  actions?: ReactNode;
};

export function DataSurfaceHeader({ title, description, actions, className, children, ...props }: DataSurfaceHeaderProps) {
  return (
    <div className={classNames("flex items-start justify-between gap-3 border-b border-slate-100 px-4 py-3", className)} {...props}>
      <div className="min-w-0">
        {title && <h2 className="text-base font-semibold text-slate-950">{title}</h2>}
        {description && <p className="text-xs text-slate-500">{description}</p>}
        {children}
      </div>
      {actions && <div className="shrink-0">{actions}</div>}
    </div>
  );
}

export function DataOverflow({
  className,
  tabIndex = 0,
  role = "region",
  "aria-label": ariaLabel = "Inhalt horizontal und vertikal scrollen",
  ...props
}: HTMLAttributes<HTMLDivElement>) {
  return (
    <div
      className={classNames("overflow-auto pb-2 [scrollbar-gutter:stable] focus:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-inset", className)}
      tabIndex={tabIndex}
      role={role}
      aria-label={ariaLabel}
      {...props}
    />
  );
}

type DataTableProps = TableHTMLAttributes<HTMLTableElement> & {
  minWidth?: number | string;
};

export function DataTable({ minWidth = 840, style, className, ...props }: DataTableProps) {
  const resolvedMinWidth = typeof minWidth === "number" ? `${minWidth}px` : minWidth;
  return (
    <table
      className={classNames("w-full border-separate border-spacing-0 text-left text-sm", className)}
      style={{ minWidth: resolvedMinWidth, ...style }}
      {...props}
    />
  );
}

export function DataTableHead({ className, ...props }: HTMLAttributes<HTMLTableSectionElement>) {
  return <thead className={classNames("bg-slate-50 text-xs uppercase text-slate-500", className)} {...props} />;
}

export function DataRow({ className, ...props }: HTMLAttributes<HTMLTableRowElement>) {
  return <tr className={classNames("align-top hover:bg-slate-50", className)} {...props} />;
}

export function DataHeaderCell({ className, ...props }: ThHTMLAttributes<HTMLTableCellElement>) {
  return <th scope="col" className={classNames("border-b border-slate-200 px-3 py-3 font-semibold", className)} {...props} />;
}

export type SortDirection = "asc" | "desc" | null;

export function SortableDataHeaderCell({
  label,
  direction,
  onSort,
  className,
}: {
  label: string;
  direction: SortDirection;
  onSort: () => void;
  className?: string;
}) {
  const Icon = direction === "asc" ? ArrowUp : direction === "desc" ? ArrowDown : ArrowUpDown;
  return (
    <DataHeaderCell className={className} aria-sort={direction === "asc" ? "ascending" : direction === "desc" ? "descending" : "none"}>
      <button
        type="button"
        onClick={onSort}
        className="flex min-h-8 w-full items-center gap-1.5 text-left hover:text-slate-900 focus:outline-none focus:ring-2 focus:ring-blue-100"
      >
        <span>{label}</span>
        <Icon size={13} className={direction ? "text-blue-600" : "text-slate-400"} aria-hidden="true" />
      </button>
    </DataHeaderCell>
  );
}

export function DataCell({ className, ...props }: TdHTMLAttributes<HTMLTableCellElement>) {
  return <td className={classNames("border-b border-slate-100 px-3 py-3", className)} {...props} />;
}

type DataEmptyRowProps = TdHTMLAttributes<HTMLTableCellElement> & {
  children: ReactNode;
};

export function DataEmptyRow({ colSpan, className, children, ...props }: DataEmptyRowProps) {
  return (
    <tr>
      <td colSpan={colSpan} className={classNames("px-4 py-8", className)} {...props}>
        <UiEmptyState tone="neutral">{children}</UiEmptyState>
      </td>
    </tr>
  );
}
