import { permanentRedirect } from "next/navigation";

export default async function LegacyReviewRedirectPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  permanentRedirect(`/tasks/${encodeURIComponent(id)}`);
}
