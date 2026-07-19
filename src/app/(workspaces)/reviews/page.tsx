import { permanentRedirect } from "next/navigation";

export default function LegacyReviewsPage() {
  permanentRedirect("/planning?tasks.review=requested");
}
