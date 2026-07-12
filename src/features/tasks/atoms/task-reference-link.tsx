"use client";

import { PanelRight } from "lucide-react";
import Link from "next/link";
import type { AnchorHTMLAttributes, MouseEvent, ReactNode } from "react";
import { shouldOpenTaskReferenceInPanel } from "@/features/tasks/model/task-panel-selection";
import type { Task } from "@/lib/types";
import { classNames } from "@/shared/atoms/ui-primitives";

type TaskReferenceLinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "children" | "href" | "onClick"> & {
  task: Pick<Task, "id" | "title">;
  children?: ReactNode;
  onOpenTask?: (taskId: string) => void;
  showIcon?: boolean;
  layout?: "inline" | "block" | "flex";
};

export function TaskReferenceLink({
  task,
  children,
  className,
  onOpenTask,
  showIcon = true,
  layout = "inline",
  draggable = false,
  ...props
}: TaskReferenceLinkProps) {
  const handleClick = (event: MouseEvent<HTMLAnchorElement>) => {
    if (!onOpenTask || !shouldOpenTaskReferenceInPanel(event)) return;
    event.preventDefault();
    onOpenTask(task.id);
  };

  return (
    <Link
      href={`/tasks/${encodeURIComponent(task.id)}`}
      onClick={handleClick}
      aria-haspopup={onOpenTask ? "dialog" : undefined}
      draggable={draggable}
      className={classNames(
        "group/task-reference min-w-0 cursor-pointer underline-offset-2 transition hover:text-blue-700 hover:underline focus-visible:rounded-sm focus-visible:text-blue-700 focus-visible:underline focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 focus-visible:ring-offset-2",
        layout === "inline" && "inline-flex items-start gap-1.5",
        layout === "block" && "block",
        layout === "flex" && "flex",
        className,
      )}
      {...props}
    >
      {children ?? <span className="min-w-0">{task.title}</span>}
      {showIcon && (
        <PanelRight
          size={13}
          className="mt-0.5 shrink-0 text-blue-500 opacity-60 transition-opacity group-hover/task-reference:opacity-100 group-focus-visible/task-reference:opacity-100"
          aria-hidden="true"
        />
      )}
    </Link>
  );
}
