import Link from "next/link";
import { AppSidebar } from "@/features/planning/organisms/app-sidebar";
import { ReadOnlyDetailField } from "@/features/planning-trash/atoms/read-only-detail-field";
import { approvalStatusLabel } from "@/features/planning-trash/model/planning-trash-display";
import { PlanningItemReadOnlyHeader } from "@/features/planning-trash/molecules/planning-item-read-only-header";
import { PlanningTrashBanner } from "@/features/planning-trash/molecules/planning-trash-banner";
import { profileNameById, profileNamesByIds } from "@/lib/display";
import type { PlanningTrashTaskDetail } from "@/lib/planning-trash-detail";
import type { PlatformRole, Profile, TaskType } from "@/lib/types";
import { UiBadge, UiPanel } from "@/shared/atoms/ui-primitives";

function value(value?: string | number | null) {
  return value === undefined || value === null || value === "" ? "Nicht gesetzt" : value;
}

export function PlanningTrashTaskDetailPage({
  detail,
  profiles,
  currentPlatformRole,
}: {
  detail: PlanningTrashTaskDetail;
  profiles: Profile[];
  currentPlatformRole?: PlatformRole;
}) {
  const { task } = detail;
  const typeLabels: Record<TaskType, string> = {
    epic: "Epic",
    initiative: "Initiative",
    deliverable: "Deliverable",
    sub_issue: "Sub-Issue",
  };
  const childLabels: Partial<Record<TaskType, string>> = {
    epic: "Initiativen",
    initiative: "Deliverables",
    deliverable: "Sub-Issues",
  };
  const isStrategic = task.taskType === "epic" || task.taskType === "initiative";
  const raciIds = (role: "accountable" | "responsible" | "consulted" | "informed") => (task.raciAssignments || [])
    .filter((assignment) => assignment.role === role)
    .sort((left, right) => left.sortOrder - right.sortOrder)
    .map((assignment) => assignment.profileId);
  const githubLifecycle = detail.githubLifecycle === "server_managed_close"
    ? "Das verknüpfte Issue wird serverseitig geschlossen beziehungsweise geschlossen gehalten."
    : "Kein GitHub-Issue verknüpft.";

  return (
    <main className="app-sidebar-main min-h-screen bg-slate-50 text-slate-950">
      <AppSidebar activeWorkspace="planning" source="supabase" currentPlatformRole={currentPlatformRole || ""} />
      <PlanningItemReadOnlyHeader eyebrow={typeLabels[task.taskType]} title={task.title} trashed />

      <div className="mx-auto grid max-w-7xl gap-5 px-6 py-6">
        <PlanningTrashBanner trash={detail.trash} githubLifecycle={githubLifecycle} />

        <div className="grid gap-5 lg:grid-cols-[minmax(0,1fr)_320px]">
          <div className="grid min-w-0 gap-5">
            <UiPanel padding="lg">
              <div className="flex flex-wrap items-center justify-between gap-3">
                <h2 className="text-lg font-semibold">
                  {task.taskType === "initiative" ? "Initiativenstrategie" : task.taskType === "epic" ? "Epic-Beschreibung" : "Aufgabenbrief"}
                </h2>
                <UiBadge tone="slate">Schreibgeschützt</UiBadge>
              </div>
              {task.taskType === "initiative" ? (
                <dl className="mt-5 grid gap-5">
                  <ReadOnlyDetailField label="Ziel">{value(task.strategy?.goal || task.description)}</ReadOnlyDetailField>
                  <ReadOnlyDetailField label="Erfolgskriterien">{value(task.strategy?.successCriteria)}</ReadOnlyDetailField>
                  <ReadOnlyDetailField label="Scope-Grenzen">{value(task.strategy?.scopeConstraints)}</ReadOnlyDetailField>
                </dl>
              ) : task.taskType === "epic" ? (
                <dl className="mt-5 grid gap-5">
                  <ReadOnlyDetailField label="Beschreibung">{value(task.description)}</ReadOnlyDetailField>
                </dl>
              ) : (
                <dl className="mt-5 grid gap-5">
                  <ReadOnlyDetailField label="Problem Statement">{value(task.problemStatement || task.description)}</ReadOnlyDetailField>
                  <ReadOnlyDetailField label="Intended Outcome">{value(task.intendedOutcome)}</ReadOnlyDetailField>
                  <ReadOnlyDetailField label="Scope Constraints">{value(task.scopeConstraints)}</ReadOnlyDetailField>
                  <ReadOnlyDetailField label="Acceptance Criteria">{value(task.acceptanceCriteria)}</ReadOnlyDetailField>
                  <ReadOnlyDetailField label="Evidence Required">{value(task.evidenceRequired)}</ReadOnlyDetailField>
                  <ReadOnlyDetailField label="Definition of Done">{value(task.definitionOfDone)}</ReadOnlyDetailField>
                </dl>
              )}
            </UiPanel>

            {detail.children.length > 0 && (
              <UiPanel padding="lg">
                <h2 className="text-lg font-semibold">Direkte {childLabels[task.taskType] || "Kinder"}</h2>
                <p className="mt-1 text-sm text-slate-500">Die Einträge werden ausschließlich zur Einordnung angezeigt.</p>
                <ul className="mt-4 divide-y divide-slate-100 rounded-md border border-slate-200 bg-white">
                  {detail.children.map((child) => (
                    <li key={child.id} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
                      <Link href={`/tasks/${encodeURIComponent(child.id)}`} className="min-w-0 truncate text-sm font-semibold text-blue-700 hover:underline">
                        {child.title}
                      </Link>
                      <div className="flex items-center gap-2">
                        <UiBadge tone="slate">{typeLabels[child.taskType]}</UiBadge>
                        <UiBadge tone={child.trashed ? "red" : "slate"}>{child.trashed ? "Papierkorb" : "Aktiv"}</UiBadge>
                      </div>
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
                {task.taskType !== "epic" && <ReadOnlyDetailField label="Priorität">{value(task.priority)}</ReadOnlyDetailField>}
                <ReadOnlyDetailField label="Zuständigkeit">{value(task.assignee || task.owner)}</ReadOnlyDetailField>
                {task.taskType === "deliverable" && (
                  <ReadOnlyDetailField label="Initiative">
                    {detail.parent ? (
                      <Link href={`/tasks/${encodeURIComponent(detail.parent.id)}`} className="font-semibold text-blue-700 hover:underline">
                        {detail.parent.title}
                      </Link>
                    ) : value(detail.initiative?.title)}
                  </ReadOnlyDetailField>
                )}
                {(task.taskType === "initiative" || task.taskType === "deliverable") && (
                  <ReadOnlyDetailField label="Epic">
                    {detail.parent && task.taskType === "initiative" ? (
                      <Link href={`/tasks/${encodeURIComponent(detail.parent.id)}`} className="font-semibold text-blue-700 hover:underline">
                        {detail.parent.title}
                      </Link>
                    ) : value(detail.epic?.title)}
                  </ReadOnlyDetailField>
                )}
                {detail.parent && task.taskType === "sub_issue" && (
                  <ReadOnlyDetailField label="Parent-Deliverable">
                    <Link href={`/tasks/${encodeURIComponent(detail.parent.id)}`} className="font-semibold text-blue-700 hover:underline">
                      {detail.parent.title}
                    </Link>
                  </ReadOnlyDetailField>
                )}
              </dl>
            </UiPanel>

            {task.taskType === "initiative" && (
              <UiPanel padding="lg">
                <h2 className="text-base font-semibold">RACI</h2>
                <dl className="mt-4 grid gap-4">
                  <ReadOnlyDetailField label="Accountable">{profileNameById(profiles, raciIds("accountable")[0])}</ReadOnlyDetailField>
                  <ReadOnlyDetailField label="Responsible">{profileNamesByIds(profiles, raciIds("responsible"))}</ReadOnlyDetailField>
                  <ReadOnlyDetailField label="Consulted">{profileNamesByIds(profiles, raciIds("consulted"))}</ReadOnlyDetailField>
                  <ReadOnlyDetailField label="Informed">{profileNamesByIds(profiles, raciIds("informed"))}</ReadOnlyDetailField>
                </dl>
              </UiPanel>
            )}

            {!isStrategic && (
              <UiPanel padding="lg">
                <h2 className="text-base font-semibold">GitHub-Verknüpfung</h2>
                <dl className="mt-4 grid gap-4">
                  <ReadOnlyDetailField label="Repository">{value(task.githubRepo)}</ReadOnlyDetailField>
                  <ReadOnlyDetailField label="Issue">{task.githubIssueNumber ? `#${task.githubIssueNumber}` : value(task.issueNumber)}</ReadOnlyDetailField>
                  <ReadOnlyDetailField label="Lifecycle">{githubLifecycle}</ReadOnlyDetailField>
                </dl>
              </UiPanel>
            )}
          </aside>
        </div>
      </div>
    </main>
  );
}
