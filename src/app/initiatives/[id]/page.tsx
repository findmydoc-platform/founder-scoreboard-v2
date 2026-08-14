import { redirect } from "next/navigation";
import { safeTaskDetailReturnTo } from "@/features/tasks/model/task-detail-return-navigation";
import { getServerSupabase } from "@/lib/supabase";

type Props = {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ returnTo?: string | string[] }>;
};

export default async function InitiativePage({ params, searchParams }: Props) {
  const { id } = await params;
  const { returnTo } = await searchParams;
  const supabase = getServerSupabase();
  const { data } = supabase
    ? await supabase
      .from("planning_item_historical_links")
      .select("task_id")
      .eq("item_type", "initiative")
      .eq("historical_id", id)
      .maybeSingle()
    : { data: null };
  const safeReturnTo = safeTaskDetailReturnTo(returnTo);
  const returnQuery = safeReturnTo ? `?returnTo=${encodeURIComponent(safeReturnTo)}` : "";
  redirect(`/tasks/${encodeURIComponent(data?.task_id || id)}${returnQuery}`);
}
