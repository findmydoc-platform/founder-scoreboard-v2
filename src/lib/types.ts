export type Role = "admin" | "member" | "viewer";
export type PlatformRole = "ceo" | "founder" | "deputy" | "viewer";
export type ReviewStatus = "not_requested" | "requested" | "accepted" | "partial" | "changes_requested";
export type GitHubIssueSyncStatus = "not_synced" | "synced" | "pending" | "failed";
export type GitHubCommentDeliveryStatus = "pending" | "waiting_for_issue" | "waiting_for_author_connection" | "processing" | "retry_scheduled" | "delivered" | "failed";
export type CommitmentLevel = "Lite" | "Standard" | "Heavy" | "Away";
export type StrikeEventType = "strike_added" | "strike_reset" | "away_neutral" | "fulfilled_no_change" | "governance_review_required";
export type ScoreObjectionStatus = "open" | "reviewed" | "dismissed" | "accepted";
export type ApprovalStatus = "draft" | "proposed" | "approved" | "rejected";
export type ApprovalDecisionAction = "approve" | "reject" | "return_to_draft";
export type TaskType = "deliverable" | "sub_issue";
export type TaskRelationType = "blocked_by" | "blocks" | "relates_to";
export type TrashCause = "withdrawn" | "rejected";
export type TrashRootType = "initiative" | "deliverable";

export type TaskStatus = "Offen" | "In Arbeit" | "Review" | "Nacharbeit" | "Blockiert" | "Erledigt";

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
  ownerId?: string;
  accountableProfileId?: string;
  responsibleProfileIds?: string[];
  consultedProfileIds?: string[];
  informedProfileIds?: string[];
  title: string;
  goal: string;
  priority: string;
  status?: "planned" | "active" | "done" | "paused";
  targetDate?: string;
  successCriteria?: string;
  scopeConstraints?: string;
  sortOrder: number;
  approvalStatus: ApprovalStatus;
  approvalRevision: number;
  proposedById?: string;
  proposedAt?: string;
  decidedById?: string;
  decidedAt?: string;
  decisionNote?: string;
  trashedAt?: string;
  trashedById?: string;
  trashReason?: string;
  trashCause?: TrashCause;
  purgeAfter?: string;
  trashRootType?: TrashRootType;
  trashRootId?: string;
  trashRevision?: number;
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
  assigneeId?: string;
  assignee: string;
  ownerId?: string;
  owner: string;
  createdById?: string;
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
  reviewOwnerProfileId?: string;
  reviewRequestedAt?: string;
  scorePoints: number;
  scoreFinal: boolean;
  githubRepo: string;
  githubIssueNumber: number | null;
  githubIssueUrl: string;
  githubIssueSyncStatus: GitHubIssueSyncStatus;
  githubIssueLastSyncedAt: string;
  githubIssueSyncError: string;
  githubIssueSyncPendingSince?: string;
  taskType: TaskType;
  parentTaskId: string;
  approvalStatus: ApprovalStatus | null;
  approvalRevision: number;
  proposedById?: string;
  proposedAt?: string;
  decidedById?: string;
  decidedAt?: string;
  decisionNote?: string;
  parentApprovalStatus: ApprovalStatus | null;
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
  updatedAt?: string;
  trashedAt?: string;
  trashedById?: string;
  trashReason?: string;
  trashCause?: TrashCause;
  purgeAfter?: string;
  trashRootType?: TrashRootType;
  trashRootId?: string;
  trashRevision?: number;
};

export type AuthenticatedProfile = Pick<Profile, "id" | "name" | "platformRole" | "githubLogin">;

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

export type FounderSprintScore = {
  id: number;
  sprintId: string;
  profileId: string;
  deliveryPoints: number;
  formPoints: number;
  weeklyPoints: number;
  totalPoints: number;
  fulfilled: boolean;
  awayNeutral: boolean;
  finalizedAt: string;
  finalizedBy: string;
  reasonSummary: string;
};

export type FounderStrikeState = {
  id: number;
  profileId: string;
  strikeLevel: number;
  fulfilledResetStreak: number;
  lastEvaluatedSprintId: string;
  updatedAt: string;
};

export type StrikeEvent = {
  id: number;
  profileId: string;
  sprintId: string;
  eventType: StrikeEventType;
  previousStrikeLevel: number;
  nextStrikeLevel: number;
  reason: string;
  createdAt: string;
  createdBy: string;
};

export type ScoreObjection = {
  id: number;
  sprintId: string;
  profileId: string;
  founderSprintScoreId: number | null;
  status: ScoreObjectionStatus;
  comment: string;
  resolutionComment: string;
  reviewedBy: string;
  reviewedAt: string;
  resolvedDeliveryPoints: number | null;
  resolvedFormPoints: number | null;
  resolvedWeeklyPoints: number | null;
  secondReviewerProfileId: string;
  secondReviewDecision: string;
  secondReviewedAt: string;
  createdAt: string;
};

export type ScoreObjectionResolutionInput = {
  action: "resolve" | "second_review";
  status?: "reviewed" | "dismissed" | "accepted";
  resolutionComment?: string;
  deliveryPoints?: number;
  formPoints?: number;
  weeklyPoints?: number;
  secondReviewDecision?: string;
};

export type TaskComment = {
  id: number;
  taskId: string;
  profileId: string;
  comment: string;
  githubDeliveryStatus: GitHubCommentDeliveryStatus;
  githubCommentUrl: string;
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

export type TaskFocusItem = {
  id: number;
  profileId: string;
  taskId: string;
  focusDate: string;
  position: number;
  nextStep: string;
  status: "planned" | "done" | "blocked" | "deferred" | "needs_decision";
  createdAt: string;
  updatedAt: string;
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
  status: "pending" | "sent" | "failed" | "dismissed" | "resolved";
  seenAt: string;
  dismissedAt: string;
  resolvedAt: string;
  resolutionReason: string;
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
  deliveryMode: "direct_dm" | "webhook_digest" | "";
  digestSize: number;
  deliveredAt: string;
  createdAt: string;
};

export type NotificationPreference = {
  id: number;
  profileId: string;
  channel: "google_chat" | "in_app" | "github";
  eventType: string;
  enabled: boolean;
};

export type PlanningFilterPreferences = {
  query: string;
  assignee: string;
  status: string;
  priority: string;
  packageId: string;
  quick: string[];
  sprintId: string;
  workstream: string;
  risk: string;
  targetFrom: string;
  targetTo: string;
  sort: string;
  direction: "asc" | "desc";
};

export type ProfileUiPreference = {
  profileId: string;
  defaultWorkspace: string;
  defaultTaskView: ViewMode;
  planningFilters: PlanningFilterPreferences;
  expandedPackageIds: string[];
  createdAt: string;
  updatedAt: string;
};

export type ProfileFeatureTourAcknowledgement = {
  profileId: string;
  tourId: string;
  seenAt: string;
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
  isCurated: boolean;
  previewImageUrl: string;
  previewImageSource: "none" | "og" | "manual";
  sortOrder: number;
};

export type FounderEvent = {
  id: number;
  title: string;
  category: "conference" | "legal" | "company" | "travel" | "deadline" | "other";
  startsAt: string;
  endsAt: string;
  location: string;
  description: string;
  audienceMode: "all" | "selected";
  participantProfileIds: string[];
  reminderDaysBefore: number;
  reminderGeneratedAt: string;
  status: "planned" | "done" | "cancelled";
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type HeaderQuickLink = Pick<FmdTool, "id" | "name" | "category" | "url" | "previewImageUrl">;

export type HeaderCalendarEvent = Pick<FounderEvent, "id" | "title" | "category" | "startsAt" | "endsAt" | "location" | "status">;

export type HeaderNotification = Pick<NotificationEvent, "id" | "type" | "actorProfileId" | "recipientProfileId" | "entityType" | "entityId" | "title" | "body" | "createdAt">;

export type HeaderDataSlot<T> = {
  state: "idle" | "loading" | "ready" | "error";
  data: T;
  loadedAt?: string;
  error?: string;
};

export type HeaderNotificationsData = {
  unreadCount: number;
  items: HeaderNotification[];
};

export type PlanningHeaderData = {
  quickLinks: HeaderDataSlot<HeaderQuickLink[]>;
  calendarEvents: HeaderDataSlot<HeaderCalendarEvent[]>;
  notifications: HeaderDataSlot<HeaderNotificationsData>;
};

export type Meeting = {
  id: number;
  sprintId: string;
  title: string;
  meetingAt: string;
  durationMinutes?: number;
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

export type PlanningData = {
  project: Project;
  profiles: Profile[];
  packages: Package[];
  milestones: Milestone[];
  tasks: Task[];
  sprints: Sprint[];
  sprintCommitments: SprintCommitment[];
  founderSprintScores: FounderSprintScore[];
  founderStrikeStates: FounderStrikeState[];
  strikeEvents: StrikeEvent[];
  scoreObjections: ScoreObjection[];
  taskComments: TaskComment[];
  taskExternalComments: TaskExternalComment[];
  taskBlockers: TaskBlocker[];
  taskRelations: TaskRelation[];
  taskActivity: TaskActivity[];
  taskFocusItems: TaskFocusItem[];
  notificationEvents: NotificationEvent[];
  notificationDeliveries: NotificationDelivery[];
  notificationPreferences: NotificationPreference[];
  profileUiPreferences: ProfileUiPreference[];
  profileFeatureTourAcknowledgements: ProfileFeatureTourAcknowledgement[];
  fmdTools: FmdTool[];
  events: FounderEvent[];
  meetings: Meeting[];
  meetingAttendance: MeetingAttendance[];
  audit: AuditEntry[];
};

export type PlanningDataResponse = {
  data: PlanningData;
  headerData: PlanningHeaderData;
  source: "seed" | "supabase";
  availability: "ready" | "unavailable";
  currentProfile: AuthenticatedProfile | null;
};

export type ViewMode = "board" | "structure" | "table" | "gantt";
