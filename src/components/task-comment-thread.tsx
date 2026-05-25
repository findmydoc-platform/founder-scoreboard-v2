"use client";

import { GitBranch, MessageSquare, Paperclip, RefreshCw } from "lucide-react";
import { useEffect, useRef, useState } from "react";
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

function isUsefulActivity(message: string) {
  const normalized = message.trim();
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
  ].some((prefix) => normalized.startsWith(prefix) || normalized.includes(prefix));
}

function safeUrl(value: string) {
  try {
    const url = new URL(value);
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
      || hostname.startsWith("github-production-user-asset-");
  } catch {
    return false;
  }
}

function GitHubCommentImage({ href, alt }: { href: string; alt: string }) {
  const [src, setSrc] = useState(href);
  const [failed, setFailed] = useState(false);
  const [loading, setLoading] = useState(false);
  const [fallbackAttempted, setFallbackAttempted] = useState(false);

  useEffect(() => {
    if (!fallbackAttempted) return;

    let cancelled = false;
    let objectUrl = "";

    async function loadGitHubAsset() {
      if (!isGitHubAssetUrl(href)) {
        setFailed(true);
        return;
      }

      const supabase = getBrowserSupabase();
      const session = supabase ? (await supabase.auth.getSession()).data.session : null;
      const accessToken = session?.access_token || "";
      const providerToken = session?.provider_token || "";

      if (!accessToken || !providerToken) {
        setLoading(false);
        setFailed(true);
        return;
      }

      try {
        const response = await fetch(`/api/github-assets?url=${encodeURIComponent(href)}`, {
          headers: {
            authorization: `Bearer ${accessToken}`,
            "x-github-provider-token": providerToken,
          },
        });
        if (!response.ok) throw new Error(`GitHub asset failed: ${response.status}`);
        const blob = await response.blob();
        objectUrl = URL.createObjectURL(blob);
        if (!cancelled) {
          setSrc(objectUrl);
          setFailed(false);
        }
      } catch {
        if (!cancelled) setFailed(true);
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    loadGitHubAsset();
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [fallbackAttempted, href]);

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
            if (!fallbackAttempted && isGitHubAssetUrl(href)) {
              setLoading(true);
              setFallbackAttempted(true);
              return;
            }
            setFailed(true);
          }}
          className="max-h-[420px] max-w-full rounded-md border border-slate-200 bg-white object-contain"
        />
      )}
      <span className="mt-1 inline-flex text-xs font-semibold text-blue-600 hover:text-blue-700">Anhang in GitHub öffnen</span>
    </a>
  );
}

function renderMarkdownParts(line: string) {
  const parts: Array<
    | { type: "text"; text: string }
    | { type: "link"; text: string; href: string }
    | { type: "image"; alt: string; href: string }
  > = [];
  const pattern = /<img\b[^>]*\balt=["']([^"']*)["'][^>]*\bsrc=["'](https?:\/\/[^"']+)["'][^>]*>|<img\b[^>]*\bsrc=["'](https?:\/\/[^"']+)["'][^>]*>|!\[([^\]]*)\]\((https?:\/\/[^)\s"'>]+)\)|\[([^\]]+)\]\((https?:\/\/[^)\s"'>]+)\)|(https?:\/\/[^\s)"'>]+)/g;
  let lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = pattern.exec(line)) !== null) {
    if (match.index > lastIndex) parts.push({ type: "text", text: line.slice(lastIndex, match.index) });
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

  if (lastIndex < line.length) parts.push({ type: "text", text: line.slice(lastIndex) });
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
              GitHub aktualisieren
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
          ) : (
            <article key={item.id} className="flex items-start gap-3 px-1 py-1 text-sm text-slate-500">
              <span className="mt-1 h-2 w-2 shrink-0 rounded-full bg-slate-300" />
              <div className="min-w-0 flex-1">
                <span>{item.message}</span>
                <span className="ml-2 text-xs text-slate-400">{formatDateTime(item.createdAt)}</span>
              </div>
            </article>
          )
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
