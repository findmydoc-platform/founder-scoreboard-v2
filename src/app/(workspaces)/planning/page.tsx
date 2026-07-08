import { renderWorkspacePage } from "../workspace-page";

export const dynamic = "force-dynamic";

export default async function PlanningPage() {
  return renderWorkspacePage("planning");
}
