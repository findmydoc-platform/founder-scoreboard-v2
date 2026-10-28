"use client";

import type { PlanningCommandContext } from "@/features/planning/hooks/planning-command-context";
import type { Task } from "@/lib/types";

type Options = Pick<PlanningCommandContext,"planningState"|"setSaveError"|"startTransition">;
export function useTaskGitHubSyncCommand({planningState,setSaveError,startTransition}:Options) {
  const syncTaskToGitHub = (task:Task,options:{createIfMissing?:boolean;silent?:boolean}={}) => {
    if(!options.silent)setSaveError("");
    const syncing=planningState.syncTaskToGitHub(task,{createIfMissing:Boolean(options.createIfMissing),automatic:Boolean(options.silent)});
    startTransition(async()=>{
      const result=await syncing;
      if(!options.silent&&result.phase!=="ended"&&result.error)setSaveError(result.error);
    });
  };
  const syncLinkedGitHubTasks = (options:{onlyFailed?:boolean}={}) => {
    setSaveError("");
    const syncing=planningState.syncGitHubTasks(options);
    startTransition(async()=>{
      const result=await syncing;
      if(result.phase==="complete") {
        const failed=result.taskIds.map(id=>planningState.taskGitHubSync(id)).filter(view=>view?.receipt&&!view.receipt.ok&&view.error).at(-1);
        if(failed)setSaveError(failed.error);
      }
    });
  };
  const githubSyncNotice=planningState.githubSyncNotice();
  return {syncTaskToGitHub,syncLinkedGitHubTasks,githubSyncNotice};
}
