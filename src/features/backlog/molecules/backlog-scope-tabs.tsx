import type { BacklogScope } from "@/features/backlog/model/backlog-view-model";
import { FilterSegmentedControl } from "@/shared/molecules/filter-toolbar";

const scopeTabs: Array<{ id: BacklogScope; label: string }> = [
  { id: "all", label: "Alle" },
  { id: "proposals", label: "Vorschläge" },
  { id: "ready", label: "Bereit" },
  { id: "unscheduled", label: "Ohne Sprint" },
];

type BacklogScopeTabsProps = {
  onScopeChange: (scope: BacklogScope) => void;
  scope: BacklogScope;
  counts: Record<BacklogScope, number>;
};

export function BacklogScopeTabs({ onScopeChange, scope, counts }: BacklogScopeTabsProps) {
  return (
    <div data-tour-id="backlog-scope-tabs">
      <FilterSegmentedControl
        label="Backlog-Scope"
        value={scope}
        options={scopeTabs.map((tab) => ({ value: tab.id, label: tab.label, count: counts[tab.id] }))}
        onChange={onScopeChange}
        variant="structural"
        className="w-full"
      />
    </div>
  );
}
