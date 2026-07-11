import type { FounderSprintScore, FounderStrikeState, ScoreObjection, Sprint, SprintCommitment, StrikeEvent } from "./types";
import type { DbFounderSprintScore, DbFounderStrikeState, DbScoreObjection, DbSprint, DbSprintCommitment, DbStrikeEvent } from "./planning-data-row-types";

export function mapSprint(row: DbSprint): Sprint {
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

export function mapSprintCommitment(row: DbSprintCommitment): SprintCommitment {
  return {
    id: row.id,
    sprintId: row.sprint_id,
    profileId: row.profile_id,
    commitmentLevel: row.commitment_level,
    weeklyHours: row.weekly_hours,
    note: row.note || "",
  };
}

export function mapFounderSprintScore(row: DbFounderSprintScore): FounderSprintScore {
  return {
    id: row.id,
    sprintId: row.sprint_id,
    profileId: row.profile_id,
    deliveryPoints: row.delivery_points,
    formPoints: row.form_points,
    weeklyPoints: row.weekly_points,
    totalPoints: row.total_points,
    fulfilled: row.fulfilled,
    awayNeutral: row.away_neutral,
    finalizedAt: row.finalized_at,
    finalizedBy: row.finalized_by || "",
    reasonSummary: row.reason_summary || "",
  };
}

export function mapFounderStrikeState(row: DbFounderStrikeState): FounderStrikeState {
  return {
    id: row.id,
    profileId: row.profile_id,
    strikeLevel: row.strike_level,
    fulfilledResetStreak: row.fulfilled_reset_streak,
    lastEvaluatedSprintId: row.last_evaluated_sprint_id || "",
    updatedAt: row.updated_at,
  };
}

export function mapStrikeEvent(row: DbStrikeEvent): StrikeEvent {
  return {
    id: row.id,
    profileId: row.profile_id,
    sprintId: row.sprint_id,
    eventType: row.event_type,
    previousStrikeLevel: row.previous_strike_level,
    nextStrikeLevel: row.next_strike_level,
    reason: row.reason || "",
    createdAt: row.created_at,
    createdBy: row.created_by || "",
  };
}

export function mapScoreObjection(row: DbScoreObjection): ScoreObjection {
  return {
    id: row.id,
    sprintId: row.sprint_id,
    profileId: row.profile_id,
    founderSprintScoreId: row.founder_sprint_score_id,
    status: row.status,
    comment: row.comment,
    resolutionComment: row.resolution_comment || "",
    reviewedBy: row.reviewed_by || "",
    reviewedAt: row.reviewed_at || "",
    resolvedDeliveryPoints: row.resolved_delivery_points,
    resolvedFormPoints: row.resolved_form_points,
    resolvedWeeklyPoints: row.resolved_weekly_points,
    secondReviewerProfileId: row.second_reviewer_profile_id || "",
    secondReviewDecision: row.second_review_decision || "",
    secondReviewedAt: row.second_reviewed_at || "",
    createdAt: row.created_at,
  };
}
