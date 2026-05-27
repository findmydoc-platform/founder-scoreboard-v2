import { seedData } from "./generated/seed-data";
import { getServerSupabase } from "./supabase";
import type { AuditEntry, AvailabilityEntry, Decision, DecisionComment, DecisionTaskLink, FeedbackItem, FmdTool, Meeting, MeetingAttendance, Milestone, NotificationDelivery, NotificationEvent, NotificationPreference, Package, PlanningData, Profile, Sprint, SprintCommitment, Task, TaskActivity, TaskBlocker, TaskComment, TaskExternalComment, TaskFocusItem, TaskRelation } from "./types";

type DbProfile = {
  id: string;
  name: string;
  role: Profile["role"];
  platform_role: Profile["platformRole"] | null;
  org_role: string | null;
  github_login: string | null;
  deputy_for: string | null;
  deputy_active_from: string | null;
  deputy_active_until: string | null;
  focus: string | null;
  weekly_capacity: number;
  profile_color: string | null;
  google_chat_user_id: string | null;
  google_chat_dm_space: string | null;
  notifications_enabled: boolean | null;
};

type DbPackage = {
  id: string;
  milestone_id: string | null;
  title: string;
  goal: string | null;
  priority: string | null;
  sort_order: number;
};

type DbMilestone = {
  id: string;
  title: string;
  description: string | null;
  target_date: string | null;
  status: Milestone["status"];
  sort_order: number;
};

type DbTask = {
  id: string;
  sort_order: number;
  title: string;
  description: string | null;
  status: string;
  priority: string;
  owner: string | null;
  assignee: string | null;
  created_by: string | null;
  workstream: string | null;
  package_id: string | null;
  deadline: string | null;
  problem_statement: string | null;
  intended_outcome: string | null;
  scope_constraints: string | null;
  acceptance_criteria: string | null;
  evidence_required: string | null;
  dod_template_version: string | null;
  definition_of_done: string | null;
  evidence_link: string | null;
  issue_number: string | null;
  issue_url: string | null;
  watched: boolean | null;
  estimate_hours: number | null;
  start_date: string | null;
  end_date: string | null;
  sprint_id: string | null;
  milestone_id: string | null;
  review_status: Task["reviewStatus"] | null;
  score_points: number | null;
  score_final: boolean | null;
  github_repo: string | null;
  github_issue_number: number | null;
  github_issue_url: string | null;
  github_sync_status: Task["githubSyncStatus"] | null;
  github_last_synced_at: string | null;
  github_sync_error: string | null;
  task_type: Task["taskType"] | null;
  parent_task_id: string | null;
  score_relevant: boolean | null;
  original_sprint_id: string | null;
  carried_from_task_id: string | null;
  carried_from_sprint_id: string | null;
  carryover_reason: string | null;
  carryover_count: number | null;
  sprint_outcome: Task["sprintOutcome"] | null;
  self_dod_checked: boolean | null;
  self_evidence_checked: boolean | null;
  self_documented_checked: boolean | null;
  self_blockers_checked: boolean | null;
  task_dependencies?: { note: string }[];
  task_notes?: { note: string } | null;
};

type DbSprint = {
  id: string;
  name: string;
  status: Sprint["status"];
  start_date: string | null;
  end_date: string | null;
  review_due_at: string | null;
  score_locked: boolean;
};

type DbDecision = {
  id: number;
  title: string;
  context: string | null;
  decision: string | null;
  status: Decision["status"];
  required_profile_ids: string[] | null;
  created_by: string | null;
  locked_at: string | null;
  decision_confirmations?: { profile_id: string }[];
};

type DbSprintCommitment = {
  id: number;
  sprint_id: string;
  profile_id: string;
  commitment_level: SprintCommitment["commitmentLevel"];
  weekly_hours: number;
  note: string | null;
};

type DbAvailability = {
  id: number;
  profile_id: string;
  type: AvailabilityEntry["type"];
  weekday: number | null;
  start_date: string | null;
  end_date: string | null;
  start_time: string | null;
  end_time: string | null;
  note: string | null;
};

type DbAuditEntry = {
  id: number;
  entity_type: string;
  entity_id: string;
  action: string;
  actor_profile_id: string | null;
  created_at: string;
  before_data: Record<string, unknown> | null;
  after_data: Record<string, unknown> | null;
};

type DbDecisionComment = {
  id: number;
  decision_id: number;
  profile_id: string | null;
  type: DecisionComment["type"];
  comment: string;
  created_at: string;
};

type DbTaskComment = {
  id: number;
  task_id: string;
  profile_id: string | null;
  comment: string;
  created_at: string;
};

type DbTaskExternalComment = {
  id: number;
  task_id: string;
  source: TaskExternalComment["source"];
  external_id: string;
  author_login: string;
  author_avatar_url: string | null;
  body: string;
  html_url: string | null;
  created_at: string;
  imported_at: string;
};

type DbTaskBlocker = {
  id: number;
  task_id: string;
  profile_id: string | null;
  reason: string;
  impact: string | null;
  needs_help_from: string | null;
  status: TaskBlocker["status"];
  created_at: string;
  resolved_at: string | null;
};

type DbTaskRelation = {
  id: number;
  task_id: string;
  related_task_id: string;
  relation_type: TaskRelation["relationType"];
  note: string | null;
  created_by: string | null;
  created_at: string;
};

type DbTaskActivity = {
  id: number;
  task_id: string;
  message: string;
  created_at: string;
};

type DbTaskFocusItem = {
  id: number;
  profile_id: string | null;
  task_id: string;
  focus_date: string;
  position: number;
  next_step: string | null;
  status: TaskFocusItem["status"];
  created_at: string;
  updated_at: string;
};

type DbDecisionTaskLink = {
  id: number;
  decision_id: number;
  task_id: string;
  link_type: DecisionTaskLink["linkType"];
  note: string | null;
  created_by: string | null;
  created_at: string;
};

type DbNotificationEvent = {
  id: number;
  type: string;
  actor_profile_id: string | null;
  recipient_profile_id: string | null;
  entity_type: string;
  entity_id: string;
  title: string;
  body: string | null;
  status: NotificationEvent["status"];
  created_at: string;
};

type DbNotificationDelivery = {
  id: number;
  event_id: number;
  channel: NotificationDelivery["channel"];
  status: NotificationDelivery["status"];
  attempts: number;
  target: string | null;
  last_error: string | null;
  delivered_at: string | null;
  created_at: string;
};

type DbNotificationPreference = {
  id: number;
  profile_id: string;
  channel: NotificationPreference["channel"];
  event_type: string;
  enabled: boolean;
};

type DbFeedbackItem = {
  id: number;
  type: FeedbackItem["type"];
  status: FeedbackItem["status"];
  severity: FeedbackItem["severity"];
  profile_id: string | null;
  title: string;
  description: string;
  page_url: string | null;
  created_at: string;
};

type DbFmdTool = {
  id: string;
  name: string;
  category: FmdTool["category"];
  kind: string;
  description: string | null;
  url: string | null;
  owner: string | null;
  status: FmdTool["status"];
  sort_order: number;
};

type DbMeeting = {
  id: number;
  sprint_id: string;
  title: string;
  meeting_at: string;
  status: Meeting["status"];
  agenda: string | null;
};

type DbMeetingAttendance = {
  id: number;
  meeting_id: number;
  profile_id: string;
  status: MeetingAttendance["status"];
  absence_reason: string | null;
  reason_accepted: boolean;
  written_update: string | null;
  points: number;
  created_at: string;
  updated_at: string;
};

const fallbackProfileColors: Record<string, string> = {
  volkan: "#22c55e",
  sebastian: "#3b82f6",
  anil: "#f59e0b",
  ozen: "#8b5cf6",
  youssef: "#ec4899",
};

function profileColor(id: string, value?: string | null) {
  return value || fallbackProfileColors[id] || "#64748b";
}

export const emptyPlanningData: PlanningData = {
  project: {
    id: "findmydoc-founder-execution",
    name: "findmydoc Founder Execution",
    range: "Geschützter Teamzugriff",
  },
  profiles: [],
  packages: [],
  milestones: [],
  tasks: [],
  sprints: [],
  sprintCommitments: [],
  decisions: [],
  decisionComments: [],
  taskComments: [],
  taskExternalComments: [],
  taskBlockers: [],
  taskRelations: [],
  taskActivity: [],
  taskFocusItems: [],
  decisionTaskLinks: [],
  notificationEvents: [],
  notificationDeliveries: [],
  notificationPreferences: [],
  feedbackItems: [],
  fmdTools: [],
  meetings: [],
  meetingAttendance: [],
  audit: [],
  availability: [],
};

function mapProfile(row: DbProfile): Profile {
  return {
    id: row.id,
    name: row.name,
    role: row.role,
    platformRole: row.platform_role || (row.role === "admin" ? "ceo" : "founder"),
    orgRole: row.org_role || (row.role === "admin" ? "CEO" : "Founder"),
    githubLogin: row.github_login || "",
    deputyFor: row.deputy_for || "",
    deputyActiveFrom: row.deputy_active_from || "",
    deputyActiveUntil: row.deputy_active_until || "",
    focus: row.focus || "",
    weeklyCapacity: row.weekly_capacity,
    color: profileColor(row.id, row.profile_color),
    googleChatUserId: row.google_chat_user_id || "",
    googleChatDmSpace: row.google_chat_dm_space || "",
    notificationsEnabled: row.notifications_enabled !== false,
  };
}

function mapPackage(row: DbPackage): Package {
  return {
    id: row.id,
    milestoneId: row.milestone_id || "",
    title: row.title,
    goal: row.goal || "",
    priority: row.priority || "P2",
    sortOrder: row.sort_order,
  };
}

function mapMilestone(row: DbMilestone): Milestone {
  return {
    id: row.id,
    title: row.title,
    description: row.description || "",
    targetDate: row.target_date || "",
    status: row.status,
    sortOrder: row.sort_order,
  };
}

function mapTask(row: DbTask, profiles: Profile[]): Task {
  const owner = profiles.find((profile) => profile.id === row.owner)?.name || row.owner || "Unassigned";
  const assignee = profiles.find((profile) => profile.id === row.assignee)?.name || row.assignee || owner;
  const createdBy = profiles.find((profile) => profile.id === row.created_by)?.name || row.created_by || "";

  return {
    id: row.id,
    order: row.sort_order,
    title: row.title,
    description: row.description || "",
    status: row.status,
    priority: row.priority,
    owner,
    assignee,
    createdBy,
    workstream: row.workstream || "",
    packageId: row.package_id || "",
    deadline: row.deadline || "",
    problemStatement: row.problem_statement || "",
    intendedOutcome: row.intended_outcome || "",
    scopeConstraints: row.scope_constraints || "",
    acceptanceCriteria: row.acceptance_criteria || "",
    evidenceRequired: row.evidence_required || "",
    dodTemplateVersion: row.dod_template_version || "founder-deliverable-v2",
    definitionOfDone: row.definition_of_done || "",
    dependsOn: row.task_dependencies?.map((item) => item.note).join("; ") || "",
    evidenceLink: row.evidence_link || "",
    issueNumber: row.issue_number || "",
    issueUrl: row.issue_url || "",
    note: row.task_notes?.note || "",
    watched: Boolean(row.watched),
    hours: row.estimate_hours || 0,
    startDate: row.start_date || "",
    endDate: row.end_date || "",
    sprintId: row.sprint_id || "sprint-1",
    milestoneId: row.milestone_id || "",
    reviewStatus: row.review_status || "not_requested",
    scorePoints: row.score_points || 0,
    scoreFinal: Boolean(row.score_final),
    githubRepo: row.github_repo || "findmydoc-platform/management",
    githubIssueNumber: row.github_issue_number,
    githubIssueUrl: row.github_issue_url || row.issue_url || "",
    githubSyncStatus: row.github_sync_status || "not_synced",
    githubLastSyncedAt: row.github_last_synced_at || "",
    githubSyncError: row.github_sync_error || "",
    taskType: row.task_type || "deliverable",
    parentTaskId: row.parent_task_id || "",
    scoreRelevant: row.score_relevant !== false,
    originalSprintId: row.original_sprint_id || "",
    carriedFromTaskId: row.carried_from_task_id || "",
    carriedFromSprintId: row.carried_from_sprint_id || "",
    carryoverReason: row.carryover_reason || "",
    carryoverCount: row.carryover_count || 0,
    sprintOutcome: row.sprint_outcome || "",
    selfDodChecked: Boolean(row.self_dod_checked),
    selfEvidenceChecked: Boolean(row.self_evidence_checked),
    selfDocumentedChecked: Boolean(row.self_documented_checked),
    selfBlockersChecked: Boolean(row.self_blockers_checked),
  };
}

function mapSprint(row: DbSprint): Sprint {
  return {
    id: row.id,
    name: row.name,
    status: row.status,
    startDate: row.start_date || "",
    endDate: row.end_date || "",
    reviewDueAt: row.review_due_at || "",
    scoreLocked: row.score_locked,
  };
}

function mapDecision(row: DbDecision): Decision {
  return {
    id: row.id,
    title: row.title,
    context: row.context || "",
    decision: row.decision || "",
    status: row.status,
    requiredProfileIds: row.required_profile_ids || [],
    confirmedProfileIds: row.decision_confirmations?.map((item) => item.profile_id) || [],
    createdBy: row.created_by || "",
    lockedAt: row.locked_at || "",
  };
}

function mapSprintCommitment(row: DbSprintCommitment): SprintCommitment {
  return {
    id: row.id,
    sprintId: row.sprint_id,
    profileId: row.profile_id,
    commitmentLevel: row.commitment_level,
    weeklyHours: row.weekly_hours,
    note: row.note || "",
  };
}

function mapAvailability(row: DbAvailability): AvailabilityEntry {
  return {
    id: row.id,
    profileId: row.profile_id,
    type: row.type,
    weekday: row.weekday,
    startDate: row.start_date || "",
    endDate: row.end_date || "",
    startTime: row.start_time || "",
    endTime: row.end_time || "",
    note: row.note || "",
  };
}

function mapAuditEntry(row: DbAuditEntry): AuditEntry {
  return {
    id: row.id,
    entityType: row.entity_type,
    entityId: row.entity_id,
    action: row.action,
    actorProfileId: row.actor_profile_id || "",
    createdAt: row.created_at,
    beforeData: row.before_data,
    afterData: row.after_data,
  };
}

function mapDecisionComment(row: DbDecisionComment): DecisionComment {
  return {
    id: row.id,
    decisionId: row.decision_id,
    profileId: row.profile_id || "",
    type: row.type,
    comment: row.comment,
    createdAt: row.created_at,
  };
}

function mapTaskComment(row: DbTaskComment): TaskComment {
  return {
    id: row.id,
    taskId: row.task_id,
    profileId: row.profile_id || "",
    comment: row.comment,
    createdAt: row.created_at,
  };
}

function mapTaskExternalComment(row: DbTaskExternalComment): TaskExternalComment {
  return {
    id: row.id,
    taskId: row.task_id,
    source: row.source,
    externalId: row.external_id,
    authorLogin: row.author_login,
    authorAvatarUrl: row.author_avatar_url || "",
    body: row.body,
    htmlUrl: row.html_url || "",
    createdAt: row.created_at,
    importedAt: row.imported_at,
  };
}

function mapTaskBlocker(row: DbTaskBlocker): TaskBlocker {
  return {
    id: row.id,
    taskId: row.task_id,
    profileId: row.profile_id || "",
    reason: row.reason,
    impact: row.impact || "",
    needsHelpFrom: row.needs_help_from || "",
    status: row.status,
    createdAt: row.created_at,
    resolvedAt: row.resolved_at || "",
  };
}

function mapTaskRelation(row: DbTaskRelation): TaskRelation {
  return {
    id: row.id,
    taskId: row.task_id,
    relatedTaskId: row.related_task_id,
    relationType: row.relation_type,
    note: row.note || "",
    createdBy: row.created_by || "",
    createdAt: row.created_at,
  };
}

function mapTaskActivity(row: DbTaskActivity): TaskActivity {
  return {
    id: row.id,
    taskId: row.task_id,
    message: row.message,
    createdAt: row.created_at,
  };
}

function mapTaskFocusItem(row: DbTaskFocusItem): TaskFocusItem {
  return {
    id: row.id,
    profileId: row.profile_id || "",
    taskId: row.task_id,
    focusDate: row.focus_date,
    position: row.position,
    nextStep: row.next_step || "",
    status: row.status,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function mapDecisionTaskLink(row: DbDecisionTaskLink): DecisionTaskLink {
  return {
    id: row.id,
    decisionId: row.decision_id,
    taskId: row.task_id,
    linkType: row.link_type,
    note: row.note || "",
    createdBy: row.created_by || "",
    createdAt: row.created_at,
  };
}

function mapNotificationEvent(row: DbNotificationEvent): NotificationEvent {
  return {
    id: row.id,
    type: row.type,
    actorProfileId: row.actor_profile_id || "",
    recipientProfileId: row.recipient_profile_id || "",
    entityType: row.entity_type,
    entityId: row.entity_id,
    title: row.title,
    body: row.body || "",
    status: row.status,
    createdAt: row.created_at,
  };
}

function mapNotificationDelivery(row: DbNotificationDelivery): NotificationDelivery {
  return {
    id: row.id,
    eventId: row.event_id,
    channel: row.channel,
    status: row.status,
    attempts: row.attempts,
    target: row.target || "",
    lastError: row.last_error || "",
    deliveredAt: row.delivered_at || "",
    createdAt: row.created_at,
  };
}

function mapNotificationPreference(row: DbNotificationPreference): NotificationPreference {
  return {
    id: row.id,
    profileId: row.profile_id,
    channel: row.channel,
    eventType: row.event_type,
    enabled: row.enabled,
  };
}

function mapFeedbackItem(row: DbFeedbackItem): FeedbackItem {
  return {
    id: row.id,
    type: row.type,
    status: row.status,
    severity: row.severity,
    profileId: row.profile_id || "",
    title: row.title,
    description: row.description,
    pageUrl: row.page_url || "",
    createdAt: row.created_at,
  };
}

function mapFmdTool(row: DbFmdTool): FmdTool {
  return {
    id: row.id,
    name: row.name,
    category: row.category,
    kind: row.kind,
    description: row.description || "",
    url: row.url || "",
    owner: row.owner || "",
    status: row.status,
    sortOrder: row.sort_order,
  };
}

function mapMeeting(row: DbMeeting): Meeting {
  return {
    id: row.id,
    sprintId: row.sprint_id,
    title: row.title,
    meetingAt: row.meeting_at,
    status: row.status,
    agenda: row.agenda || "",
  };
}

function mapMeetingAttendance(row: DbMeetingAttendance): MeetingAttendance {
  return {
    id: row.id,
    meetingId: row.meeting_id,
    profileId: row.profile_id,
    status: row.status,
    absenceReason: row.absence_reason || "",
    reasonAccepted: row.reason_accepted,
    writtenUpdate: row.written_update || "",
    points: row.points,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export async function getPlanningData(): Promise<{ data: PlanningData; source: "seed" | "supabase" }> {
  const supabase = getServerSupabase();
  if (!supabase) return { data: seedData, source: "seed" };

  const [projectResult, profileResult, packageResult, milestoneResult, taskResult, sprintResult, sprintCommitmentResult, decisionResult, commentResult, taskCommentResult, taskExternalCommentResult, taskBlockerResult, taskRelationResult, taskActivityResult, taskFocusResult, decisionTaskLinkResult, notificationResult, notificationDeliveryResult, notificationPreferenceResult, feedbackResult, fmdToolResult, meetingResult, meetingAttendanceResult, auditResult, availabilityResult] = await Promise.all([
    supabase.from("projects").select("id,name,range_label").eq("id", "findmydoc-founder-execution").single(),
    supabase.from("profiles").select("id,name,role,platform_role,org_role,github_login,deputy_for,deputy_active_from,deputy_active_until,focus,weekly_capacity,profile_color,google_chat_user_id,google_chat_dm_space,notifications_enabled").order("name"),
    supabase.from("packages").select("id,milestone_id,title,goal,priority,sort_order").order("sort_order"),
    supabase.from("milestones").select("id,title,description,target_date,status,sort_order").eq("project_id", "findmydoc-founder-execution").order("sort_order"),
    supabase
      .from("tasks")
      .select("*, task_dependencies(note), task_notes(note)")
      .eq("project_id", "findmydoc-founder-execution")
      .order("sort_order"),
    supabase.from("sprints").select("id,name,status,start_date,end_date,review_due_at,score_locked").order("start_date"),
    supabase.from("sprint_commitments").select("id,sprint_id,profile_id,commitment_level,weekly_hours,note").order("profile_id"),
    supabase.from("decision_log").select("id,title,context,decision,status,required_profile_ids,created_by,locked_at,decision_confirmations(profile_id)").order("created_at", { ascending: false }),
    supabase.from("decision_comments").select("id,decision_id,profile_id,type,comment,created_at").order("created_at", { ascending: false }).limit(100),
    supabase.from("task_comments").select("id,task_id,profile_id,comment,created_at").order("created_at", { ascending: false }).limit(200),
    supabase.from("task_external_comments").select("id,task_id,source,external_id,author_login,author_avatar_url,body,html_url,created_at,imported_at").order("created_at", { ascending: false }).limit(300),
    supabase.from("task_blockers").select("id,task_id,profile_id,reason,impact,needs_help_from,status,created_at,resolved_at").order("created_at", { ascending: false }).limit(200),
    supabase.from("task_relationship_edges").select("id,task_id,related_task_id,relation_type,note,created_by,created_at").order("created_at", { ascending: false }).limit(500),
    supabase.from("task_activity").select("id,task_id,message,created_at").order("created_at", { ascending: true }).limit(500),
    supabase.from("task_focus_items").select("id,profile_id,task_id,focus_date,position,next_step,status,created_at,updated_at").order("focus_date", { ascending: false }).order("position").limit(500),
    supabase.from("decision_task_links").select("id,decision_id,task_id,link_type,note,created_by,created_at").order("created_at", { ascending: false }).limit(500),
    supabase.from("notification_events").select("id,type,actor_profile_id,recipient_profile_id,entity_type,entity_id,title,body,status,created_at").order("created_at", { ascending: false }).limit(100),
    supabase.from("notification_deliveries").select("id,event_id,channel,status,attempts,target,last_error,delivered_at,created_at").order("created_at", { ascending: false }).limit(100),
    supabase.from("notification_preferences").select("id,profile_id,channel,event_type,enabled").eq("channel", "google_chat").order("profile_id"),
    supabase.from("feedback_items").select("id,type,status,severity,profile_id,title,description,page_url,created_at").order("created_at", { ascending: false }).limit(100),
    supabase.from("fmd_tools").select("id,name,category,kind,description,url,owner,status,sort_order").order("sort_order"),
    supabase.from("meetings").select("id,sprint_id,title,meeting_at,status,agenda").order("meeting_at", { ascending: false }).limit(100),
    supabase.from("meeting_attendance").select("id,meeting_id,profile_id,status,absence_reason,reason_accepted,written_update,points,created_at,updated_at").order("updated_at", { ascending: false }).limit(300),
    supabase.from("audit_log").select("id,entity_type,entity_id,action,actor_profile_id,created_at,before_data,after_data").eq("entity_type", "decision").order("created_at", { ascending: false }).limit(100),
    supabase.from("availability").select("id,profile_id,type,weekday,start_date,end_date,start_time,end_time,note").order("start_date"),
  ]);

  if (projectResult.error || profileResult.error || packageResult.error || taskResult.error) {
    return { data: seedData, source: "seed" };
  }

  const profiles = (profileResult.data as DbProfile[]).map(mapProfile);

  return {
    source: "supabase",
    data: {
      project: {
        id: projectResult.data.id,
        name: projectResult.data.name,
        range: projectResult.data.range_label || "",
      },
      profiles,
      packages: (packageResult.data as DbPackage[]).map(mapPackage),
      milestones: milestoneResult.error ? [] : (milestoneResult.data as DbMilestone[]).map(mapMilestone),
      tasks: (taskResult.data as DbTask[]).map((row) => mapTask(row, profiles)),
      sprints: sprintResult.error ? seedData.sprints : (sprintResult.data as DbSprint[]).map(mapSprint),
      sprintCommitments: sprintCommitmentResult.error ? [] : (sprintCommitmentResult.data as DbSprintCommitment[]).map(mapSprintCommitment),
      decisions: decisionResult.error ? [] : (decisionResult.data as DbDecision[]).map(mapDecision),
      decisionComments: commentResult.error ? [] : (commentResult.data as DbDecisionComment[]).map(mapDecisionComment),
      taskComments: taskCommentResult.error ? [] : (taskCommentResult.data as DbTaskComment[]).map(mapTaskComment),
      taskExternalComments: taskExternalCommentResult.error ? [] : (taskExternalCommentResult.data as DbTaskExternalComment[]).map(mapTaskExternalComment),
      taskBlockers: taskBlockerResult.error ? [] : (taskBlockerResult.data as DbTaskBlocker[]).map(mapTaskBlocker),
      taskRelations: taskRelationResult.error ? [] : (taskRelationResult.data as DbTaskRelation[]).map(mapTaskRelation),
      taskActivity: taskActivityResult.error ? [] : (taskActivityResult.data as DbTaskActivity[]).map(mapTaskActivity),
      taskFocusItems: taskFocusResult.error ? [] : (taskFocusResult.data as DbTaskFocusItem[]).map(mapTaskFocusItem),
      decisionTaskLinks: decisionTaskLinkResult.error ? [] : (decisionTaskLinkResult.data as DbDecisionTaskLink[]).map(mapDecisionTaskLink),
      notificationEvents: notificationResult.error ? [] : (notificationResult.data as DbNotificationEvent[]).map(mapNotificationEvent),
      notificationDeliveries: notificationDeliveryResult.error ? [] : (notificationDeliveryResult.data as DbNotificationDelivery[]).map(mapNotificationDelivery),
      notificationPreferences: notificationPreferenceResult.error ? [] : (notificationPreferenceResult.data as DbNotificationPreference[]).map(mapNotificationPreference),
      feedbackItems: feedbackResult.error ? [] : (feedbackResult.data as DbFeedbackItem[]).map(mapFeedbackItem),
      fmdTools: fmdToolResult.error ? [] : (fmdToolResult.data as DbFmdTool[]).map(mapFmdTool),
      meetings: meetingResult.error ? [] : (meetingResult.data as DbMeeting[]).map(mapMeeting),
      meetingAttendance: meetingAttendanceResult.error ? [] : (meetingAttendanceResult.data as DbMeetingAttendance[]).map(mapMeetingAttendance),
      audit: auditResult.error ? [] : (auditResult.data as DbAuditEntry[]).map(mapAuditEntry),
      availability: availabilityResult.error ? [] : (availabilityResult.data as DbAvailability[]).map(mapAvailability),
    },
  };
}
