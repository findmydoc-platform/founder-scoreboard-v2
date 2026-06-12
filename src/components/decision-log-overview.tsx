"use client";

import { ChevronRight, X } from "lucide-react";
import { useState } from "react";
import { formatDate, taskOwnerLabel } from "@/lib/display";
import { normalizeStatus } from "@/lib/status";
import type { DecisionTaskLink, PlanningData, Profile } from "@/lib/types";

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

function auditChanges(entry: PlanningData["audit"][number], profiles: Profile[]) {
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

function decisionStatusLabel(status: "draft" | "open_for_confirmation" | "locked") {
  if (status === "locked") return "Gelockt";
  if (status === "open_for_confirmation") return "Zur Bestätigung offen";
  return "Entwurf";
}

export function DecisionLogOverview({
  data,
  currentProfileId,
  pending,
  onCreate,
  onConfirm,
  onEdit,
  onObject,
  onRemoveDecisionTaskLink,
  onCreateFollowUp,
}: {
  data: PlanningData;
  currentProfileId: string;
  pending: boolean;
  onCreate: (payload: { title: string; context: string; decision: string; requiredProfileIds: string[] }) => void;
  onConfirm: (decisionId: number) => void;
  onEdit: (decisionId: number, payload: { title: string; context: string; decision: string; requiredProfileIds: string[] }) => void;
  onObject: (decisionId: number, comment: string) => void;
  onRemoveDecisionTaskLink: (link: DecisionTaskLink) => void;
  onCreateFollowUp: (decision: PlanningData["decisions"][number]) => void;
}) {
  const [title, setTitle] = useState("");
  const [context, setContext] = useState("");
  const [decisionText, setDecisionText] = useState("");
  const [requiredProfileIds, setRequiredProfileIds] = useState<string[]>(() => data.profiles.map((profile) => profile.id));
  const [editingId, setEditingId] = useState<number | null>(null);
  const [editDraft, setEditDraft] = useState({ title: "", context: "", decision: "", requiredProfileIds: [] as string[] });
  const [objectionDrafts, setObjectionDrafts] = useState<Record<number, string>>({});
  const [openDecisions, setOpenDecisions] = useState<Record<number, boolean>>({});
  const [openAudits, setOpenAudits] = useState<Record<number, boolean>>({});
  const currentProfile = data.profiles.find((profile) => profile.id === currentProfileId);
  const canCreate = currentProfile?.platformRole === "ceo";

  const resetForm = () => {
    setTitle("");
    setContext("");
    setDecisionText("");
    setRequiredProfileIds(data.profiles.map((profile) => profile.id));
  };

  const startEdit = (item: PlanningData["decisions"][number]) => {
    setEditingId(item.id);
    setEditDraft({
      title: item.title,
      context: item.context,
      decision: item.decision,
      requiredProfileIds: item.requiredProfileIds,
    });
  };

  return (
    <div className="grid gap-4">
      <section className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex items-center justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-950">Decision Log</h2>
            <p className="mt-1 text-sm text-slate-500">CEO-only Edit, Founder-Bestätigung und Locking nach vollständiger Zustimmung.</p>
          </div>
          <span className="rounded-full border border-slate-200 px-3 py-1 text-xs font-semibold text-slate-600">{data.decisions.length} Decisions</span>
        </div>
      </section>
      <section id="decision-create" className="scroll-mt-24 rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div>
            <h2 className="text-base font-semibold text-slate-950">Neue Decision</h2>
            <p className="mt-1 text-sm text-slate-500">Nur CEO kann Einträge erstellen. Nach Bestätigung aller ausgewählten Personen wird automatisch gelockt.</p>
          </div>
          <span className={`rounded-full border px-3 py-1 text-xs font-semibold ${canCreate ? "border-blue-200 bg-blue-50 text-blue-700" : "border-slate-200 bg-slate-50 text-slate-500"}`}>
            {canCreate ? "CEO-Rechte aktiv" : "Read/Confirm"}
          </span>
        </div>
        <form
          className="mt-4 grid gap-3"
          onSubmit={(event) => {
            event.preventDefault();
            if (!canCreate || pending) return;
            onCreate({ title, context, decision: decisionText, requiredProfileIds });
            resetForm();
          }}
        >
          <div className="grid gap-3 lg:grid-cols-2">
            <label className="grid gap-1 text-xs font-semibold text-slate-500">
              Titel
              <input
                value={title}
                disabled={!canCreate || pending}
                onChange={(event) => setTitle(event.target.value)}
                className="h-10 rounded-md border border-slate-200 px-3 text-sm font-normal text-slate-900 disabled:bg-slate-50 disabled:opacity-70"
                placeholder="z. B. Malta-Struktur für Sprint 1 freigeben"
              />
            </label>
            <fieldset className="grid gap-2 text-xs font-semibold text-slate-500">
              Bestätigung erforderlich von
              <div className="flex flex-wrap gap-2">
                {data.profiles.map((profile) => {
                  const checked = requiredProfileIds.includes(profile.id);
                  return (
                    <label key={profile.id} className="inline-flex items-center gap-2 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-700">
                      <input
                        type="checkbox"
                        checked={checked}
                        disabled={!canCreate || pending}
                        onChange={(event) => {
                          setRequiredProfileIds((current) =>
                            event.target.checked ? [...current, profile.id] : current.filter((id) => id !== profile.id),
                          );
                        }}
                      />
                      {profile.name}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          </div>
          <label className="grid gap-1 text-xs font-semibold text-slate-500">
            Kontext
            <textarea
              value={context}
              disabled={!canCreate || pending}
              onChange={(event) => setContext(event.target.value)}
              className="min-h-20 resize-y rounded-md border border-slate-200 px-3 py-2 text-sm font-normal leading-6 text-slate-900 disabled:bg-slate-50 disabled:opacity-70"
              placeholder="Warum steht diese Entscheidung jetzt an?"
            />
          </label>
          <label className="grid gap-1 text-xs font-semibold text-slate-500">
            Entscheidung
            <textarea
              value={decisionText}
              disabled={!canCreate || pending}
              onChange={(event) => setDecisionText(event.target.value)}
              className="min-h-24 resize-y rounded-md border border-slate-200 px-3 py-2 text-sm font-normal leading-6 text-slate-900 disabled:bg-slate-50 disabled:opacity-70"
              placeholder="Was wird konkret entschieden?"
            />
          </label>
          <div className="flex justify-end">
            <button
              type="submit"
              disabled={!canCreate || pending || !title.trim() || !decisionText.trim() || !requiredProfileIds.length}
              className="h-9 rounded-md bg-blue-600 px-4 text-sm font-semibold text-white disabled:cursor-not-allowed disabled:opacity-50"
            >
              Decision öffnen
            </button>
          </div>
        </form>
      </section>
      {data.decisions.length ? data.decisions.map((decision) => {
        const isEditing = editingId === decision.id;
        const isOpen = openDecisions[decision.id] ?? false;
        const auditOpen = openAudits[decision.id] ?? false;
        const comments = data.decisionComments.filter((comment) => comment.decisionId === decision.id);
        const auditEntries = data.audit
          .filter((entry) => entry.entityType === "decision" && entry.entityId === String(decision.id))
          .slice(0, 8);
        const objectionText = objectionDrafts[decision.id] || "";
        const linkedTasks = data.decisionTaskLinks
          .filter((link) => link.decisionId === decision.id)
          .map((link) => ({ link, task: data.tasks.find((task) => task.id === link.taskId) }))
          .filter((item) => item.task);

        return (
        <article key={decision.id} className="rounded-lg border border-slate-200 bg-white p-4 shadow-sm">
          <div className="flex flex-wrap items-start justify-between gap-3">
            <button
              type="button"
              onClick={() => setOpenDecisions((current) => ({ ...current, [decision.id]: !isOpen }))}
              className="flex min-w-0 flex-1 items-start gap-2 text-left"
              aria-expanded={isOpen}
            >
              <ChevronRight size={16} className={`mt-0.5 shrink-0 text-slate-400 transition-transform ${isOpen ? "rotate-90" : ""}`} />
              <span className="min-w-0">
                <span className="block truncate font-semibold text-slate-950">{decision.title}</span>
              <span className="mt-1 block text-xs text-slate-500">
                  {decision.confirmedProfileIds.length}/{decision.requiredProfileIds.length} bestätigt · {linkedTasks.length} Folgeaufgaben · {auditEntries.length} Audit-Einträge
                </span>
              </span>
            </button>
            <div className="flex flex-wrap items-center gap-2">
              <span className="rounded-full border border-blue-200 bg-blue-50 px-2 py-1 text-xs font-semibold text-blue-700">{decisionStatusLabel(decision.status)}</span>
              <button
                type="button"
                onClick={() => onCreateFollowUp(decision)}
                className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700"
              >
                Folgeaufgabe
              </button>
              {canCreate && decision.status !== "locked" && (
                <button
                  type="button"
                  onClick={() => {
                    setOpenDecisions((current) => ({ ...current, [decision.id]: true }));
                    if (isEditing) setEditingId(null);
                    else startEdit(decision);
                  }}
                  className="h-8 rounded-md border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-700"
                >
                  {isEditing ? "Schließen" : "Editieren"}
                </button>
              )}
            </div>
          </div>
          {isOpen && (
            <>
          <p className="mt-3 text-sm leading-6 text-slate-600">{decision.context || "Kein Kontext hinterlegt."}</p>
          <div className="mt-3 text-sm text-slate-700">{decision.decision || "Noch keine finale Entscheidung."}</div>
          <div className="mt-4 rounded-md border border-slate-100 bg-slate-50 p-3">
            <div className="flex items-center justify-between gap-3">
              <h3 className="text-xs font-semibold text-slate-500">Folgeaufgaben</h3>
              <span className="rounded-full bg-white px-2 py-0.5 text-[11px] font-semibold text-slate-500">{linkedTasks.length}</span>
            </div>
            <div className="mt-2 grid gap-1.5">
              {linkedTasks.length ? linkedTasks.map(({ link, task }) => (
                <div key={link.id} className="flex items-start gap-2 rounded-md bg-white px-2 py-1.5 text-xs">
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold text-slate-800">{task?.title}</div>
                    <div className="mt-0.5 text-slate-500">{task ? `${normalizeStatus(task.status)} · ${taskOwnerLabel(task)}` : "Aufgabe nicht gefunden"} · {link.note || "Keine Notiz"}</div>
                  </div>
                  <button type="button" disabled={pending} onClick={() => onRemoveDecisionTaskLink(link)} className="grid h-6 w-6 shrink-0 place-items-center rounded-md border border-slate-200 text-slate-400 hover:border-red-200 hover:bg-red-50 hover:text-red-600 disabled:opacity-50" aria-label="Decision-Link entfernen">
                    <X size={12} />
                  </button>
                </div>
              )) : (
                <div className="text-xs text-slate-500">Noch keine Folgeaufgabe verknüpft.</div>
              )}
            </div>
          </div>
          {isEditing && (
            <form
              className="mt-4 grid gap-3 rounded-lg border border-blue-100 bg-blue-50/40 p-3"
              onSubmit={(event) => {
                event.preventDefault();
                onEdit(decision.id, editDraft);
                setEditingId(null);
              }}
            >
              <div className="grid gap-3 lg:grid-cols-2">
                <label className="grid gap-1 text-xs font-semibold text-slate-500">
                  Titel
                  <input value={editDraft.title} disabled={pending} onChange={(event) => setEditDraft((current) => ({ ...current, title: event.target.value }))} className="h-9 rounded-md border border-slate-200 px-2 text-sm font-normal text-slate-900" />
                </label>
                <fieldset className="grid gap-2 text-xs font-semibold text-slate-500">
                  Neue Bestätigung erforderlich von
                  <div className="flex flex-wrap gap-2">
                    {data.profiles.map((profile) => (
                      <label key={profile.id} className="inline-flex items-center gap-2 rounded-md border border-slate-200 bg-white px-2 py-1 text-xs font-medium text-slate-700">
                        <input
                          type="checkbox"
                          checked={editDraft.requiredProfileIds.includes(profile.id)}
                          disabled={pending}
                          onChange={(event) => setEditDraft((current) => ({
                            ...current,
                            requiredProfileIds: event.target.checked
                              ? [...current.requiredProfileIds, profile.id]
                              : current.requiredProfileIds.filter((id) => id !== profile.id),
                          }))}
                        />
                        {profile.name}
                      </label>
                    ))}
                  </div>
                </fieldset>
              </div>
              <label className="grid gap-1 text-xs font-semibold text-slate-500">
                Kontext
                <textarea value={editDraft.context} disabled={pending} onChange={(event) => setEditDraft((current) => ({ ...current, context: event.target.value }))} className="min-h-16 rounded-md border border-slate-200 px-2 py-2 text-sm font-normal text-slate-900" />
              </label>
              <label className="grid gap-1 text-xs font-semibold text-slate-500">
                Entscheidung
                <textarea value={editDraft.decision} disabled={pending} onChange={(event) => setEditDraft((current) => ({ ...current, decision: event.target.value }))} className="min-h-20 rounded-md border border-slate-200 px-2 py-2 text-sm font-normal text-slate-900" />
              </label>
              <div className="flex justify-end">
                <button type="submit" disabled={pending || !editDraft.title.trim() || !editDraft.decision.trim() || !editDraft.requiredProfileIds.length} className="h-9 rounded-md bg-blue-600 px-3 text-sm font-semibold text-white disabled:opacity-50">
                  Änderung speichern
                </button>
              </div>
              <p className="text-xs leading-5 text-slate-500">Speichern setzt vorhandene Bestätigungen zurück und schreibt vorher/nachher ins Audit.</p>
            </form>
          )}
          <div className="mt-4 flex flex-wrap items-center justify-between gap-3 border-t border-slate-100 pt-3">
            <div className="flex flex-wrap gap-2 text-xs text-slate-600">
              {decision.requiredProfileIds.map((profileId) => {
                const profile = data.profiles.find((item) => item.id === profileId);
                const confirmed = decision.confirmedProfileIds.includes(profileId);
                return (
                  <span key={profileId} className={`rounded-full border px-2 py-1 font-semibold ${confirmed ? "border-emerald-200 bg-emerald-50 text-emerald-700" : "border-slate-200 bg-slate-50 text-slate-500"}`}>
                    {profile?.name || profileId}: {confirmed ? "bestätigt" : "offen"}
                  </span>
                );
              })}
            </div>
            <button
              type="button"
              disabled={pending || decision.status === "locked" || !currentProfileId || decision.confirmedProfileIds.includes(currentProfileId)}
              onClick={() => onConfirm(decision.id)}
              className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 disabled:cursor-not-allowed disabled:opacity-50"
            >
              {decision.confirmedProfileIds.includes(currentProfileId) ? "Bestätigt" : "Bestätigen"}
            </button>
          </div>
          {decision.status !== "locked" && currentProfileId && (
            <form
              className="mt-3 grid gap-2 rounded-md border border-slate-100 bg-white p-3"
              onSubmit={(event) => {
                event.preventDefault();
                onObject(decision.id, objectionText);
                setObjectionDrafts((current) => ({ ...current, [decision.id]: "" }));
              }}
            >
              <label className="grid gap-1 text-xs font-semibold text-slate-500">
                Einwand oder Änderungswunsch
                <textarea
                  value={objectionText}
                  disabled={pending}
                  onChange={(event) => setObjectionDrafts((current) => ({ ...current, [decision.id]: event.target.value }))}
                  className="min-h-16 rounded-md border border-slate-200 px-2 py-2 text-sm font-normal text-slate-900"
                  placeholder="Was ist an der Änderung nicht korrekt oder sollte angepasst werden?"
                />
              </label>
              <div className="flex justify-end">
                <button type="submit" disabled={pending || !objectionText.trim()} className="h-8 rounded-md border border-amber-200 bg-amber-50 px-3 text-xs font-semibold text-amber-700 disabled:opacity-50">
                  Einwand speichern
                </button>
              </div>
            </form>
          )}
          {comments.length > 0 && (
            <div className="mt-3 grid gap-2">
              {comments.map((comment) => {
                const actor = data.profiles.find((profile) => profile.id === comment.profileId)?.name || comment.profileId || "Unbekannt";
                return (
                  <div key={comment.id} className="rounded-md border border-amber-100 bg-amber-50/60 px-3 py-2 text-xs leading-5 text-amber-900">
                    <span className="font-semibold">{comment.type === "objection" ? "Einwand" : "Kommentar"} · {actor} · {formatDate(comment.createdAt)}:</span> {comment.comment}
                  </div>
                );
              })}
            </div>
          )}
          <div className="hidden">
            Audit: {data.audit.filter((entry) => entry.entityType === "decision" && entry.entityId === String(decision.id)).slice(0, 3).map((entry) => {
              const actor = data.profiles.find((profile) => profile.id === entry.actorProfileId)?.name || entry.actorProfileId || "System";
              return `${entry.action} · ${actor} · ${formatDate(entry.createdAt)}`;
            }).join(" / ") || "Noch kein Audit-Eintrag geladen."}
          </div>
          <div className="mt-3 rounded-md border border-slate-100 bg-slate-50">
            <button
              type="button"
              onClick={() => setOpenAudits((current) => ({ ...current, [decision.id]: !auditOpen }))}
              className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-xs font-semibold text-slate-600"
              aria-expanded={auditOpen}
            >
              <span>Audit Trail · {auditEntries.length} Einträge</span>
              <ChevronRight size={14} className={`text-slate-400 transition-transform ${auditOpen ? "rotate-90" : ""}`} />
            </button>
            {auditOpen && (
              <div className="grid gap-2 border-t border-slate-200 p-3">
                {auditEntries.length ? auditEntries.map((entry) => {
                  const actor = data.profiles.find((profile) => profile.id === entry.actorProfileId)?.name || entry.actorProfileId || "System";
                  const changes = auditChanges(entry, data.profiles);
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
          )}
        </article>
        );
      }) : (
        <section className="rounded-lg border border-dashed border-slate-300 bg-white p-8 text-center text-sm text-slate-500">
          Noch keine Decisions. Der erste Eintrag wird vom CEO erstellt und danach zur Bestätigung geöffnet.
        </section>
      )}
    </div>
  );
}
