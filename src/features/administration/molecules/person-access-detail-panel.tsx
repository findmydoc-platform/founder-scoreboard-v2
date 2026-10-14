"use client";

import { useState } from "react";
import { X } from "lucide-react";
import type { AdministrationProfile, PersonAdministrationPatch } from "@/features/administration/model/administration-read-model";
import { UiButton, UiField, UiTextInput } from "@/shared/atoms/ui-primitives";
import { ToggleSwitch } from "@/shared/atoms/toggle-switch";

function formatSignIn(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

export function PersonAccessDetailPanel({ busy, person, showTechnicalIdentity, onClose, onSave }: {
  busy: boolean;
  person: AdministrationProfile;
  showTechnicalIdentity: boolean;
  onClose: () => void;
  onSave: (patch: PersonAdministrationPatch) => Promise<void>;
}) {
  const original = { githubLogin: person.githubLogin, googleChatUserId: person.googleChatUserId, googleChatDmSpace: person.googleChatDmSpace, eligible: person.administratorAccess.eligible };
  const [draft, setDraft] = useState(original);
  const dirty = draft.githubLogin !== original.githubLogin
    || draft.googleChatUserId !== original.googleChatUserId
    || draft.googleChatDmSpace !== original.googleChatDmSpace
    || draft.eligible !== original.eligible;
  return (
    <aside className="overflow-hidden rounded-lg border border-slate-200 bg-white shadow-sm">
      <div className="flex items-start justify-between border-b border-slate-100 px-5 py-4"><div className="flex items-center gap-3"><span className="grid h-10 w-10 place-items-center rounded-full bg-blue-50 font-semibold text-blue-700">{person.name.slice(0, 1).toUpperCase()}</span><div><h2 className="font-semibold text-slate-950">{person.name}</h2><p className="text-sm text-slate-500">{person.orgRole || person.platformRole}</p></div></div><UiButton variant="ghost" size="iconMd" onClick={onClose} aria-label="Detailansicht schließen"><X size={18} aria-hidden="true" /></UiButton></div>
      <div className="grid gap-5 p-5">
        {showTechnicalIdentity && <section className="grid gap-3"><div><h3 className="font-semibold text-slate-950">Zugangsdaten</h3><p className="mt-1 text-sm text-slate-500">Technische Zuordnungen für Integrationen und Benachrichtigungen.</p></div><UiField>GitHub-Login<UiTextInput value={draft.githubLogin} disabled={busy} onChange={(event) => setDraft((current) => ({ ...current, githubLogin: event.target.value }))} /></UiField>{person.githubConnection && <div className="rounded-md border border-slate-200 bg-slate-50 px-3 py-2"><div className="text-xs font-semibold uppercase tracking-wide text-slate-500">GitHub-Status</div><div className="mt-1 text-sm font-semibold text-slate-900">{person.githubConnection.status === "active" ? "Aktiv" : person.githubConnection.status === "prepared" ? "Vorbereitet" : "Unvollständig"}</div><p className="mt-1 text-xs leading-5 text-slate-600">{person.githubConnection.description}</p>{person.githubConnection.lastSignInAt && <p className="mt-1 text-xs text-slate-500">Zuletzt angemeldet am {formatSignIn(person.githubConnection.lastSignInAt)}</p>}</div>}<UiField>Google-Chat-User-ID<UiTextInput value={draft.googleChatUserId} disabled={busy} onChange={(event) => setDraft((current) => ({ ...current, googleChatUserId: event.target.value }))} /></UiField><UiField>DM-Space<UiTextInput value={draft.googleChatDmSpace} disabled={busy} onChange={(event) => setDraft((current) => ({ ...current, googleChatDmSpace: event.target.value }))} /></UiField></section>}
        <section className="border-t border-slate-100 pt-5"><h3 className="font-semibold text-slate-950">Admin-Zugang</h3><p className="mt-1 text-sm text-slate-500">Ermöglicht den selbst aktivierten 60-Minuten-Zugang.</p><label className="mt-3 flex items-center gap-3 text-sm font-semibold"><ToggleSwitch checked={draft.eligible} disabled={busy} label={draft.eligible ? "Admin-Zugang berechtigt" : "Kein Admin-Zugang"} onChange={(eligible) => setDraft((current) => ({ ...current, eligible }))} />{draft.eligible ? "Admin-Zugang berechtigt" : "Kein Admin-Zugang"}</label>{person.administratorAccess.active && person.administratorAccess.expiresAt && <p className="mt-2 text-xs font-semibold text-emerald-700">Aktiv bis {new Date(person.administratorAccess.expiresAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}</p>}</section>
        <div className="grid grid-cols-2 gap-3 border-t border-slate-100 pt-5"><UiButton onClick={() => setDraft(original)} disabled={busy || !dirty}>Abbrechen</UiButton><UiButton variant="primary" disabled={busy || !dirty} onClick={() => void onSave({ eligible: draft.eligible, technicalIdentity: { githubLogin: draft.githubLogin, googleChatUserId: draft.googleChatUserId, googleChatDmSpace: draft.googleChatDmSpace } }).catch(() => undefined)}>Speichern</UiButton></div>
      </div>
    </aside>
  );
}
