"use client";

import { useEffect, useState } from "react";
import { X } from "lucide-react";
import type { AdministrationProfile, PersonAdministrationPatch } from "@/features/administration/model/administration-read-model";
import { UiButton, UiField, UiTextInput, UiNotice } from "@/shared/atoms/ui-primitives";
import { ToggleSwitch } from "@/shared/atoms/toggle-switch";

function formatSignIn(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function PersonAccessDetailPanel({ busy, person, showTechnicalIdentity, onClose, onSave, planningState }: {
  busy: boolean;
  person: AdministrationProfile;
  showTechnicalIdentity: boolean;
  planningState?: import("@/features/planning/model/planning-state").PlanningState;
  onClose: () => void;
  onSave: (patch: PersonAdministrationPatch) => Promise<void>;
}) {
  const [opening] = useState(person);
  const [editor] = useState(() => planningState?.resumeAdministrationPersonEdit(person.id) || planningState?.beginAdministrationPersonEdit(opening));
  useEffect(() => () => editor?.close(), [editor]);
  const result = editor?.view();
  busy = busy || Boolean(result && ["saving", "unconfirmed", "conflict", "blocked", "ended"].includes(result.phase));
  const original = { githubLogin: opening.githubLogin, googleChatUserId: opening.googleChatUserId, googleChatDmSpace: opening.googleChatDmSpace, eligible: opening.administratorAccess.eligible };
  const [draft, setDraft] = useState(() => result?.submitted ? { ...result.submitted.technicalIdentity, eligible: result.submitted.eligible } : original);
  const accepted = result?.phase === "saved" && result.submitted ? { ...result.submitted.technicalIdentity, eligible: result.submitted.eligible } : original;
  const dirty = draft.githubLogin !== accepted.githubLogin
    || draft.googleChatUserId !== accepted.googleChatUserId
    || draft.googleChatDmSpace !== accepted.googleChatDmSpace
    || draft.eligible !== accepted.eligible;
  return (
    <aside className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-full bg-blue-50 font-semibold text-blue-700">{person.name.slice(0, 1).toUpperCase()}</span><div><h2 className="font-semibold text-slate-950">{person.name}</h2><p className="text-sm text-slate-500">{person.orgRole || person.platformRole}</p></div></div><UiButton variant="ghost" size="iconMd" onClick={onClose} aria-label="Detailansicht schließen"><X size={18} aria-hidden="true" /></UiButton></div>
      <div className="grid gap-5 p-5">
        {result && result.phase !== "editing" && <UiNotice tone={result.phase === "saved" ? "success" : "warning"} role="status">
          {result.technical.phase !== "not-needed" && <p>{result.technical.phase === "confirmed" ? "Kontozuordnungen gespeichert" : result.technical.phase === "rejected" ? "Kontozuordnungen nicht gespeichert" : "Speicherung der Kontozuordnungen unklar"}</p>}
          {result.eligibility.phase !== "not-needed" && <p>{result.eligibility.phase === "confirmed" ? "Adminberechtigung gespeichert" : result.eligibility.phase === "rejected" ? "Adminberechtigung nicht gespeichert" : "Speicherung der Adminberechtigung unklar"}</p>}
          {result.error && <p>{result.error}</p>}
          {result.readStatus === "unavailable" && <p>Die Ergebnisdaten konnten nicht nachgeladen werden.</p>}
          {result.phase === "conflict" && <div className="mt-2 flex flex-wrap gap-2"><UiButton className="min-h-11" onClick={() => { void editor?.refreshConflict(); }}>Änderungen vergleichen</UiButton><UiButton className="min-h-11" disabled={!result.canResave} onClick={() => { void editor?.resave({ eligible: draft.eligible, technicalIdentity: { githubLogin: draft.githubLogin, googleChatUserId: draft.googleChatUserId, googleChatDmSpace: draft.googleChatDmSpace } }); }}>Erneut speichern</UiButton></div>}
          {result.serverPerson && <div className="break-words"><p className="font-semibold">Aktueller Stand</p>{showTechnicalIdentity && <dl className="grid gap-1"><div><dt>GitHub-Login</dt><dd>{result.serverPerson.githubLogin || "Nicht hinterlegt"}</dd></div><div><dt>Google-Chat-User-ID</dt><dd>{result.serverPerson.googleChatUserId || "Nicht hinterlegt"}</dd></div><div><dt>DM-Space</dt><dd>{result.serverPerson.googleChatDmSpace || "Nicht hinterlegt"}</dd></div></dl>}<p>Admin-Zugang {result.serverPerson.administratorAccess.eligible ? "berechtigt" : "nicht berechtigt"}</p></div>}
          {["unconfirmed", "partial", "blocked"].includes(result.phase) && <UiButton className="mt-2 min-h-11" onClick={() => { void editor?.checkOutcome(); }}>Aktuellen Stand prüfen</UiButton>}
        </UiNotice>}
        {showTechnicalIdentity && <section className="grid gap-3"><div><h3 className="font-semibold text-slate-950">Zugangsdaten</h3><p className="mt-1 text-sm text-slate-500">Technische Zuordnungen für Integrationen und Benachrichtigungen.</p></div><UiField>GitHub-Login<UiTextInput value={draft.githubLogin} disabled={busy} onChange={(event) => setDraft((current) => ({ ...current, githubLogin: event.target.value }))} /></UiField>{person.githubConnection && <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2"><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">GitHub-Status</div><div className="mt-1 text-sm font-semibold text-slate-900">{person.githubConnection.status === "active" ? "Aktiv" : person.githubConnection.status === "prepared" ? "Vorbereitet" : "Unvollständig"}</div><p className="mt-1 text-xs leading-5 text-slate-600">{person.githubConnection.description}</p>{person.githubConnection.lastSignInAt && <p className="mt-1 text-xs text-slate-500">Zuletzt angemeldet am {formatSignIn(person.githubConnection.lastSignInAt)}</p>}</div>}<UiField>Google-Chat-User-ID<UiTextInput value={draft.googleChatUserId} disabled={busy} onChange={(event) => setDraft((current) => ({ ...current, googleChatUserId: event.target.value }))} /></UiField><UiField>DM-Space<UiTextInput value={draft.googleChatDmSpace} disabled={busy} onChange={(event) => setDraft((current) => ({ ...current, googleChatDmSpace: event.target.value }))} /></UiField></section>}
        <section className="border-t border-slate-100 pt-5"><h3 className="font-semibold text-slate-950">Admin-Zugang</h3><p className="mt-1 text-sm text-slate-500">Ermöglicht den selbst aktivierten 60-Minuten-Zugang.</p><label className="mt-3 flex items-center gap-3 text-sm font-semibold"><ToggleSwitch checked={draft.eligible} disabled={busy} label={draft.eligible ? "Admin-Zugang berechtigt" : "Kein Admin-Zugang"} onChange={(eligible) => setDraft((current) => ({ ...current, eligible }))} />{draft.eligible ? "Admin-Zugang berechtigt" : "Kein Admin-Zugang"}</label>{person.administratorAccess.active && person.administratorAccess.expiresAt && <p className="mt-2 text-xs font-semibold text-emerald-700">Aktiv bis {new Date(person.administratorAccess.expiresAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}</p>}</section>
        <div className="grid grid-cols-2 gap-3 border-t border-slate-100 pt-5"><UiButton onClick={() => setDraft(original)} disabled={busy || !dirty}>Abbrechen</UiButton><UiButton variant="primary" disabled={busy || !dirty} onClick={() => void (editor ? editor.save({ eligible: draft.eligible, technicalIdentity: { githubLogin: draft.githubLogin, googleChatUserId: draft.googleChatUserId, googleChatDmSpace: draft.googleChatDmSpace } }) : onSave({ eligible: draft.eligible, technicalIdentity: { githubLogin: draft.githubLogin, googleChatUserId: draft.googleChatUserId, googleChatDmSpace: draft.googleChatDmSpace } })).catch(() => undefined)}>Speichern</UiButton></div>
      </div>
    </aside>
  );
}
