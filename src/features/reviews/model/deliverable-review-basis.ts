import type { PlanningReadAuthority } from "@/features/planning/model/planning-server-header-read";

import type { LinkedPullRequest, PlatformRole } from "@/lib/types";

export type DeliverableReviewBasis = Readonly<{
  taskId: string;
  taskUpdatedAt: string;
  sourceRevision: string;
  evaluatedAt: string;
  validUntil: string;
  readAuthority: PlanningReadAuthority;
  readActor: Readonly<{ profileId: string; platformRole: PlatformRole }>;
  evidence: Readonly<{
    status: "present" | "absent";
    hasException: boolean;
    exceptionNote: string | null;
    links: readonly Readonly<{ taskId: string; title: string; url: string; kind: "evidence" | "github_pull_request"; pullRequest?: LinkedPullRequest }>[];
  }>;
  sprintLock: Readonly<{ sprintId: string | null; locked: boolean }>;
  decision: Readonly<{ status: "allowed"; token: string } | {
    status: "blocked";
    reason: "inactive" | "notApproved" | "sprintLocked" | "evidenceRequired";
  }>;
}>;

export type DeliverableReviewBasisResult = { status: "ready"; basis: DeliverableReviewBasis }
  | { status: "forbidden" | "notFound" | "stale" | "unavailable" };
