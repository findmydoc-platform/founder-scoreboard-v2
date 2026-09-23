import { Pencil } from "lucide-react";
import type { AdministrationProfile } from "@/features/administration/model/administration-read-model";
import { ConnectionStatusIndicator } from "@/features/administration/molecules/connection-status-indicator";
import { DataCell, DataRow } from "@/shared/molecules/data-surface";
import { UiButton } from "@/shared/atoms/ui-primitives";

function githubConnectionDescription(person: AdministrationProfile) {
  const connection = person.githubConnection;
  if (!connection) return "GitHub-Status ist nicht verfügbar.";
  const login = person.githubLogin ? `GitHub-Login: ${person.githubLogin}.` : "GitHub-Login fehlt.";
  if (!connection.lastSignInAt) return `${login} ${connection.description}`;
  const date = new Date(connection.lastSignInAt);
  const lastSignIn = Number.isNaN(date.getTime())
    ? connection.lastSignInAt
    : new Intl.DateTimeFormat("de-DE", { dateStyle: "medium", timeStyle: "short" }).format(date);
  return `${login} ${connection.description} Zuletzt angemeldet am ${lastSignIn}.`;
}

export function AdministratorAccessRow({
  person,
  selected,
  showTechnicalIdentity,
  onSelect,
}: {
  person: AdministrationProfile;
  selected: boolean;
  showTechnicalIdentity: boolean;
  onSelect: () => void;
}) {
  return (
    <DataRow className={selected ? "bg-blue-50" : undefined}>
      <DataCell className={selected ? "bg-blue-50" : undefined}><div className="flex min-w-0 items-center gap-3"><span className={`grid h-9 w-9 shrink-0 place-items-center rounded-full border text-sm font-semibold ${selected ? "border-blue-300 bg-white text-blue-700" : "border-slate-200 bg-slate-100 text-slate-600"}`}>{person.name.slice(0, 1).toUpperCase()}</span><div className="flex min-w-0 items-center gap-1"><button type="button" onClick={onSelect} className="truncate rounded-sm font-semibold text-slate-950 hover:text-blue-700 focus:outline-none focus:ring-2 focus:ring-blue-100">{person.name}</button><UiButton variant="ghost" size="iconXs" onClick={onSelect} aria-label={`${person.name} bearbeiten`} title={`${person.name} bearbeiten`}><Pencil size={14} /></UiButton></div></div></DataCell>
      <DataCell className={`text-sm text-slate-600 ${selected ? "bg-blue-50" : ""}`}>{person.orgRole || person.platformRole}</DataCell>
      {showTechnicalIdentity && <DataCell className={selected ? "bg-blue-50" : undefined}>{person.githubConnection && <ConnectionStatusIndicator status={person.githubConnection.status} label={`GitHub-Status für ${person.name}: ${person.githubConnection.status === "active" ? "Aktiv" : person.githubConnection.status === "prepared" ? "Vorbereitet" : "Unvollständig"}`} description={githubConnectionDescription(person)} />}</DataCell>}
      {showTechnicalIdentity && <DataCell className={selected ? "bg-blue-50" : undefined}><ConnectionStatusIndicator status={person.googleChatReady ? "ready" : "incomplete"} label={`Google-Chat-Status für ${person.name}: ${person.googleChatReady ? "Aktiv" : "Unvollständig"}`} description={person.googleChatReady ? "Google Chat ist vollständig konfiguriert." : "Google-Chat-Zuordnung oder DM-Space fehlt."} /></DataCell>}
      <DataCell className={`text-sm ${selected ? "bg-blue-50" : ""}`}>
        <span className="inline-flex items-center gap-2 whitespace-nowrap font-medium text-slate-700">
          <span className={`h-2 w-2 rounded-full ${person.administratorAccess.eligible ? "bg-blue-600" : "bg-slate-300"}`} />
          {person.administratorAccess.eligible ? "Berechtigt" : "Nicht berechtigt"}
        </span>
        {person.administratorAccess.active && person.administratorAccess.expiresAt && <span className="mt-0.5 block text-xs text-emerald-700">Aktiv bis {new Date(person.administratorAccess.expiresAt).toLocaleTimeString("de-DE", { hour: "2-digit", minute: "2-digit" })}</span>}
      </DataCell>
    </DataRow>
  );
}
