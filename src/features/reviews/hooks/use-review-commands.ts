"use client";

import type { PlanningCommandContext } from "@/features/planning/hooks/planning-command-context";
import { hasGitHubIssue } from "@/lib/platform";
import type { Task, TaskReviewChecklist } from "@/lib/types";
import type { ReviewEvidenceSubmission } from "@/features/reviews/model/review-evidence";

type TaskSyncCommand = (task: Task, options?: { createIfMissing?: boolean; silent?: boolean }) => void;

export function useReviewCommands({ planningState, githubInstallationAvailable, setSaveError, startTransition, syncTaskToGitHub }: PlanningCommandContext & { syncTaskToGitHub: TaskSyncCommand }) {
  const run = (saving: Promise<import("@/features/tasks/hooks/task-mutation-command-types").TaskUpdateResult>, task:Task, sync=false):Promise<boolean> => {
    setSaveError("");
    const result=saving.then(result=>{
      if(!result.ok){setSaveError(result.error);return false;}
      if(sync&&hasGitHubIssue(task)&&githubInstallationAvailable){
        try {syncTaskToGitHub({...task,...result.task},{silent:true});}
        catch(error){setSaveError(error instanceof Error?error.message:"GitHub-Sync konnte nicht gestartet werden.");}
      }
      return true;
    });
    startTransition(async()=>{await result;});
    return result;
  };
  return {
    reviewTask:(task:Task,decision:"accepted"|"partial"|"changes_requested",points:number,checklist?:TaskReviewChecklist,comment?:string)=>run(planningState.decideTaskReview(task,{decision,points,checklist,comment}),task,true),
    withdrawReviewTask:(task:Task,reason:string)=>run(planningState.withdrawTaskReview(task,reason),task),
    reopenReviewTask:(task:Task,evidence:ReviewEvidenceSubmission={})=>run(planningState.reopenTaskReview(task,evidence),task),
  };
}
