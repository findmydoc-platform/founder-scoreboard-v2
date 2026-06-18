"use client";

import { CheckSquare, Square } from "lucide-react";

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
        <button
          key={`${line.raw}-${index}`}
          type="button"
          disabled={!onChange}
          onClick={() => {
            if (!onChange) return;
            const nextLines = lines.map((item, itemIndex) => (itemIndex === index ? { ...item, checked: !item.checked } : item));
            onChange(serializeChecklist(nextLines));
          }}
          className="group flex items-start gap-2 rounded-md px-2 py-1.5 text-left text-sm leading-6 text-slate-700 hover:bg-slate-50 disabled:cursor-default disabled:hover:bg-transparent"
        >
          {line.checked ? (
            <CheckSquare size={16} className="mt-1 shrink-0 text-blue-600" />
          ) : (
            <Square size={16} className="mt-1 shrink-0 text-slate-400 group-hover:text-slate-600" />
          )}
          <span className={line.checked ? "text-slate-500 line-through decoration-slate-300" : ""}>{line.text}</span>
        </button>
      ))}
    </div>
  );
}
