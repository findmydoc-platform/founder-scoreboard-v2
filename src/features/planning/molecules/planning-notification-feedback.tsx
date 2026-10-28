"use client";
import { usePlanningBusinessState } from "../hooks/use-planning-business-state";
export function PlanningNotificationFeedback() {
  const state = usePlanningBusinessState();
  const operations = state?.notifications().operations.filter(operation => operation.phase !== "saved") || [];
  if (!operations.length) return null;
  return <div className="max-w-sm space-y-2 text-sm text-slate-700" aria-live="polite">
    {operations.map(operation => <div key={operation.releaseVersion || operation.eventId} role="status" className="rounded-md border border-slate-200 bg-white p-2">
      <span className="block font-medium">{operation.action === "dismiss" ? "Schließen" : "Als gesehen markieren"}: {operation.releaseVersion || state?.notifications().events.find(event => event.id === operation.eventId)?.title || "Benachrichtigung"}</span>
      {operation.phase === "saving" ? "Benachrichtigung wird gespeichert." : operation.phase === "unconfirmed" ? "Bestätigung steht aus. Die abgesendete Aktion bleibt erhalten; der Serverstand kann geprüft werden." : operation.error}
      {operation.phase === "unconfirmed" ? <button className="mt-1 block min-h-11 rounded px-2 py-1 font-semibold text-blue-700 focus-visible:ring-2 focus-visible:ring-blue-500" disabled={operation.checking} onClick={() => { if (operation.releaseVersion) void state?.checkPlatformReleaseSeen(operation.releaseVersion); else if (operation.eventId) void state?.checkNotificationStatus(operation.eventId); }}>{operation.checking ? "Serverstand wird geprüft" : "Serverstand prüfen"}</button> : null}
    </div>)}
  </div>;
}
