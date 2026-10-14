"use client";

import { Users } from "lucide-react";
import { useId, useLayoutEffect, useRef, useState } from "react";
import { activeMarkdownMention, availableMentionOptions, mentionOptions, replaceActiveMention, type MentionOption } from "@/lib/mentions";
import type { Profile } from "@/lib/types";
import { classNames, UiTextArea, type UiTextAreaProps } from "@/shared/atoms/ui-primitives";

type MentionAnchor = {
  left: number;
  top: number;
  width: number;
};

type Props = Omit<UiTextAreaProps, "onChange"> & {
  profiles?: Profile[];
  containerClassName?: string;
  onValueChange: (value: string) => void;
};

function MentionProfileAvatar({ option }: { option: Extract<MentionOption, { kind: "person" }> }) {
  const initial = option.name.trim().slice(0, 1).toUpperCase() || option.login.slice(0, 1).toUpperCase();

  return (
    <span className="relative grid h-8 w-8 shrink-0 place-items-center overflow-hidden rounded-full bg-slate-100 text-xs font-semibold text-slate-700">
      {initial}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={`https://avatars.githubusercontent.com/${encodeURIComponent(option.login)}?s=64`}
        alt=""
        className="absolute inset-0 h-full w-full object-cover"
        onError={(event) => { event.currentTarget.hidden = true; }}
      />
    </span>
  );
}

function mentionAnchorAtCaret(textarea: HTMLTextAreaElement, caret: number, optionCount: number): MentionAnchor {
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
  const width = Math.min(352, Math.max(240, textarea.clientWidth - 8));
  const minLeft = textarea.offsetLeft + 4;
  const maxLeft = textarea.offsetLeft + textarea.clientWidth - width - 4;
  const left = textarea.offsetLeft + markerRect.left - mirrorRect.left - textarea.scrollLeft;
  const menuHeight = Math.max(optionCount, 1) * 56 + 8;
  const belowTop = textarea.offsetTop + markerRect.top - mirrorRect.top - textarea.scrollTop + lineHeight;
  const wrapperTop = textarea.parentElement?.getBoundingClientRect().top || textarea.getBoundingClientRect().top;
  const top = wrapperTop + belowTop + menuHeight > window.innerHeight - 8
    ? Math.max(8 - wrapperTop, textarea.offsetTop - menuHeight - 4)
    : belowTop;
  return {
    left: Math.max(minLeft, Math.min(left, maxLeft)),
    top,
    width,
  };
}

export function TaskMentionTextArea({ profiles = [], containerClassName, value, onValueChange, onSelect, onScroll, onKeyDown, onBlur, ...props }: Props) {
  const mentionListId = useId();
  const textareaRef = useRef<HTMLTextAreaElement | null>(null);
  const text = typeof value === "string" ? value : "";
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [activeMentionIndex, setActiveMentionIndex] = useState(0);
  const [mentionDismissed, setMentionDismissed] = useState(false);
  const [mentionAnchor, setMentionAnchor] = useState<MentionAnchor | null>(null);
  const activeMention = mentionDismissed ? null : activeMarkdownMention(text, selection.start, selection.end);
  const suggestedOptions = activeMention ? mentionOptions(activeMention.query, profiles) : [];
  const options = activeMention ? availableMentionOptions(activeMention.query, profiles, text, activeMention).slice(0, 6) : [];
  const menuOpen = Boolean(activeMention);
  const listOpen = menuOpen && options.length > 0;
  const duplicateOnly = menuOpen && suggestedOptions.length > 0 && options.length === 0;
  const selectedIndex = Math.min(activeMentionIndex, Math.max(options.length - 1, 0));

  useLayoutEffect(() => {
    const textarea = textareaRef.current;
    if (!menuOpen || !textarea) {
      setMentionAnchor(null);
      return undefined;
    }
    const updateAnchor = () => setMentionAnchor(mentionAnchorAtCaret(textarea, selection.start, options.length));
    updateAnchor();
    window.addEventListener("resize", updateAnchor);
    return () => window.removeEventListener("resize", updateAnchor);
  }, [menuOpen, options.length, selection.start, text]);

  function rememberSelection(target: HTMLTextAreaElement) {
    setSelection({ start: target.selectionStart, end: target.selectionEnd });
  }

  function insertMention(option: MentionOption) {
    const replacement = replaceActiveMention(text, activeMention, option);
    const textarea = textareaRef.current;
    if (!replacement || !textarea) return;
    onValueChange(replacement.value);
    setSelection({ start: replacement.caret, end: replacement.caret });
    setMentionDismissed(true);
    requestAnimationFrame(() => {
      textarea.focus();
      textarea.setSelectionRange(replacement.caret, replacement.caret);
    });
  }

  return (
    <span className={classNames("relative block", containerClassName)}>
      <UiTextArea
        data-tour-id="task-mention-composer"
        ref={textareaRef}
        value={value}
        onChange={(event) => {
          onValueChange(event.currentTarget.value);
          rememberSelection(event.currentTarget);
          setActiveMentionIndex(0);
          setMentionDismissed(false);
        }}
        onSelect={(event) => {
          onSelect?.(event);
          rememberSelection(event.currentTarget);
        }}
        onScroll={(event) => {
          onScroll?.(event);
          if (menuOpen && textareaRef.current) setMentionAnchor(mentionAnchorAtCaret(textareaRef.current, selection.start, options.length));
        }}
        onKeyDown={(event) => {
          onKeyDown?.(event);
          if (event.defaultPrevented || !menuOpen) return;
          if (event.key === "Escape") {
            event.preventDefault();
            setMentionDismissed(true);
          } else if (options.length && event.key === "ArrowDown") {
            event.preventDefault();
            setActiveMentionIndex((current) => (current + 1) % options.length);
          } else if (options.length && event.key === "ArrowUp") {
            event.preventDefault();
            setActiveMentionIndex((current) => (current - 1 + options.length) % options.length);
          } else if (options.length && (event.key === "Enter" || event.key === "Tab")) {
            event.preventDefault();
            insertMention(options[selectedIndex]);
          }
        }}
        onBlur={(event) => {
          onBlur?.(event);
          setMentionDismissed(true);
        }}
        aria-activedescendant={listOpen ? `${mentionListId}-option-${selectedIndex}` : undefined}
        aria-autocomplete="list"
        aria-controls={listOpen ? mentionListId : undefined}
        {...props}
      />
      {listOpen && mentionAnchor ? (
        <span
          id={mentionListId}
          role="listbox"
          aria-label="Person erwähnen"
          className="absolute z-30 block overflow-hidden rounded-lg border border-slate-300 bg-white py-1 shadow-lg"
          style={mentionAnchor}
        >
          {options.map((option, index) => {
            const selected = index === selectedIndex;
            return (
              <span
                key={`${option.kind}:${option.id}`}
                data-tour-id={option.kind === "all" ? "task-mention-all-option" : undefined}
                id={`${mentionListId}-option-${index}`}
                role="option"
                aria-selected={selected}
                aria-label={option.kind === "all" ? `@all, Alle Personen in FounderOps, ${option.count} ${option.count === 1 ? "Person" : "Personen"}` : `${option.name}, @${option.login}`}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => insertMention(option)}
                className={classNames(
                  "flex min-h-11 cursor-pointer items-center gap-3 px-3 py-2 text-left outline-none",
                  selected ? "bg-blue-50" : "hover:bg-slate-50",
                )}
              >
                {option.kind === "all" ? (
                  <Users size={18} aria-hidden="true" className="text-blue-600" />
                ) : (
                  <MentionProfileAvatar option={option} />
                )}
                <span className="min-w-0">
                  <span className="block truncate text-sm font-semibold text-slate-950">@{option.login}</span>
                  <span className="block truncate text-xs text-slate-600">{option.name}</span>
                </span>
                {option.kind === "all" ? (
                  <span aria-hidden="true" className="ml-auto min-w-6 rounded-full bg-blue-100 px-2 py-0.5 text-center text-xs font-semibold text-blue-700">
                    {option.count}
                  </span>
                ) : null}
              </span>
            );
          })}
        </span>
      ) : null}
      {menuOpen && !options.length && mentionAnchor ? (
        <span role="status" className="absolute z-30 block rounded-lg border border-slate-300 bg-white px-4 py-2 text-sm text-slate-500 shadow-lg" style={mentionAnchor}>
          {duplicateOnly ? "Diese Erwähnung steht bereits im Text." : "Keine passenden Personen."}
        </span>
      ) : null}
    </span>
  );
}
