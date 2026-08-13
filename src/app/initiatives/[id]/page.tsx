import { redirect } from "next/navigation";

type Props = {
  params: Promise<{ id: string }>;
};

export default async function InitiativePage({ params }: Props) {
  const { id } = await params;
  redirect(`/tasks/${encodeURIComponent(id)}`);
}
