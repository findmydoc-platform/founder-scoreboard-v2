import { redirect } from "next/navigation";
import { appWorkspaceFromValue, workspacePath } from "@/features/planning/model/workspace-routes";

export const dynamic = "force-dynamic";

type Props = {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
};

function firstValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] : value;
}

export default async function Home({ searchParams }: Props) {
  const params = await searchParams;
  const rawWorkspace = firstValue(params.workspace);
  const workspace = appWorkspaceFromValue(rawWorkspace) || "planning";
  const nextParams = new URLSearchParams();

  for (const [key, value] of Object.entries(params)) {
    if (key === "workspace") continue;
    if (Array.isArray(value)) {
      for (const item of value) nextParams.append(key, item);
    } else if (value !== undefined) {
      nextParams.set(key, value);
    }
  }

  if (rawWorkspace === "mine") nextParams.set("workspace", "mine");

  const query = nextParams.toString();
  redirect(`${workspacePath(workspace)}${query ? `?${query}` : ""}`);
}
