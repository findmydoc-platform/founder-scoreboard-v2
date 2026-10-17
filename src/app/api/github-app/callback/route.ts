import { GitHubConnectionError } from "@/lib/github-app-errors";
import { after, NextResponse, type NextRequest } from "next/server";
import { authorizeCredentialAction } from "@/lib/credentials";

export const dynamic = "force-dynamic";

function redirectError(request: NextRequest, next: string) {
  return NextResponse.redirect(new URL(`/auth/error?next=${encodeURIComponent(next)}`, request.url));
}

export async function GET(request: NextRequest) {
  let next = "/";

  try {
    const connected=await authorizeCredentialAction({credential:{kind:"github-oauth-request",request},action:"github.connection.complete"});
    next=connected.next;
    after(async () => {
      await Promise.all([connected.resumePendingComments?.(), connected.resumePendingReviews?.()]).catch(() => undefined);
    });

    return NextResponse.redirect(new URL(next, request.url));
  } catch(error) {
    return redirectError(request, error instanceof GitHubConnectionError ? error.next : next);
  }
}
