import type { TeamProfileSaveView } from "@/features/planning/model/planning-team-state";
import type { Profile } from "@/lib/types";
import { teamProfileValues } from "../model/team-profile-view-model";
import { UiButton, UiNotice } from "@/shared/atoms/ui-primitives";

export function TeamProfileSaveNotice({ save, onCheck, profiles = [] }: { save: TeamProfileSaveView; profiles?: readonly Profile[]; onCheck: () => Promise<boolean> }) {
  if (save.phase === "saving") return <UiNotice tone="info" role="status">Profiländerung wird gespeichert.</UiNotice>;
  if (save.phase === "saved" && (save.followup === "current" || save.followup === "not-needed")) return null;
  const unknown = save.phase === "unconfirmed";
  const needsRead = unknown || save.status === 409 || save.phase === "saved";
  return <div className="grid min-w-0 gap-2" role="status">
    <UiNotice tone="warning">{unknown ? "Ob die Profiländerung gespeichert wurde, ist noch unklar. Deine Eingaben bleiben erhalten." : save.phase === "saved" ? "Profiländerung gespeichert. Die Teamansicht ist noch nicht vollständig aktualisiert." : save.error}</UiNotice>
    {needsRead && <UiButton className="min-h-11 justify-self-start" onClick={() => { void onCheck(); }} disabled={save.checkStatus === "checking" || save.followup === "loading"}>{save.checkStatus === "checking" || save.followup === "loading" ? "Teamstand wird geprüft" : "Aktuellen Stand prüfen"}</UiButton>}
    {unknown && save.checkStatus === "checked" && <p className="text-sm text-slate-700">Profil geprüft. Ob die Änderungen gespeichert wurden, bleibt unklar.</p>}
    {save.checkStatus === "unavailable" && <p className="text-sm text-slate-700">Der Teamstand konnte nicht geprüft werden. Deine Angaben bleiben erhalten.</p>}
    {unknown && save.submitted && <details className="text-sm text-slate-700"><summary>Abgesendete Angaben</summary><dl className="grid gap-2 whitespace-pre-wrap break-words">{teamProfileValues(save.submitted, profiles).map(([label, value]) => <div key={label}><dt className="font-semibold">{label}</dt><dd>{value}</dd></div>)}</dl></details>}
  </div>;
}
