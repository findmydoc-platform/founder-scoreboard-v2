import { ChevronRight } from "lucide-react";
import type { DecisionAuditEntry } from "@/features/decisions/model/decision-log-view-model";
import { formatDate } from "@/lib/display";
import type { Profile } from "@/lib/types";

function auditActionLabel(action: string) {
  const labels: Record<string, string> = {
    "decision.create": "Decision erstellt",
    "decision.update": "Decision geändert",
    "decision.confirm": "Bestätigung",
    confirm: "Bestätigung",
    confirm_and_lock: "Bestätigt und gelockt",
    "decision.objection": "Einwand gespeichert",
  };
  return labels[action] || action;
}

function auditFieldLabel(field: string) {
  const labels: Record<string, string> = {
    title: "Titel",
    context: "Kontext",
    decision: "Entscheidung",
    status: "Status",
    required_profile_ids: "Bestätigung erforderlich von",
    requiredProfileIds: "Bestätigung erforderlich von",
  };
  return labels[field] || field;
}

function formatAuditValue(field: string, value: unknown, profiles: Profile[]) {
  if (value === null || value === undefined || value === "") return "leer";
  if ((field === "required_profile_ids" || field === "requiredProfileIds") && Array.isArray(value)) {
    return value.map((id) => profiles.find((profile) => profile.id === id)?.name || String(id)).join(", ") || "leer";
  }
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (Array.isArray(value)) return value.map(String).join(", ");
  return JSON.stringify(value);
}

function auditChanges(entry: DecisionAuditEntry, profiles: Profile[]) {
  const before = entry.beforeData || {};
  const after = entry.afterData || {};
  const ignored = new Set(["id", "created_at", "updated_at", "created_by", "locked_at"]);
  return Array.from(new Set([...Object.keys(before), ...Object.keys(after)]))
    .filter((field) => !ignored.has(field))
    .filter((field) => JSON.stringify(before[field]) !== JSON.stringify(after[field]))
    .map((field) => ({
      field,
      label: auditFieldLabel(field),
      before: formatAuditValue(field, before[field], profiles),
      after: formatAuditValue(field, after[field], profiles),
    }));
}

type DecisionAuditTrailProps = {
  auditEntries: DecisionAuditEntry[];
  auditOpen: boolean;
  profiles: Profile[];
  onToggleAudit: () => void;
};

export function DecisionAuditTrail({ auditEntries, auditOpen, profiles, onToggleAudit }: DecisionAuditTrailProps) {
  return (
    <>
      <div className="hidden">
        Audit: {auditEntries.slice(0, 3).map((entry) => {
          const actor = profiles.find((profile) => profile.id === entry.actorProfileId)?.name || entry.actorProfileId || "System";
          return `${entry.action} · ${actor} · ${formatDate(entry.createdAt)}`;
        }).join(" / ") || "Noch kein Audit-Eintrag geladen."}
      </div>
      <div className="mt-3 rounded-md border border-slate-100 bg-slate-50">
        <button
          type="button"
          onClick={onToggleAudit}
          className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs font-semibold text-slate-600"
          aria-expanded={auditOpen}
        >
          <span>Audit Trail · {auditEntries.length} Einträge</span>
          <ChevronRight size={14} className={`text-slate-400 transition-transform ${auditOpen ? "rotate-90" : ""}`} />
        </button>
        {auditOpen && (
          <div className="grid gap-2 border-t border-slate-200 p-3">
            {auditEntries.length ? auditEntries.map((entry) => {
              const actor = profiles.find((profile) => profile.id === entry.actorProfileId)?.name || entry.actorProfileId || "System";
              const changes = auditChanges(entry, profiles);
              return (
                <div key={entry.id} className="rounded-md border border-slate-200 bg-white p-3 text-xs leading-5 text-slate-600">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-slate-900">{auditActionLabel(entry.action)}</span>
                    <span>{actor} · {formatDate(entry.createdAt)}</span>
                  </div>
                  {changes.length ? (
                    <div className="mt-2 overflow-x-auto">
                      <table className="w-full min-w-[520px] border-separate border-spacing-0 text-left">
                        <thead className="text-slate-500">
                          <tr>
                            <th className="border-b border-slate-100 py-1 pr-3 font-semibold">Feld</th>
                            <th className="border-b border-slate-100 px-3 py-1 font-semibold">Vorher</th>
                            <th className="border-b border-slate-100 py-1 pl-3 font-semibold">Nachher</th>
                          </tr>
                        </thead>
                        <tbody>
                          {changes.map((change) => (
                            <tr key={change.field}>
                              <td className="border-b border-slate-50 py-1 pr-3 font-semibold text-slate-700">{change.label}</td>
                              <td className="max-w-[260px] border-b border-slate-50 px-3 py-1 text-slate-500">{change.before}</td>
                              <td className="max-w-[260px] border-b border-slate-50 py-1 pl-3 text-slate-900">{change.after}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                  ) : (
                    <div className="mt-2 text-slate-500">Keine Feldänderung im Audit-Datensatz gespeichert.</div>
                  )}
                </div>
              );
            }) : <div className="text-xs text-slate-500">Noch kein Audit-Eintrag geladen.</div>}
          </div>
        )}
      </div>
    </>
  );
}
