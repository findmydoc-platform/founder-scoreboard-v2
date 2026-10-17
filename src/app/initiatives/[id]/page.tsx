import { redirect } from "next/navigation";
import { safeTaskDetailReturnTo } from "@/features/tasks/model/task-detail-return-navigation";
import { authorizeCredentialAction } from "@/lib/credentials";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ returnTo?: string | string[] }>;
};

export default async function InitiativePage({ params, searchParams }: Props) {
  const { id } = await params;
  const { returnTo } = await searchParams;
  const permission = await authorizeCredentialAction({ credential: { kind: "public-resource" }, action: "historical-initiative.resolve", targetId: id });
  const taskId = await permission.publicResource.resolveHistoricalInitiative();
  const safeReturnTo = safeTaskDetailReturnTo(returnTo);
  const returnQuery = safeReturnTo ? `?returnTo=${encodeURIComponent(safeReturnTo)}` : "";
  redirect(`/tasks/${encodeURIComponent(taskId)}${returnQuery}`);
}
