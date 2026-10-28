import type { TeamProfileSaveView } from "@/features/planning/model/planning-team-state";
import { UiButton, UiNotice } from "@/shared/atoms/ui-primitives";

export function TeamProfileSaveNotice({ save, onCheck }: { save: TeamProfileSaveView; onCheck: () => Promise<boolean> }) {
  if (save.phase === "saving") return <UiNotice tone="info" role="status">Profiländerung wird gespeichert.</UiNotice>;
  if (save.phase === "saved" && (save.followup === "current" || save.followup === "not-needed")) return null;
  const unknown = save.phase === "unconfirmed";
  const needsRead = unknown || save.status === 409 || save.phase === "saved";
  return <div className="grid min-w-0 gap-2" role="status">
    <UiNotice tone="warning">{unknown ? "Speicherbestätigung ausstehend. Deine abgesendeten Angaben bleiben erhalten. Ein aktueller Teamstand bestätigt diesen Speicherversuch nicht." : save.phase === "saved" ? "Die Profiländerung ist gespeichert. Der vollständige aktuelle Teamstand steht noch aus." : save.error}</UiNotice>
    {needsRead && <UiButton className="min-h-11 justify-self-start" onClick={() => { void onCheck(); }} disabled={save.checkStatus === "checking" || save.followup === "loading"}>{save.checkStatus === "checking" || save.followup === "loading" ? "Teamstand wird geprüft" : "Serverstand prüfen"}</UiButton>}
    {unknown && save.checkStatus === "checked" && <p className="text-sm text-slate-700">Serverstand geprüft. Die Speicherbestätigung bleibt offen.</p>}
    {save.checkStatus === "unavailable" && <p className="text-sm text-slate-700">Der Teamstand konnte nicht geprüft werden. Deine Angaben bleiben erhalten.</p>}
    {unknown && save.submitted && <details className="text-sm text-slate-700"><summary>Abgesendete Angaben</summary><pre className="overflow-x-auto whitespace-pre-wrap break-words">{JSON.stringify(save.submitted, null, 2)}</pre></details>}
  </div>;
}
