"use client";

import { useState } from "react";
import type { Profile } from "@/lib/types";

export function TaskAssigneeAvatar({ profile, color }: { profile?: Pick<Profile, "name" | "avatarUrl">; color: string }) {
  const [failedUrl, setFailedUrl] = useState<string | null>(null);
  const avatarUrl = profile?.avatarUrl;
  const initial = profile?.name.trim().charAt(0).toLocaleUpperCase() || "?";

  return (
    <span
      aria-hidden="true"
      className="grid h-9 w-9 shrink-0 place-items-center overflow-hidden rounded-full border-2 bg-slate-100 text-sm font-semibold text-slate-700"
      style={{ borderColor: profile ? color : "#cbd5e1" }}
    >
      {avatarUrl && failedUrl !== avatarUrl ? (
        // Google-hosted identity images are validated before entering the planning model.
        // eslint-disable-next-line @next/next/no-img-element
        <img
          src={avatarUrl}
          alt=""
          className="h-full w-full object-cover"
          loading="lazy"
          decoding="async"
          draggable={false}
          onError={() => setFailedUrl(avatarUrl)}
        />
      ) : initial}
    </span>
  );
}
