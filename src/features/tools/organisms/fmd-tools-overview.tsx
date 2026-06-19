import { ExternalLink } from "lucide-react";
import type { FmdTool } from "@/lib/types";
import { UiAnchorButton, UiBadge, UiEmptyState, UiPanel } from "@/shared/atoms/ui-primitives";

export function FmdToolsOverview({ tools = [] }: { tools?: FmdTool[] }) {
  const groups: Array<{ id: FmdTool["category"]; label: string; empty: string }> = [
    { id: "tool", label: "Interne Tools", empty: "Noch keine internen Tools hinterlegt." },
    { id: "repo", label: "Repos & Automationen", empty: "Noch keine Repos hinterlegt." },
    { id: "knowledge", label: "Notion & Wissen", empty: "Noch keine Wissensquellen hinterlegt." },
    { id: "asset", label: "Drive & Assets", empty: "Noch keine Asset-Ablagen hinterlegt." },
  ];
  const activeTools = tools.filter((tool) => tool.status === "active").length;
  const missingLinks = tools.filter((tool) => tool.status === "missing_link").length;

  return (
    <div className="grid gap-4">
      <UiPanel>
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-950">FMD-Tools Hub</h2>
            <p className="mt-1 text-sm text-slate-500">Zentraler Einstieg für interne Rechner, Generatoren, Crawler, Repos, Notion und Drive.</p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs font-semibold">
            <UiBadge tone="emerald">{activeTools} aktiv</UiBadge>
            <UiBadge tone="amber">{missingLinks} Link fehlt</UiBadge>
          </div>
        </div>
      </UiPanel>

      <div className="grid gap-4 xl:grid-cols-2">
        {groups.map((group) => {
          const groupTools = tools.filter((tool) => tool.category === group.id);
          return (
            <UiPanel key={group.id}>
              <h3 className="text-sm font-semibold text-slate-950">{group.label}</h3>
              <div className="mt-3 grid gap-2">
                {groupTools.map((tool) => (
                  <article key={tool.id} className="rounded-md border border-slate-100 bg-slate-50 px-3 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="font-semibold text-slate-950">{tool.name}</h4>
                          <UiBadge tone="white" size="xs">{tool.kind}</UiBadge>
                        </div>
                        <p className="mt-1 text-sm leading-6 text-slate-600">{tool.description}</p>
                        <div className="mt-2 text-xs text-slate-500">{tool.owner || "Team"} · {tool.status === "missing_link" ? "Link ergänzen" : tool.status}</div>
                      </div>
                      {tool.url ? (
                        <UiAnchorButton href={tool.url} target="_blank" rel="noreferrer" size="xs">
                          <ExternalLink size={14} />
                          Öffnen
                        </UiAnchorButton>
                      ) : (
                        <UiBadge tone="amber" className="h-8 rounded-md">Link fehlt</UiBadge>
                      )}
                    </div>
                  </article>
                ))}
                {!groupTools.length && <UiEmptyState className="py-8">{group.empty}</UiEmptyState>}
              </div>
            </UiPanel>
          );
        })}
      </div>
    </div>
  );
}
