import { redirect } from "next/navigation";
import { getServerSupabase } from "@/lib/supabase";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function InitiativePage({ params }: Props) {
  const { id } = await params;
  const supabase = getServerSupabase();
  const { data } = supabase
    ? await supabase
      .from("planning_item_historical_links")
      .select("task_id")
      .eq("item_type", "initiative")
      .eq("historical_id", id)
      .maybeSingle()
    : { data: null };
  redirect(`/tasks/${encodeURIComponent(data?.task_id || id)}`);
}
