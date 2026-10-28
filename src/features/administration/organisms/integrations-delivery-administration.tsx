"use client";

import Image from "next/image";
import { useEffect, useState } from "react";
import { ChevronDown, MessageSquare, RefreshCw, Send } from "lucide-react";
import { DeliveryStatusRow } from "@/features/administration/molecules/delivery-status-row";
import type { AdministrationDeliverySelection } from "@/features/administration/model/administration-delivery-state";
import type { AdministrationWorkspaceModel } from "@/features/administration/model/administration-read-model";
import { UiButton, UiEmptyState, UiField, UiPanel, UiTextInput, UiNotice } from "@/shared/atoms/ui-primitives";
import { UiSelectField } from "@/shared/atoms/form-controls";

export function IntegrationsDeliveryAdministration({ busy, model, onDeliver, onSaveGitHubProject, planningState }: {
  busy: boolean;
  model: AdministrationWorkspaceModel;
  onDeliver?: (payload: Record<string, unknown>) => Promise<void>;
  planningState?: import("@/features/planning/model/planning-state").PlanningState;
  onSaveGitHubProject?: (owner: string, number: number, mentionTeamSlug: string) => Promise<void>;
}) {
  const [editor] = useState(() => planningState?.resumeAdministrationProjectEdit() || (model.githubProject ? planningState?.beginAdministrationProjectEdit(model.githubProject) : null));
  useEffect(() => () => editor?.close(),[editor]);
  const result=editor?.view();
  const [project, setProject] = useState(() => result?.submitted || { id:model.githubProject?.id || "findmydoc-founder-execution", owner: model.githubProject?.owner || "", number: model.githubProject?.number || 0, mentionTeamSlug: model.githubProject?.mentionTeamSlug || "" });
  const projectBusy=editor ? Boolean(result&&["saving","unconfirmed","conflict","blocked","ended"].includes(result.phase)) : busy;
  const saveProject=() => editor ? editor.save(project) : onSaveGitHubProject?.(project.owner,project.number,project.mentionTeamSlug);
  const [detailsOpen, setDetailsOpen] = useState(false);
  const [testProfileId, setTestProfileId] = useState(model.people.find((person) => person.googleChatReady)?.id || "");
  const latestByEvent = new Map<number,typeof model.notificationDeliveries[number]>();
  for(const delivery of model.notificationDeliveries)if(!latestByEvent.has(delivery.eventId))latestByEvent.set(delivery.eventId,delivery);
  const deliveries=planningState?.administrationDeliveries() || [];
  const deliveryBusy=(selection:AdministrationDeliverySelection)=>planningState ? planningState.administrationDeliveryAvailability(selection)!=="available" : busy;
  const runDelivery=(selection:AdministrationDeliverySelection)=>{
    if(planningState)return planningState.runAdministrationDelivery(selection);
    const payload=selection.kind==="events"?{eventIds:[...selection.eventIds]}:selection.kind==="pending"?{limit:selection.limit}:selection.kind==="webhook-test"?{testDelivery:"webhook_digest"}:{testDelivery:"direct_dm",profileId:selection.profileId};
    return onDeliver?.(payload);
  };
  const reportedByEvent=new Map<number,import("../model/administration-delivery-state").AdministrationDeliveryItem>();
  for(const operation of deliveries)if(["reported","partial"].includes(operation.phase)&&operation.readStatus!=="current")for(const result of operation.results)reportedByEvent.set(result.eventId,result);
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
        <div className="grid gap-4 px-5 py-5 md:grid-cols-[minmax(0,1fr)_minmax(10rem,0.7fr)_minmax(0,1fr)_auto] md:items-end">
          <UiField>GitHub-Organisation<UiTextInput className="min-w-0" value={project.owner} disabled={projectBusy} onChange={(event) => setProject((current) => ({ ...current, owner: event.target.value }))} /></UiField>
          <UiField>Project-Nummer<UiTextInput className="min-w-0" type="number" min={1} value={project.number || ""} disabled={projectBusy} onChange={(event) => setProject((current) => ({ ...current, number: Number(event.target.value) }))} /></UiField>
          <UiField>Team-Slug für @all<UiTextInput className="min-w-0" value={project.mentionTeamSlug} disabled={projectBusy} onChange={(event) => setProject((current) => ({ ...current, mentionTeamSlug: event.target.value.toLowerCase() }))} placeholder="founderops" /></UiField>
          <UiButton variant="primary" disabled={projectBusy || !project.owner || project.number < 1} onClick={() => { void saveProject(); }}><RefreshCw size={15} />Speichern und prüfen</UiButton>
        </div>
        <div className="border-t border-slate-100 px-5 py-4">
          {model.integrationStatus.mentionTeam.state === "stale" ? <p className="text-sm text-amber-800">Der Teamstatus muss aktualisiert werden.</p> : model.integrationStatus.mentionTeam.state === "ready" ? (
            <div className="text-sm text-emerald-700"><span className="font-semibold">@all → {model.integrationStatus.mentionTeam.githubHandle}</span><span className="ml-2">Team bestätigt, App-Recht aktiv, Team-Erwähnungen aktiviert.</span></div>
          ) : (
            <div className="text-sm text-amber-800"><span className="font-semibold">Fallback aktiv.</span><span className="ml-2">FounderOps erwähnt verknüpfte GitHub-Logins einzeln. {model.integrationStatus.mentionTeam.profilesWithoutGitHubLogin} Profile haben keinen GitHub-Login.</span></div>
          )}
        </div>
        {result && result.phase !== "editing" && <UiNotice className="mx-5 mb-4" tone={result.phase === "saved" ? "success" : "warning"} role="status">
          <p>{result.phase === "saved" ? "GitHub-Projekteinstellungen gespeichert" : ["saving","unconfirmed"].includes(result.phase) ? "Speicherung der GitHub-Einstellungen unklar" : result.phase === "conflict" ? "GitHub-Projekteinstellungen inzwischen geändert" : result.phase === "blocked" ? "Vorherige Speicherung der GitHub-Einstellungen unklar" : result.phase === "ended" ? "Der technische Adminzugang wurde beendet." : "GitHub-Projekteinstellungen nicht gespeichert"}</p>
          {result.error && <p>{result.error}</p>}{result.readStatus === "unavailable" && <p>Die Statusdaten konnten nicht nachgeladen werden.</p>}
          {["unconfirmed","blocked"].includes(result.phase) && <UiButton className="mt-2 min-h-11" onClick={() => { void editor?.checkOutcome(); }}>Aktuellen Stand prüfen</UiButton>}
          {result.phase === "conflict" && <div className="mt-2 flex flex-wrap gap-2"><UiButton className="min-h-11" onClick={() => { void editor?.refreshConflict(); }}>Änderungen vergleichen</UiButton><UiButton className="min-h-11" disabled={!result.canResave} onClick={() => { void editor?.resave(project); }}>Erneut speichern</UiButton></div>}
          {result.serverProject && <dl className="mt-2 grid gap-1 break-words"><div><dt>Aktuelle Organisation</dt><dd>{result.serverProject.owner}</dd></div><div><dt>Aktuelle Projektnummer</dt><dd>{result.serverProject.number}</dd></div><div><dt>Aktueller Team-Slug</dt><dd>{result.serverProject.mentionTeamSlug || "Kein Team"}</dd></div></dl>}
        </UiNotice>}
      </UiPanel>

      <UiPanel padding="none" className="overflow-hidden">
        <div className="border-b border-slate-100 px-5 py-5"><div className="flex items-center gap-4"><span className="grid h-12 w-12 place-items-center rounded-full border border-slate-200 bg-slate-50 text-emerald-600"><MessageSquare size={25} /></span><div><h2 className="text-lg font-semibold text-slate-950">Google Chat</h2><p className="mt-1 text-sm text-slate-500">Automatische Zustellung von Hinweisen und wichtigen Ereignissen an das Team.</p></div></div></div>
        <div className="grid gap-4 border-b border-slate-100 px-5 py-5 md:grid-cols-2"><div><div className="text-xs font-semibold text-slate-500">Zustellungsmodus</div><div className="mt-2 font-semibold text-slate-950">{status.mode === "direct-dm" ? "Persönliche Hinweise" : status.mode === "space-webhook" ? "Team-Digest" : "Nicht konfiguriert"}</div><p className={`mt-1 text-xs ${status.deliveryEnabled ? "text-slate-500" : "font-semibold text-amber-700"}`}>{status.deliveryEnabled ? "Direkte Nachrichten oder Webhook-Digest." : "Zustellung deaktiviert"}</p></div><div><div className="text-xs font-semibold text-slate-500">Warteschlange</div><div className="mt-2 font-semibold text-slate-950">{model.coverage?.notificationEvents === "partial" ? "Im geladenen Ausschnitt: " : ""}{model.integrationStatus.pendingDeliveries} ausstehend</div><p className="mt-1 text-xs text-slate-500">{model.coverage?.notificationDeliveries === "partial" ? "Im geladenen Ausschnitt: " : ""}{model.integrationStatus.failedDeliveries} fehlgeschlagen</p></div></div>
        {deliveries.filter(operation=>operation.phase!=="ended").slice(-4).map(operation=><UiNotice key={operation.id} className="mx-5 my-3" tone={operation.phase==="reported"?"success":"warning"} role="status">
          <p>{operation.phase==="saving"?"Zustellung wird ausgeführt":operation.phase==="unconfirmed"?"Zustellung noch nicht bestätigt":operation.phase==="rejected"?"Zustellauftrag abgelehnt":operation.phase==="partial"?"Ergebnis nur teilweise bekannt":"Zustellergebnis bekannt"}</p>
          {operation.sent!==null&&<p>{operation.sent} zugestellt, {operation.failed} fehlgeschlagen, {operation.skipped} übersprungen</p>}
          {operation.error&&<p>{operation.error}</p>}{operation.readStatus==="unavailable"&&<p>Die aktuellen Zustelldaten konnten nicht nachgeladen werden.</p>}
          {operation.phase==="unconfirmed"&&operation.readStatus==="current"&&<p>Ob die Nachrichten vollständig zugestellt wurden, bleibt unklar.</p>}
          {operation.results.map(result=><p key={result.eventId}>Ereignis {result.eventId}: {result.status==="sent"?"Zugestellt":result.status==="failed"?"Fehlgeschlagen":"Übersprungen"}</p>)}
          {["unconfirmed","partial"].includes(operation.phase)&&<UiButton className="mt-2 min-h-11" disabled={operation.checking} onClick={()=>{void planningState?.checkAdministrationDelivery(operation.id);}}>Zustellstand prüfen</UiButton>}
        </UiNotice>)}
        <div className="px-5 pt-4"><h3 className="text-sm font-semibold text-slate-600">Letzte Zustellungen</h3></div>
        {model.notificationEvents.length ? model.notificationEvents.slice(0, 12).map((event) => <DeliveryStatusRow key={event.id} event={event} delivery={latestByEvent.get(event.id)} reportedResult={reportedByEvent.get(event.id)} busy={deliveryBusy({kind:"events",eventIds:[event.id]})} onRetry={() => { void runDelivery({kind:"events",eventIds:[event.id]}); }} />) : <div className="p-5"><UiEmptyState minHeight="sm">Keine Zustellereignisse vorhanden.</UiEmptyState></div>}
        <div className="border-t border-slate-100 px-5 py-4"><button type="button" aria-expanded={detailsOpen} onClick={() => setDetailsOpen((open) => !open)} className="flex min-h-11 w-full items-center gap-3 text-left"><span className="font-semibold text-blue-700">Technische Details</span><span className="min-w-0 flex-1 text-xs text-slate-500">Testzustellung und Diagnose</span><ChevronDown size={17} className={`transition ${detailsOpen ? "rotate-180" : ""}`} /></button>{detailsOpen && <div className="mt-4 grid gap-3 border-t border-slate-100 pt-4 md:grid-cols-[minmax(0,1fr)_auto_auto_auto] md:items-end"><UiSelectField label="Empfänger für Test-DM" value={testProfileId} onChange={setTestProfileId} options={[{ value: "", label: "Profil auswählen" }, ...model.people.filter((person) => person.googleChatReady).map((person) => ({ value: person.id, label: person.name }))]} selectClassName="h-10 text-sm" /><UiButton disabled={deliveryBusy({kind:"pending",limit:20})} onClick={() => { void runDelivery({kind:"pending",limit:20}); }}><Send size={15} />Ausstehende senden</UiButton><UiButton disabled={deliveryBusy({kind:"webhook-test"}) || !status.webhookConfigured} variant="blueOutline" onClick={() => { void runDelivery({kind:"webhook-test"}); }}>Digest testen</UiButton><UiButton disabled={deliveryBusy({kind:"direct-message-test",profileId:testProfileId}) || !status.apiConfigured || !testProfileId} variant="blueOutline" onClick={() => { void runDelivery({kind:"direct-message-test",profileId:testProfileId}); }}>DM testen</UiButton></div>}</div>
      </UiPanel>
    </div>
  );
}
