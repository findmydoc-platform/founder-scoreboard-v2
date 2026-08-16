import { after, NextResponse, type NextRequest } from "next/server";
import {
  acceptGitHubIssueWebhook,
  createSupabaseGitHubWebhookDeliveryStore,
  githubWebhookMaxPayloadBytes,
} from "@/lib/github-webhook-intake";
import {
  createSupabaseGitHubIssueCommentWebhookStore,
  processGitHubIssueCommentWebhookDelivery,
} from "@/lib/github-issue-comment-webhook";
import { getServerServiceRoleSupabase } from "@/lib/supabase-service-role";

export const dynamic = "force-dynamic";
export const runtime = "nodejs";

function jsonError(code: string, error: string, status: number) {
  return NextResponse.json({ ok: false, code, error }, { status });
}

function contentLength(value: string | null) {
  if (value === null) return null;
  return /^\d+$/.test(value) ? Number(value) : Number.NaN;
}

function isJsonContentType(value: string | null) {
  return value?.split(";", 1)[0]?.trim().toLowerCase() === "application/json";
}

type RawBodyReadResult =
  | { ok: true; rawBody: Uint8Array }
  | { ok: false; reason: "too_large" | "unreadable" };

async function readBoundedRawBody(request: NextRequest): Promise<RawBodyReadResult> {
  const reader = request.body?.getReader();
  if (!reader) return { ok: true, rawBody: new Uint8Array() };

  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value?.byteLength) continue;
      byteLength += value.byteLength;
      if (byteLength > githubWebhookMaxPayloadBytes) {
        await reader.cancel().catch(() => {});
        return { ok: false, reason: "too_large" };
      }
      chunks.push(value);
    }
  } catch {
    return { ok: false, reason: "unreadable" };
  } finally {
    reader.releaseLock();
  }

  // Keep the verification buffer bounded even when Content-Length is absent or false.
  const rawBody = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    rawBody.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, rawBody };
}

export async function POST(request: NextRequest) {
  const webhookSecret = process.env.GITHUB_APP_WEBHOOK_SECRET || "";
  const expectedInstallationId = process.env.GITHUB_APP_INSTALLATION_ID?.trim() || "";
  const supabase = getServerServiceRoleSupabase();
  if (!webhookSecret || !/^\d+$/.test(expectedInstallationId) || !supabase) {
    return jsonError("github_webhook_unavailable", "GitHub webhook intake is unavailable.", 503);
  }

  if (!isJsonContentType(request.headers.get("content-type"))) {
    return jsonError("github_webhook_unsupported_media_type", "GitHub webhook payload must be JSON.", 415);
  }

  const declaredLength = contentLength(request.headers.get("content-length"));
  if (Number.isNaN(declaredLength)) {
    return jsonError("github_webhook_invalid_headers", "GitHub webhook headers are invalid.", 400);
  }
  if (declaredLength !== null && declaredLength > githubWebhookMaxPayloadBytes) {
    return jsonError("github_webhook_payload_too_large", "GitHub webhook payload is too large.", 413);
  }

  const bodyResult = await readBoundedRawBody(request);
  if (!bodyResult.ok && bodyResult.reason === "too_large") {
    return jsonError("github_webhook_payload_too_large", "GitHub webhook payload is too large.", 413);
  }
  if (!bodyResult.ok) {
    return jsonError("github_webhook_invalid_payload", "GitHub webhook payload could not be read.", 400);
  }

  const result = await acceptGitHubIssueWebhook({
    rawBody: bodyResult.rawBody,
    headers: {
      deliveryId: request.headers.get("x-github-delivery"),
      eventName: request.headers.get("x-github-event"),
      signature: request.headers.get("x-hub-signature-256"),
    },
    webhookSecret,
    expectedInstallationId,
    store: createSupabaseGitHubWebhookDeliveryStore(supabase),
  });

  if (result.kind === "ping") return NextResponse.json({ ok: true });
  if (result.kind === "ignored") return new Response(null, { status: 204 });
  if (result.kind === "rejected") return jsonError(result.code, result.message, result.status);
  if (result.delivery.eventName === "issue_comment") {
    after(async () => {
      await processGitHubIssueCommentWebhookDelivery({
        deliveryId: result.delivery.deliveryId,
        store: createSupabaseGitHubIssueCommentWebhookStore(supabase),
      }).catch(() => undefined);
    });
  }
  if (result.duplicate) {
    return NextResponse.json({ ok: true, accepted: true, duplicate: true });
  }
  return NextResponse.json({ ok: true, accepted: true }, { status: 202 });
}
