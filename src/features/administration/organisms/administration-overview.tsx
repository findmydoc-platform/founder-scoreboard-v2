import { AlertCircle, CheckCircle2, RefreshCw } from "lucide-react";
import type { AdministrationWorkspaceModel } from "@/features/administration/model/administration-read-model";
import type { AdministrationTab } from "@/features/administration/templates/administration-workspace-template";
import { UiButton, UiEmptyState, UiPanel } from "@/shared/atoms/ui-primitives";
import { formatDate } from "@/lib/display";

export function AdministrationOverview({ model, onNavigate, onRefresh }: { model: AdministrationWorkspaceModel; onNavigate: (tab: AdministrationTab) => void; onRefresh: () => void }) {
  const failedDelivery = model.notificationDeliveries.find((delivery) => delivery.status === "failed");
  const failedEvent = failedDelivery ? model.notificationEvents.find((event) => event.id === failedDelivery.eventId) : null;
  const incompleteGitHubProfile = model.people.find((person) => person.githubConnection?.status === "incomplete");
  const projectIncomplete = !model.githubProject?.owner || !model.githubProject.number;
  const mentionTeamFallback = model.integrationStatus.mentionTeam.state === "fallback";
  const attention = [
    ...(failedDelivery ? [{ id: `delivery-${failedDelivery.id}`, tone: "red" as const, title: failedEvent?.title || "Google-Chat-Zustellung fehlgeschlagen", area: "Benachrichtigungen", detail: failedDelivery.lastError || "Die letzte Zustellung konnte nicht abgeschlossen werden.", date: failedDelivery.createdAt, action: "Prüfen", tab: "integrations" as const }] : []),
    ...(incompleteGitHubProfile ? [{ id: `profile-${incompleteGitHubProfile.id}`, tone: "amber" as const, title: "GitHub-Verbindung unvollständig", area: "Personen & Zugänge", detail: `${incompleteGitHubProfile.name}: ${incompleteGitHubProfile.githubConnection?.description || "Die GitHub-Verbindung ist unvollständig."}`, date: model.revision, action: "Prüfen", tab: "people" as const }] : []),
    ...(projectIncomplete ? [{ id: "github-project", tone: "amber" as const, title: "GitHub Project Validierung erforderlich", area: "Integrationen", detail: "Organisation und Project-Nummer müssen geprüft werden.", date: model.revision, action: "Prüfen", tab: "integrations" as const }] : []),
    ...(!projectIncomplete && mentionTeamFallback ? [{ id: "github-mention-team", tone: "amber" as const, title: "GitHub-Team für @all prüfen", area: "Integrationen", detail: `Bis zur erfolgreichen Teamprüfung erwähnt FounderOps verknüpfte GitHub-Logins einzeln. ${model.integrationStatus.mentionTeam.profilesWithoutGitHubLogin} Profile haben keinen GitHub-Login.`, date: model.revision, action: "Prüfen", tab: "integrations" as const }] : []),
  ];
  const systemStatus = [
    { label: "GitHub Project", detail: "Repository-Zugriff", healthy: !projectIncomplete, state: projectIncomplete ? "Prüfen" : "Konfiguriert" },
    { label: "GitHub @all", detail: model.integrationStatus.mentionTeam.githubHandle || "Einzelne GitHub-Logins", healthy: !mentionTeamFallback, state: mentionTeamFallback ? "Fallback" : "Bereit" },
    { label: "Google Chat", detail: "Benachrichtigungen", healthy: model.integrationStatus.googleChat.ready, state: model.integrationStatus.googleChat.ready ? "Bereit" : "Prüfen" },
    { label: "Zustellung", detail: `${model.integrationStatus.pendingDeliveries} ausstehend`, healthy: model.integrationStatus.failedDeliveries === 0, state: model.integrationStatus.failedDeliveries ? `${model.integrationStatus.failedDeliveries} fehlgeschlagen` : "Unauffällig" },
  ];
  return (
    <div className="grid gap-4 xl:grid-cols-[minmax(0,1fr)_22rem]">
      <UiPanel padding="none" className="min-w-0 overflow-hidden">
        <div className="flex flex-wrap items-start justify-between gap-3 px-5 py-5"><div><h2 className="text-xl font-semibold text-slate-950">Aufmerksamkeit erforderlich</h2><p className="mt-1 text-sm text-slate-500">{attention.length ? `${attention.length} Themen benötigen deine Aufmerksamkeit.` : "Aktuell gibt es keine offenen technischen Hinweise."}</p></div><div className="flex items-center gap-2 text-xs text-slate-500"><span>Stand: {formatDate(model.revision || new Date().toISOString(), { includeYear: true })}</span><UiButton aria-label="Administrationsdaten aktualisieren" onClick={onRefresh}><RefreshCw size={15} /></UiButton></div></div>
        {attention.length ? <div className="overflow-x-auto px-5 pb-5"><table className="w-full min-w-[640px] border-collapse text-left"><thead className="border-b border-slate-200 text-xs font-semibold uppercase tracking-wide text-slate-500"><tr><th className="py-3 pr-4">Thema</th><th className="px-4 py-3">Details</th><th className="px-4 py-3">Zeitpunkt</th><th className="px-4 py-3">Aktion</th></tr></thead><tbody>{attention.map((item) => <tr key={item.id} className="border-b border-slate-100 last:border-b-0"><td className="py-4 pr-4"><div className="flex items-start gap-3"><span className={`mt-0.5 grid h-6 w-6 shrink-0 place-items-center rounded-full text-white ${item.tone === "red" ? "bg-red-500" : "bg-amber-500"}`}><AlertCircle size={14} /></span><div><div className="font-semibold text-slate-950">{item.title}</div><div className="mt-1 text-xs text-slate-500">{item.area}</div></div></div></td><td className="px-4 py-4 text-sm leading-5 text-slate-600">{item.detail}</td><td className="px-4 py-4 text-sm text-slate-600">{formatDate(item.date || new Date().toISOString(), { includeYear: true })}</td><td className="px-4 py-4"><UiButton onClick={() => onNavigate(item.tab)}>{item.action}</UiButton></td></tr>)}</tbody></table></div> : <div className="p-5 pt-0"><UiEmptyState minHeight="sm"><CheckCircle2 className="mx-auto mb-2 text-emerald-600" />Alle technischen Systeme sind unauffällig.</UiEmptyState></div>}
      </UiPanel>
      <div className="grid content-start gap-4">
        <UiPanel><h2 className="text-lg font-semibold text-slate-950">Systemstatus</h2><p className="mt-1 text-sm text-slate-500">Wichtige Integrationen und Dienste.</p><div className="mt-4 grid gap-3">{systemStatus.map((item) => <div key={item.label} className="flex items-center gap-3 rounded-md border border-slate-200 px-3 py-3"><span className={`h-3 w-3 rounded-full ${item.healthy ? "bg-emerald-500" : "bg-amber-500"}`} /><div className="min-w-0 flex-1"><div className="font-semibold text-slate-950">{item.label}</div><div className="text-xs text-slate-500">{item.detail}</div></div><div className={`text-right text-sm font-semibold ${item.healthy ? "text-emerald-700" : "text-amber-700"}`}>{item.state}</div></div>)}</div></UiPanel>
      </div>
    </div>
  );
}
