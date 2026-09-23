"use client";

import Image from "next/image";
import { useState } from "react";
import { ChevronDown, MessageSquare, RefreshCw, Send } from "lucide-react";
import { DeliveryStatusRow } from "@/features/administration/molecules/delivery-status-row";
import type { AdministrationWorkspaceModel } from "@/features/administration/model/administration-read-model";
import { UiButton, UiEmptyState, UiField, UiPanel, UiTextInput } from "@/shared/atoms/ui-primitives";
import { UiSelectField } from "@/shared/atoms/form-controls";

export function IntegrationsDeliveryAdministration({ busy, model, onDeliver, onSaveGitHubProject }: {
  busy: boolean;
  model: AdministrationWorkspaceModel;
  onDeliver: (payload: Record<string, unknown>) => Promise<void>;
  onSaveGitHubProject: (owner: string, number: number) => Promise<void>;
}) {
  const [project, setProject] = useState({ owner: model.githubProject?.owner || "", number: model.githubProject?.number || 0 });
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [testProfileId, setTestProfileId] = useState(model.people.find((person) => person.googleChatReady)?.id || "");
  const latestByEvent = new Map(model.notificationDeliveries.map((delivery) => [delivery.eventId, delivery]));
  const githubAppStatus = model.integrationStatus.githubApp;
  const status = model.integrationStatus.googleChat;

  return (
    <div className="grid gap-4">
      <UiPanel padding="none" className="overflow-hidden">
        <div className="border-b border-slate-100 px-5 py-5">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex items-center gap-4">
              <span className="grid h-12 w-12 shrink-0 place-items-center rounded-full border border-slate-200 bg-slate-50">
                <Image src="/github-mark.svg" width={25} height={25} alt="" aria-hidden="true" />
              </span>
              <div>
                <h2 className="text-lg font-semibold text-slate-950">GitHub Project</h2>
                <p className="mt-1 text-sm text-slate-500">Repositoryübergreifend synchronisierte GitHub Issues. FounderOps bleibt führend.</p>
              </div>
            </div>
            {githubAppStatus && (
              <section aria-label="GitHub-App-Betriebsstatus" className="grid gap-1 sm:max-w-sm sm:text-right">
                <div className="flex items-center gap-2 sm:justify-end">
                  <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${githubAppStatus.available ? "bg-emerald-600" : "bg-red-600"}`} aria-hidden="true" />
                  <span className={`text-sm font-semibold ${githubAppStatus.available ? "text-emerald-700" : "text-red-700"}`}>
                    {githubAppStatus.available ? "Verfügbar" : "Nicht verfügbar"}
                  </span>
                </div>
                <p className="text-xs leading-5 text-slate-500">{githubAppStatus.description}</p>
                {githubAppStatus.nextStep && <p className="text-xs font-medium leading-5 text-red-700">{githubAppStatus.nextStep}</p>}
              </section>
            )}
          </div>
        </div>
        <div className="grid gap-4 px-5 py-5 md:grid-cols-[minmax(0,1fr)_minmax(10rem,0.7fr)_auto] md:items-end"><UiField>GitHub-Organisation<UiTextInput value={project.owner} disabled={busy} onChange={(event) => setProject((current) => ({ ...current, owner: event.target.value }))} /></UiField><UiField>Project-Nummer<UiTextInput type="number" min={1} value={project.number || ""} disabled={busy} onChange={(event) => setProject((current) => ({ ...current, number: Number(event.target.value) }))} /></UiField><UiButton variant="primary" disabled={busy || !project.owner || project.number < 1} onClick={() => void onSaveGitHubProject(project.owner, project.number)}><RefreshCw size={15} />Erneut prüfen</UiButton></div>
      </UiPanel>

      <UiPanel padding="none" className="overflow-hidden">
        <div className="border-b border-slate-100 px-5 py-5"><div className="flex items-center gap-4"><span className="grid h-12 w-12 place-items-center rounded-full border border-slate-200 bg-slate-50 text-emerald-600"><MessageSquare size={25} /></span><div><h2 className="text-lg font-semibold text-slate-950">Google Chat</h2><p className="mt-1 text-sm text-slate-500">Automatische Zustellung von Hinweisen und wichtigen Ereignissen an das Team.</p></div></div></div>
        <div className="grid gap-4 border-b border-slate-100 px-5 py-5 md:grid-cols-2"><div><div className="text-xs font-semibold text-slate-500">Zustellungsmodus</div><div className="mt-2 font-semibold text-slate-950">{status.mode === "direct-dm" ? "Persönliche Hinweise" : status.mode === "space-webhook" ? "Team-Digest" : "Nicht konfiguriert"}</div><p className={`mt-1 text-xs ${status.deliveryEnabled ? "text-slate-500" : "font-semibold text-amber-700"}`}>{status.deliveryEnabled ? "Direkte Nachrichten oder Webhook-Digest." : "Zustellung deaktiviert"}</p></div><div><div className="text-xs font-semibold text-slate-500">Warteschlange</div><div className="mt-2 font-semibold text-slate-950">{model.integrationStatus.pendingDeliveries} ausstehend</div><p className="mt-1 text-xs text-slate-500">{model.integrationStatus.failedDeliveries} fehlgeschlagen</p></div></div>
        <div className="px-5 pt-4"><h3 className="text-sm font-semibold text-slate-600">Letzte Zustellungen</h3></div>
        {model.notificationEvents.length ? model.notificationEvents.slice(0, 12).map((event) => <DeliveryStatusRow key={event.id} event={event} delivery={latestByEvent.get(event.id)} busy={busy} onRetry={() => void onDeliver({ eventIds: [event.id] })} />) : <div className="p-5"><UiEmptyState minHeight="sm">Keine Zustellereignisse vorhanden.</UiEmptyState></div>}
        <div className="border-t border-slate-100 px-5 py-4"><button type="button" aria-expanded={detailsOpen} onClick={() => setDetailsOpen((open) => !open)} className="flex min-h-11 w-full items-center gap-3 text-left"><span className="font-semibold text-blue-700">Technische Details</span><span className="min-w-0 flex-1 text-xs text-slate-500">Testzustellung und Diagnose</span><ChevronDown size={17} className={`transition ${detailsOpen ? "rotate-180" : ""}`} /></button>{detailsOpen && <div className="mt-4 grid gap-3 border-t border-slate-100 pt-4 md:grid-cols-[minmax(0,1fr)_auto_auto_auto] md:items-end"><UiSelectField label="Empfänger für Test-DM" value={testProfileId} onChange={setTestProfileId} options={[{ value: "", label: "Profil auswählen" }, ...model.people.filter((person) => person.googleChatReady).map((person) => ({ value: person.id, label: person.name }))]} selectClassName="h-10 text-sm" /><UiButton disabled={busy} onClick={() => void onDeliver({ limit: 20 })}><Send size={15} />Ausstehende senden</UiButton><UiButton disabled={busy || !status.webhookConfigured} variant="blueOutline" onClick={() => void onDeliver({ testDelivery: "webhook_digest" })}>Digest testen</UiButton><UiButton disabled={busy || !status.apiConfigured || !testProfileId} variant="blueOutline" onClick={() => void onDeliver({ testDelivery: "direct_dm", profileId: testProfileId })}>DM testen</UiButton></div>}</div>
      </UiPanel>
    </div>
  );
}
