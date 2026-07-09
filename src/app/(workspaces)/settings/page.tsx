import { renderWorkspacePage } from "../workspace-page";

export const dynamic = "force-dynamic";

export default async function SettingsPage() {
  return renderWorkspacePage("settings");
}
