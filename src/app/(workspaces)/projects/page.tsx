import { redirect } from "next/navigation";

export const dynamic = "force-dynamic";

export default async function ProjectsPage() {
  redirect("/backlog?backlog.level=epic");
}
