import { Search } from "lucide-react";

type BacklogToolbarProps = {
  onQueryChange: (query: string) => void;
  query: string;
};

export function BacklogToolbar({ onQueryChange, query }: BacklogToolbarProps) {
  return (
    <div className="flex flex-wrap items-center justify-end gap-3">
      <div className="relative min-w-[260px]">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-slate-400" size={16} />
        <input
          value={query}
          onChange={(event) => onQueryChange(event.target.value)}
          className="h-9 w-full rounded-md border border-slate-200 bg-white pl-9 pr-3 text-sm outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
          placeholder="Backlog durchsuchen"
        />
      </div>
    </div>
  );
}
