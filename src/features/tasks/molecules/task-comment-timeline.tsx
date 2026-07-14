"use client";

import { AlertCircle, CheckCircle2, Clock3, GitBranch, GitPullRequestArrow, MessageSquare, Paperclip } from "lucide-react";
import { CommentBody } from "@/features/tasks/atoms/task-comment-body";
import type { GitHubCommentDeliveryStatus, Profile } from "@/lib/types";
import { UiEmptyState } from "@/shared/atoms/ui-primitives";

export type TaskCommentTimelineItem =
  | {
      id: string;
      type: "activity";
      createdAt: string;
      message: string;
      profileId: string;
      comment: string;
      authorLogin: string;
      authorAvatarUrl: string;
      htmlUrl: string;
      githubDeliveryStatus?: GitHubCommentDeliveryStatus;
      githubCommentUrl?: string;
    }
  | {
      id: string;
      type: "comment";
      createdAt: string;
      message: string;
      profileId: string;
      comment: string;
      authorLogin: string;
      authorAvatarUrl: string;
      htmlUrl: string;
      githubDeliveryStatus?: GitHubCommentDeliveryStatus;
      githubCommentUrl?: string;
    }
  | {
      id: string;
      type: "github-comment";
      createdAt: string;
      message: string;
      profileId: string;
      comment: string;
      authorLogin: string;
      authorAvatarUrl: string;
      htmlUrl: string;
      githubDeliveryStatus?: GitHubCommentDeliveryStatus;
      githubCommentUrl?: string;
    };

function formatDateTime(value: string) {
  if (!value) return "";
  return new Intl.DateTimeFormat("de-DE", {
    day: "2-digit",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  }).format(new Date(value));
}

function ProfileAvatar({ profile }: { profile?: Profile }) {
  const login = profile?.githubLogin || "";
  return (
    <span className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full bg-slate-100 text-xs font-semibold text-slate-700">
      {login ? (
        // eslint-disable-next-line @next/next/no-img-element
        <img src={`https://github.com/${login}.png?size=64`} alt="" className="h-full w-full object-cover" />
      ) : (
        profile?.name?.slice(0, 1).toUpperCase() || "?"
      )}
    </span>
  );
}

export function repairGermanText(value: string) {
  return value
    .replace(new RegExp("\u00c3\u00a4", "g"), "ä")
    .replace(new RegExp("\u00c3\u00b6", "g"), "ö")
    .replace(new RegExp("\u00c3\u00bc", "g"), "ü")
    .replace(new RegExp("\u00c3\u0084", "g"), "Ä")
    .replace(new RegExp("\u00c3\u0096", "g"), "Ö")
    .replace(new RegExp("\u00c3\u009c", "g"), "Ü")
    .replace(new RegExp("\u00c3\u009f", "g"), "ß")
    .replace(new RegExp("\u00c2\u00b7", "g"), "·");
}

export function isUsefulActivity(message: string) {
  const normalized = repairGermanText(message).trim();
  if (!normalized) return false;
  if (normalized === "Aufgabe aktualisiert") return false;
  return [
    "Status geändert",
    "Review geändert",
    "Kommentar hinzugefügt",
    "GitHub-Sync",
    "GitHub-Kommentare importiert",
    "Blocker",
    "Relationship",
    "Sprint",
    "Priorität",
    "Evidence",
    "Zuständigkeit",
    "Assignee",
    "Owner",
    "Nacharbeit",
    "Priorität",
    "Anhang",
    "Aufgabenbrief",
    "Founder-Checkliste",
    "Fokus",
  ].some((prefix) => normalized.startsWith(prefix) || normalized.includes(prefix));
}

function describeActivity(message: string) {
  const normalized = repairGermanText(message.trim());
  const [rawTitle, ...detailParts] = normalized.split(":");
  const detail = detailParts.join(":").trim();
  const title = rawTitle.trim() || "Aktivität";

  if (normalized.startsWith("Status geändert")) return { title: "Status geändert", detail, tone: "blue" as const, icon: Clock3 };
  if (normalized.startsWith("Review geändert") || normalized.startsWith("Review finalisiert")) return { title, detail, tone: "emerald" as const, icon: CheckCircle2 };
  if (normalized.startsWith("Nacharbeit")) return { title, detail, tone: "amber" as const, icon: AlertCircle };
  if (normalized.startsWith("GitHub")) return { title: "GitHub-Sync", detail, tone: "violet" as const, icon: GitBranch };
  if (normalized.startsWith("Relationship")) return { title: "Abhängigkeit", detail, tone: "slate" as const, icon: GitPullRequestArrow };
  if (normalized.startsWith("Blocker")) return { title, detail, tone: "red" as const, icon: AlertCircle };
  if (normalized.startsWith("Kommentar")) return { title, detail, tone: "slate" as const, icon: MessageSquare };
  if (normalized.startsWith("Anhang")) return { title, detail, tone: "slate" as const, icon: Paperclip };
  if (normalized.startsWith("Sprint") || normalized.startsWith("Priorität") || normalized.startsWith("Zuständigkeit") || normalized.startsWith("Assignee") || normalized.startsWith("Owner")) return { title, detail, tone: "blue" as const, icon: Clock3 };

  return { title, detail, tone: "slate" as const, icon: Clock3 };
}

function activityToneClass(tone: ReturnType<typeof describeActivity>["tone"]) {
  if (tone === "blue") return "border-blue-100 bg-blue-50 text-blue-700";
  if (tone === "emerald") return "border-emerald-100 bg-emerald-50 text-emerald-700";
  if (tone === "amber") return "border-amber-100 bg-amber-50 text-amber-700";
  if (tone === "red") return "border-red-100 bg-red-50 text-red-700";
  if (tone === "violet") return "border-violet-100 bg-violet-50 text-violet-700";
  return "border-slate-200 bg-slate-50 text-slate-600";
}

function deliveryHint(status?: GitHubCommentDeliveryStatus) {
  if (status === "waiting_for_author_connection") return "Wartet auf deine GitHub-Verbindung";
  if (status === "waiting_for_issue") return "Wird nach der Issue-Anlage veröffentlicht";
  if (status === "pending" || status === "processing" || status === "retry_scheduled") return "GitHub-Veröffentlichung ausstehend";
  if (status === "failed") return "GitHub-Veröffentlichung braucht Aufmerksamkeit";
  return "";
}

type TaskCommentTimelineProps = {
  currentProfileId?: string;
  error?: string;
  items: TaskCommentTimelineItem[];
  loading?: boolean;
  profiles: Profile[];
  unavailable?: boolean;
};

export function TaskCommentTimeline({
  items,
  profiles,
  currentProfileId = "",
  error = "",
  loading = false,
  unavailable = false,
}: TaskCommentTimelineProps) {
  const profileName = (profileId: string) => profiles.find((profile) => profile.id === profileId)?.name || profileId || "Unbekannt";
  const profileById = (profileId: string) => profiles.find((profile) => profile.id === profileId);

  return (
    <div className="mt-3 grid min-w-0 gap-2" aria-busy={loading}>
      {error ? (
        <div role="alert" className="rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm font-medium text-red-700">
          {error}
        </div>
      ) : null}
      {items.map((item) => (
        item.type === "comment" ? (
          <article key={item.id} className="flex min-w-0 gap-3 overflow-hidden rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-sm">
            <ProfileAvatar profile={profileById(item.profileId)} />
            <div className="min-w-0 flex-1 overflow-hidden">
              <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                <span className="font-semibold text-slate-700">{profileName(item.profileId)}</span>
                <span>{formatDateTime(item.createdAt)}</span>
              </div>
              <CommentBody value={item.comment} />
              {item.profileId === currentProfileId && deliveryHint(item.githubDeliveryStatus) && (
                <div className="mt-2 inline-flex rounded-full border border-amber-200 bg-amber-50 px-2 py-1 text-[11px] font-semibold text-amber-800">
                  {deliveryHint(item.githubDeliveryStatus)}
                </div>
              )}
              {item.profileId === currentProfileId && item.githubDeliveryStatus === "delivered" && item.githubCommentUrl && (
                <a href={item.githubCommentUrl} target="_blank" rel="noreferrer" aria-label="Kommentar in GitHub öffnen (öffnet in neuem Tab)" className="mt-2 inline-flex text-xs font-semibold text-blue-600 hover:text-blue-700">
                  In GitHub öffnen
                </a>
              )}
            </div>
          </article>
        ) : item.type === "github-comment" ? (
          <article key={item.id} className="flex min-w-0 gap-3 overflow-hidden rounded-md border border-slate-100 bg-white px-3 py-2 text-sm">
            <span className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full bg-slate-100 text-xs font-semibold text-slate-700">
              {item.authorAvatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={item.authorAvatarUrl} alt="" className="h-full w-full object-cover" />
              ) : (
                item.authorLogin.slice(0, 1).toUpperCase() || "G"
              )}
            </span>
            <div className="min-w-0 flex-1 overflow-hidden">
              <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                <span className="inline-flex items-center gap-1 font-semibold text-slate-700">
                  <GitBranch size={13} />
                  {item.authorLogin}
                </span>
                <span>{formatDateTime(item.createdAt)}</span>
              </div>
              <CommentBody value={item.comment} />
              {item.htmlUrl && (
                <a href={item.htmlUrl} target="_blank" rel="noreferrer" aria-label="Kommentar in GitHub öffnen (öffnet in neuem Tab)" className="mt-2 inline-flex text-xs font-semibold text-blue-600 hover:text-blue-700">
                  In GitHub öffnen
                </a>
              )}
            </div>
          </article>
        ) : (() => {
          const activity = describeActivity(item.message);
          const Icon = activity.icon;
          return (
            <article key={item.id} className="flex min-w-0 gap-3 overflow-hidden rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-sm">
              <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full border ${activityToneClass(activity.tone)}`}>
                <Icon size={15} />
              </span>
              <div className="min-w-0 flex-1 overflow-hidden">
                <div className="flex flex-wrap items-center justify-between gap-2">
                  <span className="font-semibold text-slate-800">{activity.title}</span>
                  <span className="text-xs text-slate-400">{formatDateTime(item.createdAt)}</span>
                </div>
                {activity.detail && <div className="mt-1 text-sm leading-6 text-slate-600">{activity.detail}</div>}
              </div>
            </article>
          );
        })()
      ))}
      {loading ? (
        <div className="grid gap-2" aria-label="Aktivitäten werden geladen">
          <div className="h-16 animate-pulse rounded-md bg-slate-100" />
          <div className="h-16 animate-pulse rounded-md bg-slate-100" />
          <div className="h-16 animate-pulse rounded-md bg-slate-100" />
        </div>
      ) : null}
      {!items.length && !loading && !error && !unavailable && (
        <UiEmptyState>
          Noch keine Kommentare, Nachfragen oder relevante Aktivitäten.
        </UiEmptyState>
      )}
    </div>
  );
}
