import { renderWorkspacePage } from "../workspace-page";

export const dynamic = "force-dynamic";

export default async function ProfilePage() {
  return renderWorkspacePage("profile");
}
