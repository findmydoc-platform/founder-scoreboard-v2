import { authorizeCredentialAction } from "@/lib/credentials";

export function GET() {
  return authorizeCredentialAction({ credential: { kind: "server-cookies" }, action: "session.login-mode" });
}
