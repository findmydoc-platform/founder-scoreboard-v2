import type { BacklogScope } from "@/features/backlog/model/backlog-view-model";

const scopeTabs: Array<{ id: BacklogScope; label: string }> = [
  { id: "all", label: "Alle" },
  { id: "proposals", label: "Vorschläge" },
  { id: "ready", label: "Bereit" },
  { id: "unscheduled", label: "Ohne Sprint" },
];

type BacklogScopeTabsProps = {
  onScopeChange: (scope: BacklogScope) => void;
  scope: BacklogScope;
};

export function BacklogScopeTabs({ onScopeChange, scope }: BacklogScopeTabsProps) {
  return (
    <div className="grid gap-2">
      <div className="grid max-w-full grid-cols-[116px_minmax(0,1fr)] items-center gap-2" data-tour-id="backlog-scope-tabs">
        <div className="text-xs font-semibold uppercase text-slate-500">Aufgaben-Scope</div>
        <div className="flex min-w-0 flex-wrap gap-2">
          {scopeTabs.map((tab) => (
            <button
              key={tab.id}
              type="button"
              onClick={() => onScopeChange(tab.id)}
              className={`inline-flex h-8 shrink-0 items-center border-b-2 px-1 text-sm font-semibold ${
                scope === tab.id ? "border-blue-600 text-blue-700" : "border-transparent text-slate-500 hover:text-slate-800"
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
