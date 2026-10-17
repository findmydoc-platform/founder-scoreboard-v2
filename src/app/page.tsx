import { authorizeCredentialAction } from "@/lib/credentials";
import { redirect } from "next/navigation";
import { workspacePath } from "@/features/planning/model/workspace-routes";

export const dynamic = "force-dynamic";

export default async function Home() {
  const workspace = await authorizeCredentialAction({ credential: { kind: "server-cookies" }, action: "session.home" });
  redirect(workspacePath(workspace));
}
