"use client";

import { SiGithub } from "@icons-pack/react-simple-icons";
import type { User } from "@supabase/supabase-js";
import { Check, Settings } from "lucide-react";
import { useEffect, useRef, useState } from "react";

export type TestProfileMenuOption = {
  id: string;
  initials: string;
  label: string;
};

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
  testProfileOptions = [],
  activeTestProfileId = "",
  onTestProfileChange,
  variant = "header",
}: {
  user: User | null;
  busy: boolean;
  onSignIn: () => void;
  onSignOut: () => void;
  onOpenProfile?: () => void;
  testProfileOptions?: TestProfileMenuOption[];
  activeTestProfileId?: string;
  onTestProfileChange?: (profileId: string) => void;
  variant?: "header" | "gate";
}) {
  const rootRef = useRef<HTMLDivElement>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const menuRef = useRef<HTMLDivElement>(null);
  const returnFocusRef = useRef<HTMLElement | null>(null);
  const [open, setOpen] = useState(false);
  const githubLogin = getUserMetadataString(user, "user_name") || getUserMetadataString(user, "preferred_username");
  const avatarUrl = getUserMetadataString(user, "avatar_url");
  const displayName = getUserMetadataString(user, "full_name") || getUserMetadataString(user, "name") || githubLogin || user?.email || "";
  const activeTestProfile = testProfileOptions.find((profile) => profile.id === activeTestProfileId) || null;

  useEffect(() => {
    if (!open) return;

    const closeOnOutside = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      event.preventDefault();
      setOpen(false);
      window.requestAnimationFrame(() => returnFocusRef.current?.focus());
    };
    const focusFrame = window.requestAnimationFrame(() => {
      menuRef.current?.querySelector<HTMLElement>("[data-account-menu-autofocus]")?.focus();
    });

    window.addEventListener("pointerdown", closeOnOutside);
    document.addEventListener("keydown", closeOnEscape, true);
    return () => {
      window.cancelAnimationFrame(focusFrame);
      window.removeEventListener("pointerdown", closeOnOutside);
      document.removeEventListener("keydown", closeOnEscape, true);
    };
  }, [open]);

  useEffect(() => {
    const openAccountMenu = () => {
      returnFocusRef.current = document.activeElement instanceof HTMLElement ? document.activeElement : null;
      setOpen(true);
    };
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
        ref={triggerRef}
        type="button"
        onClick={() => {
          if (open) {
            setOpen(false);
            return;
          }
          returnFocusRef.current = triggerRef.current;
          setOpen(true);
        }}
        aria-label={activeTestProfile
          ? `Account-Menü öffnen. Testprofil ${activeTestProfile.label} aktiv`
          : "Account-Menü öffnen"}
        aria-expanded={open}
        aria-controls="founderops-account-menu"
        data-tour-id="account-menu-trigger"
        className={`grid h-9 w-9 place-items-center rounded-full border bg-white p-0.5 shadow-sm transition focus-visible:outline-none focus-visible:ring-2 [@media(pointer:coarse)]:h-11 [@media(pointer:coarse)]:w-11 ${
          activeTestProfile
            ? "border-emerald-400 ring-2 ring-emerald-200 hover:border-emerald-500 focus-visible:ring-emerald-500"
            : "border-slate-200 hover:border-slate-300 hover:bg-slate-50 focus-visible:ring-blue-500"
        }`}
      >
        {activeTestProfile ? (
          <span className="grid h-8 w-8 place-items-center rounded-full bg-emerald-50 text-[10px] font-bold text-emerald-800">
            {activeTestProfile.initials}
          </span>
        ) : avatarUrl ? (
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
        <div
          ref={menuRef}
          id="founderops-account-menu"
          role="dialog"
          aria-label="Account und Testprofil"
          className="fixed right-4 top-14 z-[80] max-h-[calc(100dvh-4.5rem)] w-[min(20rem,calc(100vw-2rem))] overflow-y-auto rounded-lg border border-slate-200 bg-white p-4 text-sm shadow-xl xl:absolute xl:right-0 xl:top-11 xl:max-h-[calc(100dvh-5rem)]"
        >
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
            {testProfileOptions.length > 0 && onTestProfileChange ? (
              <div className="grid gap-2 border-y border-slate-100 py-3">
                <div className="px-1 text-xs font-semibold uppercase tracking-wide text-slate-500">Testprofil wechseln</div>
                <div className="grid gap-1" role="listbox" aria-label="Lokales Testprofil">
                  <button
                    type="button"
                    data-account-menu-autofocus
                    role="option"
                    aria-selected={!activeTestProfileId}
                    onClick={() => {
                      onTestProfileChange("");
                      setOpen(false);
                      window.requestAnimationFrame(() => returnFocusRef.current?.focus());
                    }}
                    className={`flex min-h-11 items-center gap-3 rounded-md px-2.5 text-left transition ${
                      !activeTestProfileId ? "bg-blue-50 text-blue-800" : "text-slate-700 hover:bg-slate-50"
                    }`}
                  >
                    <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-slate-100 text-xs font-semibold text-slate-700">EA</span>
                    <span className="min-w-0 flex-1">
                      <span className="block truncate font-semibold">Eigene Ansicht</span>
                      <span className="block truncate text-xs text-slate-500">Mit deinem GitHub-Konto</span>
                    </span>
                    {!activeTestProfileId ? <Check size={16} className="shrink-0 text-blue-700" aria-hidden="true" /> : null}
                  </button>
                  {testProfileOptions.map((profile) => {
                    const active = profile.id === activeTestProfileId;
                    return (
                      <button
                        key={profile.id}
                        type="button"
                        role="option"
                        aria-selected={active}
                        onClick={() => {
                          onTestProfileChange(profile.id);
                          setOpen(false);
                          window.requestAnimationFrame(() => returnFocusRef.current?.focus());
                        }}
                        className={`flex min-h-11 items-center gap-3 rounded-md px-2.5 text-left transition ${
                          active ? "bg-emerald-50 text-emerald-900" : "text-slate-700 hover:bg-slate-50"
                        }`}
                      >
                        <span className={`grid h-8 w-8 shrink-0 place-items-center rounded-full text-[10px] font-bold ${
                          active ? "bg-white text-emerald-800 ring-1 ring-emerald-300" : "bg-slate-100 text-slate-700"
                        }`}>
                          {profile.initials}
                        </span>
                        <span className="min-w-0 flex-1">
                          <span className="block truncate font-semibold">{profile.label}</span>
                          <span className="block truncate text-xs text-slate-500">Lokales Testprofil</span>
                        </span>
                        {active ? <Check size={16} className="shrink-0 text-emerald-700" aria-hidden="true" /> : null}
                      </button>
                    );
                  })}
                </div>
              </div>
            ) : null}
            <button
              type="button"
              data-account-menu-autofocus={testProfileOptions.length > 0 ? undefined : true}
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
