import { renderWorkspacePage } from "../workspace-page";

export const dynamic = "force-dynamic";

export default async function BacklogPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(await searchParams)) {
    for (const entry of typeof value === "string" ? [value] : value || []) params.append(key, entry);
  }
  return renderWorkspacePage("backlog", undefined, params);
}
