import { renderWorkspacePage } from "../workspace-page";

export const dynamic = "force-dynamic";

export default async function EventsPage() {
  return renderWorkspacePage("events");
}
