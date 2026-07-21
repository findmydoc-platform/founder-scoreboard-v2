"use client";

import { Check, Link2, MessageSquare, Share2, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import {
  buildTaskShareMessage,
  buildTaskShareUrl,
  googleChatUrl,
} from "@/features/tasks/model/task-share-message";
import type { Task } from "@/lib/types";
import { UiButton, UiTextArea } from "@/shared/atoms/ui-primitives";

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    try {
      await navigator.clipboard.writeText(value);
      return;
    } catch {
      // Fall back for browsers that expose the API but deny direct access.
    }
  }

  const field = document.createElement("textarea");
  field.value = value;
  field.setAttribute("readonly", "");
  field.style.position = "fixed";
  field.style.opacity = "0";
  document.body.appendChild(field);
  field.select();
  const copied = document.execCommand("copy");
  field.remove();
  if (!copied) throw new Error("clipboard-unavailable");
}

export function TaskSharePopover({ task }: { task: Task }) {
  const rootRef = useRef<HTMLDivElement>(null);
  const feedbackTimeoutRef = useRef<number | null>(null);
  const [open, setOpen] = useState(false);
  const [message, setMessage] = useState("");
  const [taskUrl, setTaskUrl] = useState("");
  const [linkCopied, setLinkCopied] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);

  useEffect(() => () => {
    if (feedbackTimeoutRef.current !== null) window.clearTimeout(feedbackTimeoutRef.current);
  }, []);

  useEffect(() => {
    if (!open) return;
    const closeOnOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    window.addEventListener("pointerdown", closeOnOutside);
    window.addEventListener("keydown", closeOnEscape);
    return () => {
      window.removeEventListener("pointerdown", closeOnOutside);
      window.removeEventListener("keydown", closeOnEscape);
    };
  }, [open]);

  const openPopover = () => {
    const nextTaskUrl = buildTaskShareUrl(task.id, window.location.origin);
    setTaskUrl(nextTaskUrl);
    setMessage(buildTaskShareMessage(task, nextTaskUrl));
    setLinkCopied(false);
    setError("");
    setOpen(true);
    window.requestAnimationFrame(() => rootRef.current?.querySelector("textarea")?.focus());
  };

  const closePopover = () => {
    if (busy) return;
    setOpen(false);
  };

  const copyLink = async () => {
    try {
      await copyText(taskUrl);
      setError("");
      setLinkCopied(true);
      if (feedbackTimeoutRef.current !== null) window.clearTimeout(feedbackTimeoutRef.current);
      feedbackTimeoutRef.current = window.setTimeout(() => setLinkCopied(false), 2000);
    } catch {
      setLinkCopied(false);
      setError("Der Link konnte nicht kopiert werden.");
    }
  };

  const copyMessageAndOpenChat = async () => {
    setBusy(true);
    setError("");
    const chatWindow = window.open("", "_blank");
    if (!chatWindow) {
      setBusy(false);
      setError("Google Chat konnte nicht geöffnet werden. Bitte erlaube Pop-ups und versuche es erneut.");
      return;
    }

    chatWindow.opener = null;
    try {
      await copyText(message);
      chatWindow.location.replace(googleChatUrl);
      setOpen(false);
    } catch {
      chatWindow.close();
      setError("Die Nachricht konnte nicht kopiert werden. Bitte versuche es erneut.");
    } finally {
      setBusy(false);
    }
  };

  return (
    <div ref={rootRef} className="relative">
      <UiButton
        type="button"
        size="lg"
        onClick={open ? closePopover : openPopover}
        aria-expanded={open}
        aria-haspopup="dialog"
        data-tour-id="task-share-trigger"
      >
        <Share2 size={16} aria-hidden="true" />
        Teilen
      </UiButton>

      {open ? (
        <div
          role="dialog"
          aria-label="Issue teilen"
          data-tour-id="task-share-popover"
          className="absolute left-0 top-12 z-50 w-[min(88vw,420px)] rounded-lg border border-slate-200 bg-white p-3 shadow-xl sm:left-auto sm:right-0 sm:p-4"
        >
          <div className="flex items-start justify-between gap-3">
            <div>
              <h3 className="text-sm font-semibold text-slate-950">Issue teilen</h3>
              <p className="mt-1 text-xs leading-5 text-slate-500">Nachricht prüfen und bei Bedarf anpassen.</p>
            </div>
            <button
              type="button"
              onClick={closePopover}
              disabled={busy}
              className="grid h-8 w-8 shrink-0 place-items-center rounded-md text-slate-500 transition hover:bg-slate-50 disabled:opacity-50"
              aria-label="Teilen schließen"
            >
              <X size={16} aria-hidden="true" />
            </button>
          </div>

          <label className="mt-3 block">
            <span className="sr-only">Nachricht</span>
            <UiTextArea
              value={message}
              onChange={(event) => setMessage(event.target.value)}
              minHeight="2xl"
              inputPadding="md"
              leading="relaxed"
              className="w-full resize-none"
            />
          </label>

          <UiButton
            type="button"
            variant="primary"
            size="lg"
            className="mt-3 w-full whitespace-normal px-3 text-center"
            onClick={copyMessageAndOpenChat}
            disabled={busy || !message.trim()}
          >
            <MessageSquare size={16} aria-hidden="true" />
            {busy ? "Google Chat wird geöffnet …" : "Nachricht kopieren & Google Chat öffnen"}
          </UiButton>

          <div className="mt-2 flex min-h-9 items-center justify-center border-t border-slate-100 pt-2">
            <button
              type="button"
              onClick={copyLink}
              disabled={busy}
              className={`inline-flex min-h-9 items-center gap-2 rounded-md px-3 text-sm font-semibold transition focus:outline-none focus:ring-2 focus:ring-blue-400 ${linkCopied ? "text-emerald-700" : "text-blue-700 hover:bg-blue-50"}`}
            >
              {linkCopied ? <Check size={16} aria-hidden="true" /> : <Link2 size={16} aria-hidden="true" />}
              {linkCopied ? "Link kopiert" : "Nur Link kopieren"}
            </button>
          </div>

          {error ? <p role="alert" className="mt-2 text-xs leading-5 text-red-700">{error}</p> : null}
        </div>
      ) : null}
    </div>
  );
}
