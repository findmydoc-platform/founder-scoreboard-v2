import { NextResponse, type NextRequest } from "next/server";
import { auditRequestMetadata, cleanText } from "@/lib/api-input";
import { requireFounder } from "@/lib/authz";
import type { FeedbackItem } from "@/lib/types";
import { apiError, requireJsonApiContext } from "@/lib/api-response";

type FeedbackPayload = {
  type?: string;
  severity?: string;
  title?: string;
  description?: string;
  pageUrl?: string;
};

const feedbackTypes = new Set(["bug", "feature"]);
const severities = new Set(["P0", "P1", "P2", "P3"]);

export async function POST(request: NextRequest) {
  const context = await requireJsonApiContext<FeedbackPayload | null>(request, requireFounder, null);
  if (!context.ok) return context.response;

  const { payload, permission, supabase } = context;
  const type = feedbackTypes.has(payload?.type || "") ? payload!.type! : "bug";
  const severity = severities.has(payload?.severity || "") ? payload!.severity! : "P2";
  const title = cleanText(payload?.title, 180);
  const description = cleanText(payload?.description, 3000);
  const pageUrl = cleanText(payload?.pageUrl, 500);

  if (title.length < 3) return apiError("Titel ist erforderlich.", 400);
  if (description.length < 10) return apiError("Beschreibung muss mindestens 10 Zeichen haben.", 400);

  const { data: created, error: insertError } = await supabase
    .from("feedback_items")
    .insert({
      type,
      severity,
      profile_id: permission.profile?.id || null,
      title,
      description,
      page_url: pageUrl || null,
    })
    .select("id,type,status,severity,profile_id,title,description,page_url,created_at")
    .single();

  if (insertError || !created) return apiError(insertError?.message || "Feedback konnte nicht gespeichert werden.", 500);

  const { data: leads } = await supabase.from("profiles").select("id").in("platform_role", ["ceo", "deputy"]);
  const notifications = (leads || [])
    .filter((lead) => lead.id !== permission.profile?.id)
    .map((lead) => ({
      type: type === "bug" ? "feedback.bug_reported" : "feedback.feature_requested",
      actor_profile_id: permission.profile?.id || null,
      recipient_profile_id: lead.id,
      entity_type: "feedback",
      entity_id: String(created.id),
      title: `${type === "bug" ? "Bug" : "Feature-Wunsch"}: ${title}`,
      body: description,
    }));

  if (notifications.length) await supabase.from("notification_events").insert(notifications);

  await supabase.from("audit_log").insert({
    actor_profile_id: permission.profile?.id || null,
    action: "feedback.create",
    entity_type: "feedback",
    entity_id: String(created.id),
    after_data: { ...created },
    ...auditRequestMetadata(request),
  });

  const feedback: FeedbackItem = {
    id: created.id,
    type: created.type,
    status: created.status,
    severity: created.severity,
    profileId: created.profile_id || "",
    title: created.title,
    description: created.description,
    pageUrl: created.page_url || "",
    createdAt: created.created_at,
  };

  return NextResponse.json({ ok: true, feedback });
}
