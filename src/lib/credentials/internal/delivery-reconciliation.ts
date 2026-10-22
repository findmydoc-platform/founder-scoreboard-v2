import { observedSupabaseFetch } from "./observed-fetch";
import "server-only";
import { authorizeDeliveryAdmission, deliveryStore, DeliveryAdmissionDenied } from "./delivery-admission";
import { runWithDeliveryAdmission } from "./delivery-admission-scope";
import { deliverPendingGitHubComments, previewPendingGitHubComments } from "../../github-comment-delivery";
import { deliverPendingGitHubReviews } from "../../github-review-delivery";
import type { GitHubReconciliationInput } from "../notification-delivery-types";
import { createClient } from "@supabase/supabase-js";
import { NextRequest } from "next/server";
export async function authorizeDeliveryReconciliation(input: GitHubReconciliationInput) {
  const action = input.action;
  const request = new NextRequest(input.credential.request.url, { headers: new Headers(input.credential.request.headers), method: input.credential.request.method });
  const permission = await authorizeDeliveryAdmission(request, action);
  if (!permission.ok)
    return permission;
  const admission = permission;
  if (action === "github.reconciliation.preview") {
    const data = deliveryStore(admission);
    return { ok: true as const, reconciliation: Object.freeze({ preview: () => runWithDeliveryAdmission(admission.reassert, () => previewPendingGitHubComments(data, request, 100)) }) };
  }
  // Existing job claims retain their exact bookkeeping authority after a confirmed effect.
  const data = createClient(admission.configuration.url, admission.configuration.key, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false }, global: { fetch: async (input, init) => {
        const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
        if (["/rest/v1/rpc/claim_task_comment_github_deliveries", "/rest/v1/rpc/claim_task_review_github_deliveries"].includes(url.pathname)) {
          try {
            const assert = await admission.reassert();
            assert();
          }
          catch (error) {
            if (error instanceof DeliveryAdmissionDenied)
              return Response.json({ message: error.message, code: "delivery_admission_denied" }, { status: error.status });
            throw error;
          }
        }
        return observedSupabaseFetch(input, init);
      } } });
  async function runJob<T>(job: () => Promise<T>) {
    return runWithDeliveryAdmission(admission.reassert, async () => {
      try {
        return await job();
      }
      catch (error) {
        const assert = await admission.reassert();
        assert();
        throw error;
      }
    });
  }
  let comments: ReturnType<typeof deliverPendingGitHubComments> | undefined;
  let reviews: ReturnType<typeof deliverPendingGitHubReviews> | undefined;
  return { ok: true as const, reconciliation: Object.freeze({
      comments: () => comments ??= runJob(() => deliverPendingGitHubComments({ supabase: data, limit: 100 })),
      reviews: () => reviews ??= runJob(() => deliverPendingGitHubReviews({ supabase: data, limit: 100 })),
    }) };
}
