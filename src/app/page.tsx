import { redirect } from "next/navigation";
import { workspacePath } from "@/features/planning/model/workspace-routes";
import { getServerPlanningHomeWorkspace } from "@/lib/planning-auth-server";

export const dynamic = "force-dynamic";

export default async function Home() {
  const workspace = await getServerPlanningHomeWorkspace();
  redirect(workspacePath(workspace));
}
