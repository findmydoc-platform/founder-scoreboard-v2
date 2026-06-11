"use client";

import { Check, ChevronDown, X } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { Profile } from "@/lib/types";

export function ProfileMultiSelect({
  value,
  profiles,
  onChange,
  placeholder = "Profile wählen",
}: {
  value: string[];
  profiles: Profile[];
  onChange: (value: string[]) => void;
  placeholder?: string;
}) {
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const selectedProfiles = profiles.filter((profile) => value.includes(profile.id));
  const selectedLabel = selectedProfiles.length ? selectedProfiles.map((profile) => profile.name).join(", ") : placeholder;

  useEffect(() => {
    if (!open) return;
    const handlePointerDown = (event: PointerEvent) => {
      if (!containerRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  const toggleProfile = (profileId: string) => {
    onChange(value.includes(profileId) ? value.filter((item) => item !== profileId) : [...value, profileId]);
  };

  return (
    <div ref={containerRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((current) => !current)}
        className="flex min-h-10 w-full items-center justify-between gap-2 rounded-md border border-slate-200 bg-white px-3 text-left text-sm font-normal text-slate-900 outline-none hover:bg-slate-50 focus:border-blue-400 focus:ring-2 focus:ring-blue-100"
        aria-haspopup="listbox"
        aria-expanded={open}
      >
        <span className={`truncate ${selectedProfiles.length ? "" : "text-slate-400"}`}>{selectedLabel}</span>
        <ChevronDown size={16} className={`shrink-0 text-slate-400 transition-transform ${open ? "rotate-180" : ""}`} />
      </button>
      {selectedProfiles.length > 0 && (
        <div className="mt-1 flex flex-wrap gap-1">
          {selectedProfiles.map((profile) => (
            <span key={profile.id} className="inline-flex max-w-full items-center gap-1 rounded-md border border-slate-200 bg-slate-50 px-2 py-1 text-xs font-semibold text-slate-700">
              <span className="truncate">{profile.name}</span>
              <button
                type="button"
                onClick={() => onChange(value.filter((item) => item !== profile.id))}
                className="grid h-4 w-4 shrink-0 place-items-center rounded text-slate-400 hover:bg-white hover:text-slate-700"
                aria-label={`${profile.name} entfernen`}
              >
                <X size={12} />
              </button>
            </span>
          ))}
        </div>
      )}
      {open && (
        <div className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-md border border-slate-200 bg-white p-1 shadow-lg" role="listbox" aria-multiselectable="true">
          {profiles.map((profile) => {
            const checked = value.includes(profile.id);
            return (
              <button
                key={profile.id}
                type="button"
                role="option"
                aria-selected={checked}
                onClick={() => toggleProfile(profile.id)}
                className={`flex w-full items-center justify-between gap-3 rounded px-2 py-2 text-left text-sm ${checked ? "bg-blue-50 text-blue-800" : "text-slate-700 hover:bg-slate-50"}`}
              >
                <span className="min-w-0 truncate">{profile.name}</span>
                <span className={`grid h-5 w-5 shrink-0 place-items-center rounded border ${checked ? "border-blue-500 bg-blue-600 text-white" : "border-slate-200 text-transparent"}`}>
                  <Check size={13} />
                </span>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
