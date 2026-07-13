import Link from "next/link";
import { AppSidebar } from "@/features/planning/organisms/app-sidebar";
import { ReadOnlyDetailField } from "@/features/planning-trash/atoms/read-only-detail-field";
import { approvalStatusLabel } from "@/features/planning-trash/model/planning-trash-display";
import { PlanningItemReadOnlyHeader } from "@/features/planning-trash/molecules/planning-item-read-only-header";
import { PlanningTrashBanner } from "@/features/planning-trash/molecules/planning-trash-banner";
import type { PlanningTrashTaskDetail } from "@/lib/planning-trash-detail";
import type { PlatformRole } from "@/lib/types";
import { UiBadge, UiPanel } from "@/shared/atoms/ui-primitives";

function value(value?: string | number | null) {
  return value === undefined || value === null || value === "" ? "Nicht gesetzt" : value;
}

export function PlanningTrashTaskDetailPage({
  detail,
  currentPlatformRole,
}: {
  detail: PlanningTrashTaskDetail;
  currentPlatformRole?: PlatformRole;
}) {
  const { task } = detail;
  const githubLifecycle = detail.githubLifecycle === "server_managed_close"
    ? "Das verknüpfte Issue wird serverseitig geschlossen beziehungsweise geschlossen gehalten."
    : "Kein GitHub-Issue verknüpft.";

  return (
    <main className="min-h-screen bg-slate-50 text-slate-950 lg:pl-16">
      <AppSidebar activeWorkspace="planning" source="supabase" currentPlatformRole={currentPlatformRole || ""} />
      <PlanningItemReadOnlyHeader eyebrow={task.taskType === "sub_issue" ? "Sub-Issue" : "Deliverable"} title={task.title} trashed />

      <div className="mx-auto grid max-w-7xl gap-5 px-6 py-6">
        <PlanningTrashBanner trash={detail.trash} githubLifecycle={githubLifecycle} />

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="grid min-w-0 gap-5">
            <UiPanel padding="lg">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">Aufgabenbrief</h2>
                <UiBadge tone="slate">Schreibgeschützt</UiBadge>
              </div>
              <dl className="mt-5 grid gap-5">
                <ReadOnlyDetailField label="Problem Statement">{value(task.problemStatement || task.description)}</ReadOnlyDetailField>
                <ReadOnlyDetailField label="Intended Outcome">{value(task.intendedOutcome)}</ReadOnlyDetailField>
                <ReadOnlyDetailField label="Scope Constraints">{value(task.scopeConstraints)}</ReadOnlyDetailField>
                <ReadOnlyDetailField label="Acceptance Criteria">{value(task.acceptanceCriteria)}</ReadOnlyDetailField>
                <ReadOnlyDetailField label="Evidence Required">{value(task.evidenceRequired)}</ReadOnlyDetailField>
                <ReadOnlyDetailField label="Definition of Done">{value(task.definitionOfDone)}</ReadOnlyDetailField>
              </dl>
            </UiPanel>

            {detail.subIssues.length > 0 && (
              <UiPanel padding="lg">
                <h2 className="text-lg font-semibold">Untergeordnete Sub-Issues</h2>
                <p className="mt-1 text-sm text-slate-500">Die Einträge werden ausschließlich zur Einordnung angezeigt.</p>
                <ul className="mt-4 divide-y divide-slate-100 rounded-md border border-slate-200 bg-white">
                  {detail.subIssues.map((subIssue) => (
                    <li key={subIssue.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                      <Link href={`/tasks/${encodeURIComponent(subIssue.id)}`} className="min-w-0 truncate text-sm font-semibold text-blue-700 hover:underline">
                        {subIssue.title}
                      </Link>
                      <UiBadge tone={subIssue.trashed ? "red" : "slate"}>{subIssue.trashed ? "Papierkorb" : "Aktiv"}</UiBadge>
                    </li>
                  ))}
                </ul>
              </UiPanel>
            )}
          </div>

          <aside className="grid content-start gap-5">
            <UiPanel padding="lg">
              <h2 className="text-base font-semibold">Einordnung</h2>
              <dl className="mt-4 grid gap-4">
                <ReadOnlyDetailField label="Freigabe">{approvalStatusLabel(task.approvalStatus)}</ReadOnlyDetailField>
                <ReadOnlyDetailField label="Arbeitsstatus">{value(task.status)}</ReadOnlyDetailField>
                <ReadOnlyDetailField label="Priorität">{value(task.priority)}</ReadOnlyDetailField>
                <ReadOnlyDetailField label="Zuständigkeit">{value(task.assignee || task.owner)}</ReadOnlyDetailField>
                <ReadOnlyDetailField label="Initiative">{value(detail.initiative?.title)}</ReadOnlyDetailField>
                <ReadOnlyDetailField label="Meilenstein">{value(detail.milestone?.title)}</ReadOnlyDetailField>
                {detail.parent && (
                  <ReadOnlyDetailField label="Parent-Deliverable">
                    <Link href={`/tasks/${encodeURIComponent(detail.parent.id)}`} className="font-semibold text-blue-700 hover:underline">
                      {detail.parent.title}
                    </Link>
                  </ReadOnlyDetailField>
                )}
              </dl>
            </UiPanel>

            <UiPanel padding="lg">
              <h2 className="text-base font-semibold">GitHub-Verknüpfung</h2>
              <dl className="mt-4 grid gap-4">
                <ReadOnlyDetailField label="Repository">{value(task.githubRepo)}</ReadOnlyDetailField>
                <ReadOnlyDetailField label="Issue">{task.githubIssueNumber ? `#${task.githubIssueNumber}` : value(task.issueNumber)}</ReadOnlyDetailField>
                <ReadOnlyDetailField label="Lifecycle">{githubLifecycle}</ReadOnlyDetailField>
              </dl>
            </UiPanel>
          </aside>
        </div>
      </div>
    </main>
  );
}
