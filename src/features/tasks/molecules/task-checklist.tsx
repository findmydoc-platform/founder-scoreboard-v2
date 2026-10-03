"use client";

import { CheckSquare, Square } from "lucide-react";
import { LinkifiedText } from "@/shared/atoms/linkified-text";

type ChecklistLine = {
  checked: boolean;
  text: string;
  raw: string;
};

function parseChecklist(value: string): ChecklistLine[] {
  return value
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = /^[-*] \[(x|X| )\]\s+(.+)$/.exec(line);
      if (match) return { checked: match[1].toLowerCase() === "x", text: match[2], raw: line };
      return { checked: false, text: line.replace(/^[-*]\s+/, ""), raw: line };
    });
}

function serializeChecklist(lines: ChecklistLine[]) {
  return lines.map((line) => `- [${line.checked ? "x" : " "}] ${line.text}`).join("\n");
}

export function TaskChecklist({
  value,
  emptyText,
  onChange,
}: {
  value: string;
  emptyText: string;
  onChange?: (nextValue: string) => void;
}) {
  const lines = parseChecklist(value);

  if (!lines.length) {
    return <p className="text-sm italic leading-6 text-slate-500">{emptyText}</p>;
  }

  return (
    <div className="grid gap-1.5">
      {lines.map((line, index) => (
        <div
          key={`${line.raw}-${index}`}
          role="group"
          aria-label={line.text}
          className="group flex min-w-0 items-start gap-2 rounded-md text-sm leading-6 text-slate-700"
        >
          <button
            type="button"
            disabled={!onChange}
            aria-pressed={line.checked}
            aria-label={line.checked ? "Kriterium als offen markieren" : "Kriterium als erledigt markieren"}
            onClick={() => {
              if (!onChange) return;
              const nextLines = lines.map((item, itemIndex) => (itemIndex === index ? { ...item, checked: !item.checked } : item));
              onChange(serializeChecklist(nextLines));
            }}
            className="grid h-11 w-11 shrink-0 place-items-center rounded-md hover:bg-slate-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-blue-500 disabled:cursor-default"
          >
            {line.checked ? (
              <CheckSquare size={16} className="text-blue-600" aria-hidden="true" />
            ) : (
              <Square size={16} className="text-slate-400 group-hover:text-slate-600" aria-hidden="true" />
            )}
          </button>
          <span className={`min-w-0 py-2 [overflow-wrap:anywhere] ${line.checked ? "text-slate-500 line-through decoration-slate-300" : ""}`}>
            <LinkifiedText value={line.text} />
          </span>
        </div>
      ))}
    </div>
  );
}
