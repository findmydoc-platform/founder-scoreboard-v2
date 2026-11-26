import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import type { SupabaseClient } from "@supabase/supabase-js";
import type { DeliverableReviewBasis, DeliverableReviewBasisResult } from "@/features/reviews/model/deliverable-review-basis";
import type { PlatformRole } from "@/lib/types";

export type ReviewBasisActor = Readonly<{
  userId: string;
  sessionId: string;
  profileId: string;
  role: PlatformRole;
  deadline: number;
  key: string;
}>;

export type ReviewDecisionFence = Readonly<{
  actor: ReviewBasisActor;
  taskUpdatedAt: string;
  sourceRevision: string;
  validUntil: string;
  deadline: number;
}>;

type SignedBasis = Readonly<{
  taskId: string;
  taskUpdatedAt: string;
  sourceRevision: string;
  evaluatedAt: string;
  validUntil: string;
  deadline: number;
}>;

type Publication = {
  read(signal?: AbortSignal): Promise<{ status: "ready"; revision: string } | { status: "forbidden" | "unavailable" }>;
};

const timestamp = (value: unknown): value is string => typeof value === "string" && Number.isFinite(Date.parse(value));
const reasons = new Set(["inactive", "notApproved", "sprintLocked", "evidenceRequired"]);
type BlockedReason = Extract<DeliverableReviewBasis["decision"], { status: "blocked" }>["reason"];

type RawBasis = {
  status: "ready" | "forbidden" | "notFound" | "unavailable";
  taskUpdatedAt: string;
  sourceRevision: string;
  evaluatedAt: string;
  validUntil: string;
  hasEvidence: boolean;
  hasException: boolean;
  exceptionNote: string | null;
  evidenceLinks: DeliverableReviewBasis["evidence"]["links"];
  sprintId: string | null;
  sprintLocked: boolean;
  blockedReason: BlockedReason | null;
};

function sign(actor: ReviewBasisActor, basis: SignedBasis) {
  return createHmac("sha256", actor.key).update(JSON.stringify([
    "deliverable-review-basis-v1", actor.userId, actor.sessionId, actor.profileId, actor.role, basis,
  ])).digest("hex");
}

function encode(actor: ReviewBasisActor, basis: SignedBasis) {
  return Buffer.from(JSON.stringify({ ...basis, signature: sign(actor, basis) })).toString("base64url");
}

export function readReviewDecisionFence(actor: ReviewBasisActor, token: string, taskId: string, taskUpdatedAt?: string): ReviewDecisionFence | null {
  try {
    if (token.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(token)) return null;
    const { signature, ...basis } = JSON.parse(Buffer.from(token, "base64url").toString()) as SignedBasis & { signature: string };
    const now = Date.now();
    if (basis.taskId !== taskId || (taskUpdatedAt && basis.taskUpdatedAt !== taskUpdatedAt) || !timestamp(basis.taskUpdatedAt)
      || typeof basis.sourceRevision !== "string" || !basis.sourceRevision
      || !timestamp(basis.evaluatedAt) || Date.parse(basis.evaluatedAt) > now || !timestamp(basis.validUntil) || Date.parse(basis.validUntil) <= now
      || !Number.isSafeInteger(basis.deadline) || basis.deadline <= now || actor.deadline <= now
      || typeof signature !== "string" || !/^[a-f0-9]{64}$/.test(signature)
      || !timingSafeEqual(Buffer.from(signature, "hex"), Buffer.from(sign(actor, basis), "hex"))) return null;
    return { actor, taskUpdatedAt: basis.taskUpdatedAt, sourceRevision: basis.sourceRevision, validUntil: basis.validUntil, deadline: Math.min(actor.deadline, basis.deadline) };
  } catch {
    return null;
  }
}

export async function readPlanningDeliverableReviewBasis(
  service: SupabaseClient, publication: Publication, actor: ReviewBasisActor, taskId: string, signal?: AbortSignal,
): Promise<DeliverableReviewBasisResult> {
  if (actor.deadline <= Date.now()) return { status: "forbidden" };
  try {
    const request = service.rpc("planning_deliverable_review_basis", {
      p_task_id: taskId, p_actor_profile_id: actor.profileId, p_actor_user_id: actor.userId,
      p_session_id: actor.sessionId, p_platform_role: actor.role, p_deadline: new Date(actor.deadline).toISOString(),
    });
    const result = await (signal ? request.abortSignal(signal) : request);
    if (result.status === 401 || result.status === 403 || actor.deadline <= Date.now()) return { status: "forbidden" };
    if (result.error || signal?.aborted) return { status: "unavailable" };
    const row = result.data as RawBasis | null;
    if (row?.status === "forbidden" || row?.status === "notFound") return { status: row.status };
    if (row?.status !== "ready" || !timestamp(row.taskUpdatedAt) || !timestamp(row.evaluatedAt) || !timestamp(row.validUntil)
      || typeof row.sourceRevision !== "string" || !row.sourceRevision || typeof row.hasEvidence !== "boolean"
      || typeof row.hasException !== "boolean"
      || (row.hasException ? typeof row.exceptionNote !== "string" || !row.exceptionNote.trim() : row.exceptionNote !== null)
      || !Array.isArray(row.evidenceLinks) || row.hasEvidence !== (row.evidenceLinks.length > 0)
      || row.evidenceLinks.some(link => !link || typeof link.taskId !== "string" || !link.taskId
        || typeof link.title !== "string" || typeof link.url !== "string" || !/^https?:\/\//i.test(link.url)
        || link.kind !== "evidence" && link.kind !== "github_pull_request")
      || typeof row.sprintLocked !== "boolean"
      || (row.sprintId !== null && typeof row.sprintId !== "string")
      || (row.blockedReason !== null && !reasons.has(row.blockedReason))) return { status: "unavailable" };
    const current = await publication.read(signal);
    if (actor.deadline <= Date.now() || current.status === "forbidden") return { status: "forbidden" };
    if (signal?.aborted || current.status !== "ready") return { status: "unavailable" };
    if (current.revision !== row.sourceRevision || Date.parse(row.validUntil) <= Date.now()) return { status: "stale" };

    const { taskUpdatedAt, sourceRevision, evaluatedAt, validUntil } = row;
    const basis = { taskId, taskUpdatedAt, sourceRevision, evaluatedAt, validUntil, deadline: actor.deadline };
    return { status: "ready", basis: {
      taskId, taskUpdatedAt, sourceRevision, evaluatedAt, validUntil,
      readAuthority: { userId: actor.userId, deadline: actor.deadline },
      readActor: { profileId: actor.profileId, platformRole: actor.role },
      evidence: { status: row.hasEvidence ? "present" : "absent", hasException: row.hasException,
        exceptionNote: row.exceptionNote, links: row.evidenceLinks },
      sprintLock: { sprintId: row.sprintId, locked: row.sprintLocked },
      decision: row.blockedReason
        ? { status: "blocked", reason: row.blockedReason }
        : { status: "allowed", token: encode(actor, basis) },
    } };
  } catch {
    return { status: "unavailable" };
  }
}
