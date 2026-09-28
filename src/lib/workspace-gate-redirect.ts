import { redirect } from "next/navigation";
import type { AuthErrorCode } from "./auth-error-contract";

export function redirectForWorkspaceGate(code?: AuthErrorCode) {
  if (code === "workspace_link_required") redirect("/auth/link-google");
  if (code === "workspace_google_login_required") redirect("/auth/login?provider=google");
}
