import "server-only";
import { createHmac, timingSafeEqual } from "node:crypto";
import type { NotificationInboxPosition } from "../model/notifications-read-model";

type Cursor = NotificationInboxPosition & { source: string; observedAt: string; validUntil: string; deadline: number };
type Binding = { secret: string; token: string; userId: string; profileId: string; platformRole: string };

function signature(binding: Binding, cursor: Cursor) {
  return createHmac("sha256", binding.secret).update(JSON.stringify(["notification-inbox-v1", binding.token, binding.userId, binding.profileId,
    binding.platformRole, 40, cursor.createdAt, cursor.id, cursor.source, cursor.observedAt, cursor.validUntil, cursor.deadline])).digest("hex");
}

export function createNotificationContinuation(binding: Binding, cursor: Cursor) {
  return Buffer.from(JSON.stringify({ ...cursor, signature: signature(binding, cursor) })).toString("base64url");
}

export function readNotificationContinuation(binding: Binding, input: string): Cursor | null {
  try {
    if (!input || input.length > 4096 || !/^[A-Za-z0-9_-]+$/.test(input)) return null;
    const { signature: supplied, ...cursor } = JSON.parse(Buffer.from(input, "base64url").toString("utf8"));
    if (typeof supplied !== "string" || !/^[a-f0-9]{64}$/.test(supplied)
      || !Number.isSafeInteger(cursor.id) || cursor.id < 1 || typeof cursor.createdAt !== "string" || !Number.isFinite(Date.parse(cursor.createdAt))
      || typeof cursor.source !== "string" || !cursor.source || typeof cursor.observedAt !== "string" || !Number.isFinite(Date.parse(cursor.observedAt))
      || typeof cursor.validUntil !== "string" || !Number.isFinite(Date.parse(cursor.validUntil)) || !Number.isFinite(cursor.deadline)
      || cursor.deadline <= Date.now() || Date.parse(cursor.validUntil) <= Date.now()) return null;
    const expected = signature(binding, cursor);
    if (!timingSafeEqual(Buffer.from(supplied, "hex"), Buffer.from(expected, "hex"))) return null;
    return cursor;
  } catch { return null; }
}
