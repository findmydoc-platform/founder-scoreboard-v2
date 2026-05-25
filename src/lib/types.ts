export type Role = "admin" | "member" | "viewer";
export type PlatformRole = "ceo" | "founder" | "deputy" | "viewer";
export type ReviewStatus = "not_requested" | "requested" | "accepted" | "partial" | "changes_requested";
export type GitHubSyncStatus = "not_synced" | "synced" | "pending" | "failed";
export type CommitmentLevel = "Lite" | "Standard" | "Heavy" | "Away";
export type TaskType = "deliverable" | "proposal" | "sub_issue";
export type TaskRelationType = "blocked_by" | "blocks" | "relates_to";

export type TaskStatus = "Vorschlag" | "Offen" | "In Arbeit" | "Review" | "Nacharbeit" | "Blockiert" | "Erledigt";

export type Profile = {
  id: string;
  name: string;
  role: Role;
  platformRole: PlatformRole;
  orgRole: string;
  githubLogin: string;
  deputyFor?: string;
  deputyActiveFrom?: string;
  deputyActiveUntil?: string;
  focus?: string;
  weeklyCapacity: number;
  color?: string;
  googleChatUserId?: string;
  googleChatDmSpace?: string;
  notificationsEnabled?: boolean;
};

export type Project = {
  id: string;
  name: string;
  range: string;
};

export type Package = {
  id: string;
  milestoneId?: string;
  title: string;
  goal: string;
  priority: string;
  sortOrder: number;
};

export type Milestone = {
  id: string;
  title: string;
  description: string;
  targetDate: string;
  status: "planned" | "active" | "done";
  sortOrder: number;
};

export type Task = {
  id: string;
  order: number;
  title: string;
  description: string;
  status: string;
  priority: string;
  owner: string;
  assignee: string;
  createdBy?: string;
  workstream: string;
  packageId: string;
  deadline: string;
  problemStatement?: string;
  intendedOutcome?: string;
  scopeConstraints?: string;
  acceptanceCriteria?: string;
  evidenceRequired?: string;
  dodTemplateVersion?: string;
  definitionOfDone: string;
  dependsOn: string;
  evidenceLink: string;
  issueNumber: string;
  issueUrl: string;
  note: string;
  watched: boolean;
  hours: number;
  startDate: string;
  endDate: string;
  sprintId: string;
  milestoneId?: string;
  reviewStatus: ReviewStatus;
  scorePoints: number;
  scoreFinal: boolean;
  githubRepo: string;
  githubIssueNumber: number | null;
  githubIssueUrl: string;
  githubSyncStatus: GitHubSyncStatus;
  githubLastSyncedAt: string;
  githubSyncError: string;
  taskType: TaskType;
  parentTaskId: string;
  scoreRelevant: boolean;
  originalSprintId?: string;
  carriedFromTaskId?: string;
  carriedFromSprintId?: string;
  carryoverReason?: string;
  carryoverCount?: number;
  sprintOutcome?: "completed" | "partial" | "rework" | "communicated_blocker" | "missed_no_review" | "missed_uncommunicated" | "";
  selfDodChecked?: boolean;
  selfEvidenceChecked?: boolean;
  selfDocumentedChecked?: boolean;
  selfBlockersChecked?: boolean;
};

export type Sprint = {
  id: string;
  name: string;
  status: "planning" | "active" | "review" | "closed";
  startDate: string;
  endDate: string;
  reviewDueAt: string;
  scoreLocked: boolean;
};

export type SprintCommitment = {
  id: number;
  sprintId: string;
  profileId: string;
  commitmentLevel: CommitmentLevel;
  weeklyHours: number;
  note: string;
};

export type Decision = {
  id: number;
  title: string;
  context: string;
  decision: string;
  status: "draft" | "open_for_confirmation" | "locked";
  requiredProfileIds: string[];
  confirmedProfileIds: string[];
  createdBy: string;
  lockedAt: string;
};

export type DecisionComment = {
  id: number;
  decisionId: number;
  profileId: string;
  type: "comment" | "objection";
  comment: string;
  createdAt: string;
};

export type TaskComment = {
  id: number;
  taskId: string;
  profileId: string;
  comment: string;
  createdAt: string;
};

export type TaskExternalComment = {
  id: number;
  taskId: string;
  source: "github";
  externalId: string;
  authorLogin: string;
  authorAvatarUrl: string;
  body: string;
  htmlUrl: string;
  createdAt: string;
  importedAt: string;
};

export type TaskBlocker = {
  id: number;
  taskId: string;
  profileId: string;
  reason: string;
  impact: string;
  needsHelpFrom: string;
  status: "open" | "resolved" | "accepted_carryover";
  createdAt: string;
  resolvedAt: string;
};

export type TaskRelation = {
  id: number;
  taskId: string;
  relatedTaskId: string;
  relationType: TaskRelationType;
  note: string;
  createdBy: string;
  createdAt: string;
};

export type TaskActivity = {
  id: number;
  taskId: string;
  message: string;
  createdAt: string;
};

export type NotificationEvent = {
  id: number;
  type: string;
  actorProfileId: string;
  recipientProfileId: string;
  entityType: string;
  entityId: string;
  title: string;
  body: string;
  status: "pending" | "sent" | "failed" | "dismissed";
  createdAt: string;
};

export type NotificationDelivery = {
  id: number;
  eventId: number;
  channel: "google_chat" | "in_app" | "github";
  status: "pending" | "sent" | "failed";
  attempts: number;
  target: string;
  lastError: string;
  deliveredAt: string;
  createdAt: string;
};

export type FeedbackItem = {
  id: number;
  type: "bug" | "feature";
  status: "open" | "triaged" | "planned" | "done" | "dismissed";
  severity: "P0" | "P1" | "P2" | "P3";
  profileId: string;
  title: string;
  description: string;
  pageUrl: string;
  createdAt: string;
};

export type FmdTool = {
  id: string;
  name: string;
  category: "tool" | "repo" | "knowledge" | "asset";
  kind: string;
  description: string;
  url: string;
  owner: string;
  status: "active" | "planned" | "missing_link" | "archived";
  sortOrder: number;
};

export type Meeting = {
  id: number;
  sprintId: string;
  title: string;
  meetingAt: string;
  status: "planned" | "done" | "cancelled";
  agenda: string;
};

export type MeetingAttendanceStatus = "pending" | "present" | "excused" | "late_excused" | "unexcused" | "no_show";

export type MeetingAttendance = {
  id: number;
  meetingId: number;
  profileId: string;
  status: MeetingAttendanceStatus;
  absenceReason: string;
  reasonAccepted: boolean;
  writtenUpdate: string;
  points: number;
  createdAt: string;
  updatedAt: string;
};

export type AuditEntry = {
  id: number;
  entityType: string;
  entityId: string;
  action: string;
  actorProfileId: string;
  createdAt: string;
  beforeData?: Record<string, unknown> | null;
  afterData?: Record<string, unknown> | null;
};

export type AvailabilityEntry = {
  id: number;
  profileId: string;
  type: "working_hours" | "busy" | "vacation" | "sick";
  weekday: number | null;
  startDate: string;
  endDate: string;
  startTime: string;
  endTime: string;
  note: string;
};

export type PlanningData = {
  project: Project;
  profiles: Profile[];
  packages: Package[];
  milestones: Milestone[];
  tasks: Task[];
  sprints: Sprint[];
  sprintCommitments: SprintCommitment[];
  decisions: Decision[];
  decisionComments: DecisionComment[];
  taskComments: TaskComment[];
  taskExternalComments: TaskExternalComment[];
  taskBlockers: TaskBlocker[];
  taskRelations: TaskRelation[];
  taskActivity: TaskActivity[];
  notificationEvents: NotificationEvent[];
  notificationDeliveries: NotificationDelivery[];
  feedbackItems: FeedbackItem[];
  fmdTools: FmdTool[];
  meetings: Meeting[];
  meetingAttendance: MeetingAttendance[];
  audit: AuditEntry[];
  availability: AvailabilityEntry[];
};

export type ViewMode = "board" | "structure" | "table" | "gantt";
