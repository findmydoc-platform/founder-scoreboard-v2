import { ExternalLink } from "lucide-react";
import type { FmdTool } from "@/lib/types";

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
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-950">FMD-Tools Hub</h2>
            <p className="mt-1 text-sm text-slate-500">Zentraler Einstieg für interne Rechner, Generatoren, Crawler, Repos, Notion und Drive.</p>
          </div>
          <div className="flex flex-wrap gap-2 text-xs font-semibold">
            <span className="rounded-full border border-emerald-200 bg-emerald-50 px-2 py-1 text-emerald-700">{activeTools} aktiv</span>
            <span className="rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-amber-700">{missingLinks} Link fehlt</span>
          </div>
        </div>
      </section>

      <div className="grid gap-4 xl:grid-cols-2">
        {groups.map((group) => {
          const groupTools = tools.filter((tool) => tool.category === group.id);
          return (
            <section key={group.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
              <h3 className="text-sm font-semibold text-slate-950">{group.label}</h3>
              <div className="mt-3 grid gap-2">
                {groupTools.map((tool) => (
                  <article key={tool.id} className="rounded-md border border-slate-100 bg-slate-50 px-3 py-3">
                    <div className="flex flex-wrap items-start justify-between gap-3">
                      <div className="min-w-0">
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="font-semibold text-slate-950">{tool.name}</h4>
                          <span className="rounded-full border border-slate-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-600">{tool.kind}</span>
                        </div>
                        <p className="mt-1 text-sm leading-6 text-slate-600">{tool.description}</p>
                        <div className="mt-2 text-xs text-slate-500">{tool.owner || "Team"} · {tool.status === "missing_link" ? "Link ergänzen" : tool.status}</div>
                      </div>
                      {tool.url ? (
                        <a href={tool.url} target="_blank" rel="noreferrer" className="inline-flex h-8 shrink-0 items-center gap-2 rounded-md border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700 hover:bg-slate-50">
                          <ExternalLink size={14} />
                          Öffnen
                        </a>
                      ) : (
                        <span className="inline-flex h-8 shrink-0 items-center rounded-md border border-amber-200 bg-amber-50 px-2 text-xs font-semibold text-amber-700">Link fehlt</span>
                      )}
                    </div>
                  </article>
                ))}
                {!groupTools.length && <div className="rounded-md border border-dashed border-slate-200 px-3 py-8 text-center text-sm text-slate-500">{group.empty}</div>}
              </div>
            </section>
          );
        })}
      </div>
    </div>
  );
}
