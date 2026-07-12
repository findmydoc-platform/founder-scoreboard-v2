"use client";

import { useMemo, useState } from "react";
import { useBacklogCommands } from "@/features/backlog/hooks/use-backlog-commands";
import { BacklogRankTable } from "@/features/backlog/molecules/backlog-rank-table";
import { BacklogScopeTabs } from "@/features/backlog/molecules/backlog-scope-tabs";
import { BacklogSprintPane } from "@/features/backlog/molecules/backlog-sprint-pane";
import { BacklogToolbar } from "@/features/backlog/molecules/backlog-toolbar";
import { type BacklogScope, buildBacklogViewModel, filterBacklogItemsByQuery } from "@/features/backlog/model/backlog-view-model";
import type { BrowserApiClient } from "@/lib/browser-api-client";
import type { PlanningData, Task } from "@/lib/types";
import { UiNotice } from "@/shared/atoms/ui-primitives";

type BacklogOverviewProps = {
  apiClient: BrowserApiClient;
  canManageBacklog: boolean;
  data: PlanningData;
  onOpenTask: (taskId: string) => void;
  onUpdateTask: (task: Task, patch: Partial<Task>) => void;
  refreshPlanningData: () => Promise<void>;
  setData: (updater: (current: PlanningData) => PlanningData) => void;
  source: "seed" | "supabase";
};

export function BacklogOverview({
  apiClient,
  canManageBacklog,
  data,
  onOpenTask,
  onUpdateTask,
  refreshPlanningData,
  setData,
  source,
}: BacklogOverviewProps) {
  const [scope, setScope] = useState<BacklogScope>("all");
  const [query, setQuery] = useState("");
  const viewModel = useMemo(() => buildBacklogViewModel(data, scope), [data, scope]);
  const visibleItems = useMemo(() => filterBacklogItemsByQuery(viewModel.visibleItems, query), [query, viewModel.visibleItems]);
  const {
    assignTaskToSprint,
    isReordering,
    message,
    moveTask,
    reorderTask,
  } = useBacklogCommands({
    apiClient,
    canManageBacklog,
    onUpdateTask,
    orderedTasks: viewModel.orderedTasks,
    refreshPlanningData,
    setData,
    source,
  });

  const taskById = useMemo(() => new Map(viewModel.orderedTasks.map((task) => [task.id, task])), [viewModel.orderedTasks]);

  return (
    <div className="grid gap-4" data-tour-id="backlog-overview">
      <BacklogToolbar query={query} onQueryChange={setQuery} />
      <BacklogScopeTabs scope={scope} onScopeChange={setScope} />

      {message && <UiNotice tone="warning">{message}</UiNotice>}

      <div className="grid min-w-0 gap-4 xl:grid-cols-[minmax(0,1fr)_340px]">
        <BacklogRankTable
          canManageBacklog={canManageBacklog}
          isReordering={isReordering}
          items={visibleItems}
          onMoveTask={moveTask}
          onOpenTask={onOpenTask}
          onReorderTask={reorderTask}
        />
        <BacklogSprintPane
          buckets={viewModel.sprintBuckets}
          canManageBacklog={canManageBacklog}
          onAssignTaskToSprint={assignTaskToSprint}
          taskById={taskById}
        />
      </div>
    </div>
  );
}
