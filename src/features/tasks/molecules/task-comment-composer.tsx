"use client";

import { Paperclip } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState } from "react";
import type { ReactNode } from "react";
import { activeMarkdownMention, mentionSuggestions, replaceActiveMention, type MentionProfile } from "@/lib/mentions";
import type { Profile } from "@/lib/types";
import { UiButton } from "@/shared/atoms/ui-primitives";

type Props = {
  pending?: boolean;
  profiles?: Profile[];
  onAddComment: (comment: string) => Promise<void> | void;
  onUploadAttachment?: (file: File) => Promise<string>;
  renderPreview: (value: string) => ReactNode;
};

type MentionAnchor = {
  left: number;
  top: number;
  width: number;
};

function mentionAnchorAtCaret(textarea: HTMLTextAreaElement, caret: number): MentionAnchor {
  const computed = window.getComputedStyle(textarea);
  const mirror = document.createElement("div");
  const marker = document.createElement("span");
  const properties = [
    "boxSizing", "width", "fontFamily", "fontSize", "fontWeight", "fontStyle", "letterSpacing",
    "lineHeight", "textTransform", "textIndent", "wordSpacing", "tabSize", "paddingTop", "paddingRight",
    "paddingBottom", "paddingLeft", "borderTopWidth", "borderRightWidth", "borderBottomWidth", "borderLeftWidth",
    "overflowWrap", "wordBreak",
  ] as const;

  mirror.style.position = "fixed";
  mirror.style.visibility = "hidden";
  mirror.style.pointerEvents = "none";
  mirror.style.whiteSpace = "pre-wrap";
  mirror.style.overflow = "hidden";
  mirror.style.wordWrap = "break-word";
  properties.forEach((property) => { mirror.style[property] = computed[property]; });
  mirror.textContent = textarea.value.slice(0, caret);
  marker.textContent = ".";
  mirror.appendChild(marker);
  document.body.appendChild(mirror);

  const mirrorRect = mirror.getBoundingClientRect();
  const markerRect = marker.getBoundingClientRect();
  document.body.removeChild(mirror);

  const lineHeight = Number.parseFloat(computed.lineHeight) || Number.parseFloat(computed.fontSize) * 1.2;
  const width = Math.min(560, Math.max(192, textarea.clientWidth - 12));
  const minLeft = textarea.offsetLeft + 4;
  const maxLeft = textarea.offsetLeft + textarea.clientWidth - width - 4;
  const left = textarea.offsetLeft + markerRect.left - mirrorRect.left - textarea.scrollLeft;

  return {
    left: Math.max(minLeft, Math.min(left, maxLeft)),
    top: textarea.offsetTop + markerRect.top - mirrorRect.top - textarea.scrollTop + lineHeight,
    width,
  };
}

export function TaskCommentComposer({ pending = false, profiles = [], onAddComment, onUploadAttachment, renderPreview }: Props) {
  const textareaId = useId();
  const mentionListId = useId();
  const [newComment, setNewComment] = useState("");
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);
  const [mentionDismissed, setMentionDismissed] = useState(false);
  const [mentionAnchor, setMentionAnchor] = useState<MentionAnchor | null>(null);
  const [uploadPending, setUploadPending] = useState(false);
  const [submitPending, setSubmitPending] = useState(false);
  const [uploadError, setUploadError] = useState("");
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const showCommentPreview = /!\[[^\]]*\]\(https?:\/\/|https?:\/\/|\[[^\]]+\]\(https?:\/\//.test(newComment);
  const activeMention = mentionDismissed ? null : activeMarkdownMention(newComment, selection.start, selection.end);
  const mentionOptions = activeMention ? mentionSuggestions(activeMention.query, profiles).slice(0, 6) : [];
  const mentionMenuOpen = Boolean(activeMention);
  const mentionListOpen = mentionMenuOpen && mentionOptions.length > 0;
  const selectedMentionIndex = Math.min(activeMentionIndex, Math.max(mentionOptions.length - 1, 0));

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!mentionMenuOpen || !textarea) {
      setMentionAnchor(null);
      return undefined;
    }

    const updateAnchor = () => setMentionAnchor(mentionAnchorAtCaret(textarea, selection.start));
    updateAnchor();
    window.addEventListener("resize", updateAnchor);
    return () => window.removeEventListener("resize", updateAnchor);
  }, [mentionMenuOpen, newComment, selection.start]);

  function rememberSelection(target: HTMLTextAreaElement) {
    setSelection({ start: target.selectionStart, end: target.selectionEnd });
  }

  function updateComment(target: HTMLTextAreaElement) {
    setNewComment(target.value);
    rememberSelection(target);
    setActiveMentionIndex(0);
    setMentionDismissed(false);
  }

  async function uploadAttachment(file: File) {
    if (!onUploadAttachment) return;

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
  }

  async function submitComment() {
    const comment = newComment;
    setSubmitPending(true);
    try {
      await onAddComment(comment);
      setNewComment((current) => current === comment ? "" : current);
    } catch {
      // The owning workflow surfaces the error; keep the draft unchanged for retry.
    } finally {
      setSubmitPending(false);
    }
  }

  function insertMention(profile: MentionProfile) {
    const replacement = replaceActiveMention(newComment, activeMention, profile);
    if (!replacement) return;

    setNewComment(replacement.value);
    setSelection({ start: replacement.caret, end: replacement.caret });
    setMentionDismissed(true);
    requestAnimationFrame(() => {
      textareaRef.current?.focus();
      textareaRef.current?.setSelectionRange(replacement.caret, replacement.caret);
    });
  }

  function handleMentionKeyDown(event: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (!mentionMenuOpen) return;
    if (event.key === "Escape") {
      event.preventDefault();
      setMentionDismissed(true);
      return;
    }
    if (!mentionOptions.length) return;
    if (event.key === "ArrowDown") {
      event.preventDefault();
      setActiveMentionIndex((current) => (current + 1) % mentionOptions.length);
      return;
    }
    if (event.key === "ArrowUp") {
      event.preventDefault();
      setActiveMentionIndex((current) => (current - 1 + mentionOptions.length) % mentionOptions.length);
      return;
    }
    if (event.key === "Enter" || event.key === "Tab") {
      event.preventDefault();
      insertMention(mentionOptions[selectedMentionIndex]);
    }
  }

  return (
    <div className="relative mt-4 rounded-lg border border-slate-200 bg-slate-50 p-4">
      <label htmlFor={textareaId} className="text-sm font-semibold text-slate-900">Kommentar oder Update</label>
      <textarea
        id={textareaId}
        ref={textareaRef}
        value={newComment}
        onChange={(event) => updateComment(event.currentTarget)}
        onSelect={(event) => rememberSelection(event.currentTarget)}
        onScroll={() => {
          if (mentionMenuOpen && textareaRef.current) setMentionAnchor(mentionAnchorAtCaret(textareaRef.current, selection.start));
        }}
        onKeyDown={handleMentionKeyDown}
        onBlur={() => setMentionDismissed(true)}
        aria-activedescendant={mentionListOpen ? `${mentionListId}-option-${selectedMentionIndex}` : undefined}
        aria-autocomplete="list"
        aria-controls={mentionListOpen ? mentionListId : undefined}
        className="mt-2 min-h-28 w-full resize-y rounded-md border border-slate-200 bg-white p-3 text-sm leading-6 outline-none focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
        placeholder="Zum Beispiel: Entscheidung, Nachfrage oder Arbeitsfortschritt"
      />
      {mentionListOpen && mentionAnchor && (
        <div id={mentionListId} role="listbox" aria-label="Person erwähnen" className="absolute z-20 overflow-hidden rounded-lg border border-slate-300 bg-white shadow-lg" style={mentionAnchor}>
          {mentionOptions.map((profile, index) => (
            <div
              key={profile.id}
              id={`${mentionListId}-option-${index}`}
              role="option"
              aria-selected={index === selectedMentionIndex}
              aria-label={`${profile.name}, @${profile.githubLogin}`}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => insertMention(profile)}
              className={`min-h-11 cursor-pointer border-b border-slate-200 px-4 py-2 text-base outline-none last:border-b-0 ${index === selectedMentionIndex ? "bg-blue-600 text-white" : "text-slate-900 hover:bg-slate-50"}`}
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="shrink-0 font-semibold">{profile.githubLogin}</span>
                <span className={`min-w-0 truncate ${index === selectedMentionIndex ? "text-white" : "text-slate-500"}`}>{profile.name}</span>
              </span>
            </div>
          ))}
        </div>
      )}
      {mentionMenuOpen && !mentionOptions.length && mentionAnchor && (
        <div role="status" className="absolute z-20 rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-500 shadow-lg" style={mentionAnchor}>Keine passenden Personen.</div>
      )}
      {showCommentPreview && (
        <div className="mt-2 min-w-0 overflow-hidden rounded-md border border-slate-200 bg-slate-50 p-3">
          <div className="mb-2 text-xs font-semibold text-slate-500">Vorschau</div>
          {renderPreview(newComment)}
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
                onChange={(event) => {
                  const file = event.target.files?.[0];
                  event.target.value = "";
                  if (file) void uploadAttachment(file);
                }}
              />
              <UiButton
                type="button"
                size="lg"
                disabled={pending || uploadPending}
                onClick={() => fileInputRef.current?.click()}
              >
                <Paperclip size={15} />
                {uploadPending ? "Lädt hoch …" : "Datei anhängen"}
              </UiButton>
            </>
          )}
        </div>
        <UiButton
          type="button"
          size="lg"
          variant="primary"
          disabled={pending || submitPending || uploadPending || newComment.trim().length < 2}
          onClick={() => void submitComment()}
        >
          {submitPending ? "Kommentiert …" : "Kommentieren"}
        </UiButton>
      </div>
    </div>
  );
}
