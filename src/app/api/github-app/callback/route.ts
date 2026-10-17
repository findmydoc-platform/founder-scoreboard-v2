import { after, NextResponse, type NextRequest } from "next/server";
import { authorizeCredentialAction } from "@/lib/credentials";
import { getServerSupabase } from "@/lib/supabase";
import { deliverPendingGitHubComments } from "@/lib/github-comment-delivery";
import { deliverPendingGitHubReviews } from "@/lib/github-review-delivery";

export const dynamic = "force-dynamic";

function redirectError(request: NextRequest, next: string) {
  return NextResponse.redirect(new URL(`/auth/error?next=${encodeURIComponent(next)}`, request.url));
}

export async function GET(request: NextRequest) {
  let next = "/";

  try {
    const connected=await authorizeCredentialAction({credential:{kind:"github-oauth-request",request},action:"github.connection.complete"});
    next=connected.next;
    const connectedProfileId=connected.profileId;
    const supabase=getServerSupabase();
    if(!supabase) throw new Error("Supabase Service Role ist nicht konfiguriert.");
    after(async () => {
      await Promise.all([
        deliverPendingGitHubComments({
          supabase,
          authorProfileId: connectedProfileId,
          limit: 100,
        }),
        deliverPendingGitHubReviews({
          supabase,
          authorProfileId: connectedProfileId,
          limit: 100,
        }),
      ]).catch(() => undefined);
    });

    return NextResponse.redirect(new URL(next, request.url));
  } catch {
    return redirectError(request, next);
  }
}
