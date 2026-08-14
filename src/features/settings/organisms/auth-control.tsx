"use client";

import { SiGithub } from "@icons-pack/react-simple-icons";
import type { User } from "@supabase/supabase-js";
import { Settings } from "lucide-react";
import { useEffect, useRef, useState } from "react";

function getUserMetadataString(user: User | null, key: string) {
  const value = user?.user_metadata?.[key];
  return typeof value === "string" ? value : "";
}

export function AuthControl({
  user,
  busy,
  onSignIn,
  onSignOut,
  onOpenProfile,
  variant = "header",
}: {
  user: User | null;
  busy: boolean;
  onSignIn: () => void;
  onSignOut: () => void;
  onOpenProfile?: () => void;
  variant?: "header" | "gate";
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const githubLogin = getUserMetadataString(user, "user_name") || getUserMetadataString(user, "preferred_username");
  const avatarUrl = getUserMetadataString(user, "avatar_url");
  const displayName = getUserMetadataString(user, "full_name") || getUserMetadataString(user, "name") || githubLogin || user?.email || "";

  useEffect(() => {
    if (!open) return;

    const closeOnOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };

    window.addEventListener("pointerdown", closeOnOutside);
    return () => window.removeEventListener("pointerdown", closeOnOutside);
  }, [open]);

  useEffect(() => {
    const openAccountMenu = () => setOpen(true);
    window.addEventListener("fmd:open-account-menu", openAccountMenu);
    return () => window.removeEventListener("fmd:open-account-menu", openAccountMenu);
  }, []);

  if (!user) {
    return (
      <button
        type="button"
        onClick={onSignIn}
        disabled={busy}
        className={variant === "gate"
          ? "inline-flex h-12 w-full items-center justify-center gap-3 rounded-[5px] bg-[#1557ff] px-4 text-base font-medium text-white shadow-sm transition hover:bg-[#0d47e5] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[#1557ff] disabled:cursor-not-allowed disabled:opacity-60"
          : "inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-medium text-slate-700 transition hover:bg-slate-50 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-600 disabled:cursor-not-allowed disabled:opacity-60"}
      >
        <SiGithub size={variant === "gate" ? 21 : 17} aria-hidden="true" />
        {busy ? "GitHub wird geöffnet..." : "Mit GitHub anmelden"}
      </button>
    );
  }

  if (variant === "gate") {
    return (
      <div className="rounded-lg border border-slate-200 bg-slate-50 p-3">
        <div className="flex min-w-0 items-center gap-3">
          {avatarUrl ? (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={avatarUrl} alt="" className="h-10 w-10 shrink-0 rounded-full border border-slate-200 bg-white object-cover" />
          ) : (
            <span className="grid h-10 w-10 shrink-0 place-items-center rounded-full border border-slate-200 bg-white text-sm font-semibold text-slate-700">
              {displayName.slice(0, 1).toUpperCase() || "?"}
            </span>
          )}
          <div className="min-w-0 flex-1">
            <div className="truncate text-sm font-semibold text-slate-950">{displayName}</div>
            <div className="truncate text-xs text-slate-500">{githubLogin ? `@${githubLogin}` : user.email || "GitHub angemeldet"}</div>
          </div>
          <button
            type="button"
            onClick={onSignOut}
            disabled={busy}
            className="h-9 shrink-0 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50 disabled:cursor-not-allowed disabled:opacity-60"
          >
            Abmelden
          </button>
        </div>
      </div>
    );
  }

  return (
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((value) => !value)}
        onKeyDown={(event) => {
          if (event.key === "Escape") setOpen(false);
        }}
        aria-label="Account-Menü öffnen"
        data-tour-id="account-menu-trigger"
        className="grid h-9 w-9 place-items-center rounded-full border border-slate-200 bg-white p-0.5 shadow-sm transition hover:border-slate-300 hover:bg-slate-50"
      >
        {avatarUrl ? (
          // eslint-disable-next-line @next/next/no-img-element
          <img
            src={avatarUrl}
            alt=""
            className="h-8 w-8 rounded-full bg-slate-100 object-cover"
          />
        ) : (
          <span className="grid h-8 w-8 place-items-center rounded-full bg-slate-100 text-xs font-semibold text-slate-700">
            {displayName.slice(0, 1).toUpperCase() || "?"}
          </span>
        )}
      </button>
      {open && (
        <div className="absolute right-0 top-11 z-30 w-80 rounded-lg border border-slate-200 bg-white p-4 text-sm shadow-xl">
          <div className="grid gap-4">
            <div className="flex min-w-0 items-center gap-3">
              {avatarUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={avatarUrl}
                  alt=""
                  className="h-11 w-11 shrink-0 rounded-full border border-slate-200 bg-slate-100 object-cover"
                />
              ) : (
                <div className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full border border-slate-200 bg-slate-100 text-sm font-semibold text-slate-600">
                  {displayName.slice(0, 1).toUpperCase() || "?"}
                </div>
              )}
              <div className="min-w-0">
                <div className="text-xs font-semibold uppercase tracking-wide text-slate-500">Angemeldet mit GitHub</div>
                <div className="mt-1 truncate font-semibold text-slate-950">{displayName}</div>
                {githubLogin && <div className="truncate text-xs text-slate-500">@{githubLogin}</div>}
                {user.email && <div className="truncate text-xs text-slate-500">{user.email}</div>}
              </div>
            </div>
            <button
              type="button"
              onClick={() => {
                setOpen(false);
                onOpenProfile?.();
              }}
              data-tour-id="profile-menu-link"
              className="inline-flex h-9 items-center gap-2 rounded-md border border-slate-200 bg-white px-3 text-sm font-semibold text-slate-700 transition hover:bg-slate-50"
            >
              <Settings size={16} />
              Mein Profil
            </button>
            <button
              type="button"
              onClick={onSignOut}
              disabled={busy}
              className="h-9 rounded-md bg-slate-900 px-3 text-sm font-semibold text-white disabled:opacity-60"
            >
              Abmelden
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
