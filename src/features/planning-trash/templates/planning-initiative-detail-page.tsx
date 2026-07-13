import Link from "next/link";
import { AppSidebar } from "@/features/planning/organisms/app-sidebar";
import { ReadOnlyDetailField } from "@/features/planning-trash/atoms/read-only-detail-field";
import { approvalStatusLabel } from "@/features/planning-trash/model/planning-trash-display";
import { PlanningItemReadOnlyHeader } from "@/features/planning-trash/molecules/planning-item-read-only-header";
import { PlanningTrashBanner } from "@/features/planning-trash/molecules/planning-trash-banner";
import { profileNameById, profileNamesByIds } from "@/lib/display";
import type { PlanningInitiativeDetail } from "@/lib/planning-trash-detail";
import type { PlatformRole, Profile } from "@/lib/types";
import { UiBadge, UiPanel } from "@/shared/atoms/ui-primitives";

function value(value?: string | number | null) {
  return value === undefined || value === null || value === "" ? "Nicht gesetzt" : value;
}

export function PlanningInitiativeDetailPage({
  detail,
  profiles,
  currentPlatformRole,
}: {
  detail: PlanningInitiativeDetail;
  profiles: Profile[];
  currentPlatformRole?: PlatformRole;
}) {
  const { initiative } = detail;
  const githubLifecycle = detail.linkedGitHubIssueCount
    ? `${detail.linkedGitHubIssueCount} verknüpfte GitHub-Issues werden serverseitig geschlossen beziehungsweise geschlossen gehalten.`
    : "Keine GitHub-Issues mit Deliverables dieser Initiative verknüpft.";

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950 lg:pl-16">
      <AppSidebar activeWorkspace="planning" source="supabase" currentPlatformRole={currentPlatformRole || ""} />
      <PlanningItemReadOnlyHeader eyebrow="Initiative" title={initiative.title} trashed={Boolean(detail.trash)} />

      <div className="mx-auto grid max-w-7xl gap-5 px-6 py-6">
        {detail.trash && <PlanningTrashBanner trash={detail.trash} githubLifecycle={githubLifecycle} />}

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="grid min-w-0 gap-5">
            <UiPanel padding="lg">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">Initiative-Brief</h2>
                <UiBadge tone="slate">Schreibgeschützt</UiBadge>
              </div>
              <dl className="mt-5 grid gap-5">
                <ReadOnlyDetailField label="Ziel">{value(initiative.goal)}</ReadOnlyDetailField>
                <ReadOnlyDetailField label="Scope Constraints">{value(initiative.scopeConstraints)}</ReadOnlyDetailField>
                <ReadOnlyDetailField label="Success Criteria">{value(initiative.successCriteria)}</ReadOnlyDetailField>
              </dl>
            </UiPanel>

            <UiPanel padding="lg">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <div>
                  <h2 className="text-lg font-semibold">Deliverables</h2>
                  <p className="mt-1 text-sm text-slate-500">Nur zur Einordnung; Aktionen sind auf dieser Detailseite deaktiviert.</p>
                </div>
                <UiBadge tone="slate">{detail.deliverables.length}</UiBadge>
              </div>
              {detail.deliverables.length ? (
                <ul className="mt-4 divide-y divide-slate-100 rounded-md border border-slate-200 bg-white">
                  {detail.deliverables.map((deliverable) => (
                    <li key={deliverable.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                      <Link href={`/tasks/${encodeURIComponent(deliverable.id)}`} className="min-w-0 truncate text-sm font-semibold text-blue-700 hover:underline">
                        {deliverable.title}
                      </Link>
                      <div className="flex items-center gap-2">
                        <UiBadge tone="slate">{approvalStatusLabel(deliverable.approvalStatus)}</UiBadge>
                        {deliverable.trashed && <UiBadge tone="red">Papierkorb</UiBadge>}
                      </div>
                    </li>
                  ))}
                </ul>
              ) : (
                <p className="mt-4 rounded-md border border-dashed border-slate-200 px-4 py-6 text-sm text-slate-500">Keine Deliverables vorhanden.</p>
              )}
            </UiPanel>
          </div>

          <aside className="grid content-start gap-5">
            <UiPanel padding="lg">
              <h2 className="text-base font-semibold">Einordnung</h2>
              <dl className="mt-4 grid gap-4">
                <ReadOnlyDetailField label="Freigabe">{approvalStatusLabel(initiative.approvalStatus)}</ReadOnlyDetailField>
                <ReadOnlyDetailField label="Arbeitsstatus">{value(initiative.status)}</ReadOnlyDetailField>
                <ReadOnlyDetailField label="Priorität">{value(initiative.priority)}</ReadOnlyDetailField>
                <ReadOnlyDetailField label="Zieldatum">{value(initiative.targetDate)}</ReadOnlyDetailField>
                <ReadOnlyDetailField label="Meilenstein">{value(detail.milestone?.title)}</ReadOnlyDetailField>
              </dl>
            </UiPanel>

            <UiPanel padding="lg">
              <h2 className="text-base font-semibold">Mini-RACI</h2>
              <dl className="mt-4 grid gap-4">
                <ReadOnlyDetailField label="Accountable">{profileNameById(profiles, initiative.accountableProfileId || initiative.ownerId)}</ReadOnlyDetailField>
                <ReadOnlyDetailField label="Responsible">{profileNamesByIds(profiles, initiative.responsibleProfileIds)}</ReadOnlyDetailField>
                <ReadOnlyDetailField label="Consulted">{profileNamesByIds(profiles, initiative.consultedProfileIds)}</ReadOnlyDetailField>
                <ReadOnlyDetailField label="Informed">{profileNamesByIds(profiles, initiative.informedProfileIds)}</ReadOnlyDetailField>
              </dl>
            </UiPanel>
          </aside>
        </div>
      </div>
    </main>
  );
}
