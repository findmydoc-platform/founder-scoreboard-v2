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
      .from("planning_item_legacy_ids")
      .select("task_id")
      .eq("source_kind", "package")
      .eq("legacy_id", id)
      .maybeSingle()
    : { data: null };
  redirect(`/tasks/${encodeURIComponent(data?.task_id || id)}`);
}
