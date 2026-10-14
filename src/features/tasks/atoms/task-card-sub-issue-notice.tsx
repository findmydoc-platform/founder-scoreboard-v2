import { TaskTypeIcon } from "@/features/tasks/atoms/task-type-indicator";

export function TaskCardSubIssueNotice({ count }: { count: number }) {
  if (count <= 0) return null;

  const label = count === 1
    ? "1 offenes Sub-Issue für dich"
    : `${count} offene Sub-Issues für dich`;

  return (
    <div className="mb-2.5 flex min-w-0 items-center gap-1.5 rounded-sm bg-yellow-50 px-2 py-1.5 text-[11px] font-semibold leading-4 text-yellow-800">
      <TaskTypeIcon taskType="sub_issue" size={14} />
      <span className="min-w-0 truncate whitespace-nowrap">{label}</span>
    </div>
  );
}
