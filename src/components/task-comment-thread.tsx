"use client";

import { AlertCircle, CheckCircle2, Clock3, GitBranch, GitPullRequestArrow, MessageSquare, Paperclip, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { getRememberedGitHubProviderToken, rememberGitHubProviderToken } from "@/lib/github-provider-token";
import { getBrowserSupabase } from "@/lib/supabase";
import type { Profile, TaskActivity, TaskComment, TaskExternalComment } from "@/lib/types";

type Props = {
  comments: TaskComment[];
  externalComments?: TaskExternalComment[];
  activities?: TaskActivity[];
  profiles: Profile[];
  pending?: boolean;
  importPending?: boolean;
  notice?: string;
  title?: string;
  description?: string;
  onAddComment: (comment: string) => void;
  onImportGitHubComments?: () => void;
  onUploadAttachment?: (file: File) => Promise<string>;
};

type MarkdownPart =
  | { type: "text"; text: string }
  | { type: "link"; text: string; href: string }
  | { type: "image"; alt: string; href: string };

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

function repairGermanText(value: string) {
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

function isUsefulActivity(message: string) {
  const normalized = repairGermanText(message).trim();
  if (!normalized) return false;
  if (normalized === "Aufgabe aktualisiert") return false;
  return [
    "Status geändert",
    "Review geändert",
    "Kommentar hinzugefügt",
    "GitHub Sync",
    "GitHub-Kommentare importiert",
    "Blocker",
    "Relationship",
    "Sprint",
    "Priorität",
    "Evidence",
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
  if (normalized.startsWith("GitHub")) return { title, detail, tone: "violet" as const, icon: GitBranch };
  if (normalized.startsWith("Relationship")) return { title, detail, tone: "slate" as const, icon: GitPullRequestArrow };
  if (normalized.startsWith("Blocker")) return { title, detail, tone: "red" as const, icon: AlertCircle };
  if (normalized.startsWith("Kommentar")) return { title, detail, tone: "slate" as const, icon: MessageSquare };
  if (normalized.startsWith("Anhang")) return { title, detail, tone: "slate" as const, icon: Paperclip };
  if (normalized.startsWith("Sprint") || normalized.startsWith("Priorität") || normalized.startsWith("Owner")) return { title, detail, tone: "blue" as const, icon: Clock3 };

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

function decodeHtmlEntities(value: string) {
  return value
    .replace(/&amp;/g, "&")
    .replace(/&quot;/g, "\"")
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">");
}

function safeUrl(value: string) {
  try {
    const url = new URL(decodeHtmlEntities(value.trim()));
    if (url.protocol === "https:" || url.protocol === "http:") return url.toString();
  } catch {
    return "";
  }
  return "";
}

function isImageUrl(value: string) {
  const url = safeUrl(value);
  if (!url) return false;
  try {
    const parsed = new URL(url);
    return /\.(png|jpe?g|gif|webp|svg)(?:$|[?#])/i.test(parsed.pathname)
      || parsed.hostname.endsWith("githubusercontent.com")
      || parsed.hostname === "github.com" && parsed.pathname.includes("/user-attachments/assets/");
  } catch {
    return false;
  }
}

function isGitHubAssetUrl(value: string) {
  try {
    const url = new URL(value);
    const hostname = url.hostname.toLowerCase();
    return hostname === "github.com"
      || hostname.endsWith("githubusercontent.com")
      || hostname === "objects.githubusercontent.com"
      || hostname.startsWith("github-production-user-asset-")
      || hostname.endsWith(".s3.amazonaws.com");
  } catch {
    return false;
  }
}

function GitHubCommentImage({ href, alt }: { href: string; alt: string }) {
  const isGitHubAsset = isGitHubAssetUrl(href);
  const [src, setSrc] = useState(href);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [proxyAttempted, setProxyAttempted] = useState(false);
  const objectUrlRef = useRef("");

  async function loadViaProxy() {
    if (!isGitHubAsset || proxyAttempted) {
      setFailed(true);
      return;
    }

    setLoading(true);
    setProxyAttempted(true);

    try {
      const supabase = getBrowserSupabase();
      const session = supabase ? (await supabase.auth.getSession()).data.session : null;
      const accessToken = session?.access_token || "";
      rememberGitHubProviderToken(session?.provider_token);
      const providerToken = getRememberedGitHubProviderToken();

      if (!accessToken || !providerToken) {
        setFailed(true);
        return;
      }

      const response = await fetch(`/api/github-assets?url=${encodeURIComponent(href)}`, {
        headers: {
          authorization: `Bearer ${accessToken}`,
          "x-github-provider-token": providerToken,
        },
      });
      if (!response.ok) throw new Error(`GitHub asset failed: ${response.status}`);
      const blob = await response.blob();
      if (objectUrlRef.current) URL.revokeObjectURL(objectUrlRef.current);
      objectUrlRef.current = URL.createObjectURL(blob);
      setSrc(objectUrlRef.current);
      setFailed(false);
    } catch {
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    return () => {
      if (objectUrlRef.current) {
        URL.revokeObjectURL(objectUrlRef.current);
        objectUrlRef.current = "";
      }
    };
  }, []);

  return (
    <a href={href} target="_blank" rel="noreferrer" className="mt-2 block max-w-full">
      {loading ? (
        <span className="grid min-h-24 max-w-full place-items-center rounded-md border border-dashed border-slate-200 bg-slate-50 text-xs font-semibold text-slate-500">
          GitHub-Anhang wird geladen ...
        </span>
      ) : failed ? (
        <span className="grid min-h-16 max-w-full place-items-center rounded-md border border-dashed border-amber-200 bg-amber-50 px-3 text-xs font-semibold text-amber-700">
          Vorschau konnte nicht geladen werden. Der Anhang lässt sich in GitHub öffnen.
        </span>
      ) : (
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={src}
          alt={alt}
          loading="lazy"
          referrerPolicy="no-referrer"
          onError={() => {
            void loadViaProxy();
          }}
          className="max-h-[420px] max-w-full rounded-md border border-slate-200 bg-white object-contain"
        />
      )}
      <span className="mt-1 inline-flex text-xs font-semibold text-blue-600 hover:text-blue-700">Anhang in GitHub öffnen</span>
    </a>
  );
}

function pushInlineText(parts: MarkdownPart[], value: string) {
  if (value) parts.push({ type: "text", text: value });
}

function renderMarkdownParts(line: string) {
  const parts: MarkdownPart[] = [];
  const pattern = /<img\b[^>]*\balt=["']([^"']*)["'][^>]*\bsrc=["'](https?:\/\/[^"']+)["'][^>]*>|<img\b[^>]*\bsrc=["'](https?:\/\/[^"']+)["'][^>]*>|!\[([^\]]*)\]\((https?:\/\/[^)\s"'>]+)\)|\[([^\]]+)\]\((https?:\/\/[^)\s"'>]+)\)|(https?:\/\/[^\s)"'>]+)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(line)) !== null) {
    pushInlineText(parts, line.slice(lastIndex, match.index));
    if (match[2]) {
      parts.push({ type: "image", alt: match[1] || "Anhang", href: safeUrl(match[2]) });
    } else if (match[3]) {
      parts.push({ type: "image", alt: "Anhang", href: safeUrl(match[3]) });
    } else if (match[5]) {
      parts.push({ type: "image", alt: match[4] || "Anhang", href: safeUrl(match[5]) });
    } else if (match[7]) {
      parts.push({ type: "link", text: match[6], href: safeUrl(match[7]) });
    } else if (match[8]) {
      const href = safeUrl(match[8]);
      parts.push(isImageUrl(href) ? { type: "image", alt: "Anhang", href } : { type: "link", text: href, href });
    }
    lastIndex = pattern.lastIndex;
  }

  pushInlineText(parts, line.slice(lastIndex));
  return parts.filter((part) => part.type === "text" || Boolean(part.href));
}

export function CommentBody({ value }: { value: string }) {
  const lines = value.split(/\r?\n/);

  return (
    <div className="mt-1 grid gap-1.5 text-sm leading-6 text-slate-700">
      {lines.map((line, lineIndex) => {
        const parts = renderMarkdownParts(line);
        if (!parts.length) return <div key={`line-${lineIndex}`} className="h-2" />;

        return (
          <div key={`line-${lineIndex}`} className="break-words">
            {parts.map((part, partIndex) => {
              if (part.type === "text") return <span key={partIndex}>{part.text}</span>;
              if (part.type === "link") {
                return (
                  <a key={partIndex} href={part.href} target="_blank" rel="noreferrer" className="font-semibold text-blue-600 hover:text-blue-700">
                    {part.text}
                  </a>
                );
              }
              return <GitHubCommentImage key={`${part.href}-${partIndex}`} href={part.href} alt={part.alt} />;
            })}
          </div>
        );
      })}
    </div>
  );
}

export function TaskCommentThread({
  comments,
  externalComments = [],
  activities = [],
  profiles,
  pending = false,
  importPending = false,
  notice = "",
  title = "Kommunikation",
  description = "Fragen, Updates und Abstimmungen zur Aufgabe bleiben hier nachvollziehbar.",
  onAddComment,
  onImportGitHubComments,
  onUploadAttachment,
}: Props) {
  const [newComment, setNewComment] = useState("");
  const [uploadPending, setUploadPending] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const showCommentPreview = /!\[[^\]]*\]\(https?:\/\/|https?:\/\/|\[[^\]]+\]\(https?:\/\//.test(newComment);
  const profileName = (profileId: string) => profiles.find((profile) => profile.id === profileId)?.name || profileId || "Unbekannt";
  const profileById = (profileId: string) => profiles.find((profile) => profile.id === profileId);
  const visibleActivities = activities.filter((activity) => isUsefulActivity(activity.message));
  const commentCount = comments.length + externalComments.length;
  const activityCount = visibleActivities.length;
  const timeline = [
    ...visibleActivities.map((activity) => ({
      id: `activity-${activity.id}`,
      type: "activity" as const,
      createdAt: activity.createdAt,
      message: activity.message,
      profileId: "",
      comment: "",
      authorLogin: "",
      authorAvatarUrl: "",
      htmlUrl: "",
    })),
    ...comments.map((comment) => ({
      id: `comment-${comment.id}`,
      type: "comment" as const,
      createdAt: comment.createdAt,
      message: "",
      profileId: comment.profileId,
      comment: comment.comment,
      authorLogin: "",
      authorAvatarUrl: "",
      htmlUrl: "",
    })),
    ...externalComments.map((comment) => ({
      id: `github-comment-${comment.id}`,
      type: "github-comment" as const,
      createdAt: comment.createdAt,
      message: "",
      profileId: "",
      comment: comment.body,
      authorLogin: comment.authorLogin,
      authorAvatarUrl: comment.authorAvatarUrl,
      htmlUrl: comment.htmlUrl,
    })),
  ].sort((left, right) => new Date(left.createdAt).getTime() - new Date(right.createdAt).getTime());

  return (
    <section className="rounded-lg border border-slate-200 p-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="flex items-center gap-2 text-sm font-semibold text-slate-950">
            <MessageSquare size={16} />
            {title}
          </h3>
          <p className="mt-1 text-xs text-slate-500">{description}</p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          {onImportGitHubComments && (
            <button
              type="button"
              onClick={onImportGitHubComments}
              disabled={pending || importPending}
              className="inline-flex h-8 items-center gap-2 rounded-md border border-slate-200 bg-white px-2 text-xs font-semibold text-slate-600 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
            >
              <RefreshCw size={13} />
              {importPending ? "Aktualisiert..." : "GitHub aktualisieren"}
            </button>
          )}
          <span className="rounded-full border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-600">
            {commentCount} Kommentare
          </span>
          {activityCount > 0 && (
            <span className="rounded-full border border-slate-200 px-2 py-1 text-xs font-semibold text-slate-500">
              {activityCount} Aktivitäten
            </span>
          )}
        </div>
      </div>

      {notice && (
        <div className="mt-3 rounded-md border border-blue-100 bg-blue-50 px-3 py-2 text-xs font-semibold text-blue-700">
          {notice}
        </div>
      )}
      {!notice && importPending && (
        <div className="mt-3 rounded-md border border-slate-200 bg-slate-50 px-3 py-2 text-xs font-semibold text-slate-600">
          GitHub-Kommentare und Anhänge werden geprüft...
        </div>
      )}

      <div className="mt-3 grid gap-2">
        {timeline.map((item) => (
          item.type === "comment" ? (
            <article key={item.id} className="flex gap-3 rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-sm">
              <ProfileAvatar profile={profileById(item.profileId)} />
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2 text-xs text-slate-500">
                  <span className="font-semibold text-slate-700">{profileName(item.profileId)}</span>
                  <span>{formatDateTime(item.createdAt)}</span>
                </div>
                <CommentBody value={item.comment} />
              </div>
            </article>
          ) : item.type === "github-comment" ? (
            <article key={item.id} className="flex gap-3 rounded-md border border-slate-100 bg-white px-3 py-2 text-sm">
              <span className="grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full bg-slate-100 text-xs font-semibold text-slate-700">
                {item.authorAvatarUrl ? (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={item.authorAvatarUrl} alt="" className="h-full w-full object-cover" />
                ) : (
                  item.authorLogin.slice(0, 1).toUpperCase() || "G"
                )}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center justify-between gap-2 text-xs text-slate-500">
                  <span className="inline-flex items-center gap-1 font-semibold text-slate-700">
                    <GitBranch size={13} />
                    {item.authorLogin}
                  </span>
                  <span>{formatDateTime(item.createdAt)}</span>
                </div>
                <CommentBody value={item.comment} />
                {item.htmlUrl && (
                  <a href={item.htmlUrl} target="_blank" rel="noreferrer" className="mt-2 inline-flex text-xs font-semibold text-blue-600 hover:text-blue-700">
                    In GitHub öffnen
                  </a>
                )}
              </div>
            </article>
          ) : (() => {
            const activity = describeActivity(item.message);
            const Icon = activity.icon;
            return (
              <article key={item.id} className="flex gap-3 rounded-md border border-slate-100 bg-slate-50 px-3 py-2 text-sm">
                <span className={`mt-0.5 grid h-8 w-8 shrink-0 place-items-center rounded-full border ${activityToneClass(activity.tone)}`}>
                  <Icon size={15} />
                </span>
                <div className="min-w-0 flex-1">
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
        {!timeline.length && (
          <div className="rounded-md border border-dashed border-slate-200 px-3 py-4 text-center text-sm text-slate-500">
            Noch keine Kommentare, Nachfragen oder relevante Aktivitäten.
          </div>
        )}
      </div>

      <textarea
        value={newComment}
        onChange={(event) => setNewComment(event.target.value)}
        className="mt-3 min-h-24 w-full resize-y rounded-md border border-slate-200 p-3 text-sm leading-6 outline-none focus:border-blue-400"
        placeholder="Kommentar, Nachfrage oder kurzes Arbeitsupdate"
      />
      {showCommentPreview && (
        <div className="mt-2 rounded-md border border-slate-200 bg-slate-50 p-3">
          <div className="mb-2 text-xs font-semibold text-slate-500">Vorschau</div>
          <CommentBody value={newComment} />
        </div>
      )}
      {uploadError && <div className="mt-2 rounded-md border border-red-100 bg-red-50 px-3 py-2 text-xs font-semibold text-red-700">{uploadError}</div>}
      <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
        <div>
          {onUploadAttachment && (
            <>
              <input
                ref={fileInputRef}
                type="file"
                className="hidden"
                accept="image/png,image/jpeg,image/gif,image/webp,image/svg+xml,application/pdf,text/plain,text/markdown"
                onChange={async (event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (!file) return;

                  setUploadPending(true);
                  setUploadError("");
                  try {
                    const markdown = await onUploadAttachment(file);
                    setNewComment((current) => `${current.trimEnd()}${current.trim() ? "\n\n" : ""}${markdown}`);
                  } catch (caught) {
                    setUploadError(caught instanceof Error ? caught.message : "Anhang konnte nicht hochgeladen werden.");
                  } finally {
                    setUploadPending(false);
                  }
                }}
              />
              <button
                type="button"
                disabled={pending || uploadPending}
                onClick={() => fileInputRef.current?.click()}
                className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
              >
                <Paperclip size={15} />
                {uploadPending ? "Lädt hoch..." : "Anhang"}
              </button>
            </>
          )}
        </div>
        <button
          type="button"
          disabled={pending || uploadPending || newComment.trim().length < 2}
          onClick={() => {
            onAddComment(newComment);
            setNewComment("");
          }}
          className="h-9 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-50"
        >
          Kommentieren
        </button>
      </div>
    </section>
  );
}
