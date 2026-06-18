"use client";

import { CustomSelect } from "@/shared/atoms/custom-select";
import { roleLabel } from "@/lib/platform";
import type { Profile } from "@/lib/types";

export function DevRoleSwitch({
  profiles,
  actualProfile,
  value,
  onChange,
}: {
  profiles: Profile[];
  actualProfile: Profile | null;
  value: string;
  onChange: (value: string) => void;
}) {
  const effectiveProfile = profiles.find((profile) => profile.id === value) || actualProfile;
  return (
    <div className="flex items-center gap-2 rounded-md border border-amber-200 bg-amber-50 px-2 py-1">
      <span className="text-[11px] font-semibold uppercase tracking-wide text-amber-700">Dev-Ansicht</span>
      <CustomSelect
        value={value || ""}
        onChange={onChange}
        className="h-7 min-w-36 text-xs"
        options={[
          { value: "", label: actualProfile ? `${actualProfile.name} (echt)` : "Echt angemeldet" },
          ...profiles.map((profile) => ({
            value: profile.id,
            label: `${profile.name} · ${roleLabel(profile)}`,
          })),
        ]}
      />
      {effectiveProfile && (
        <span className="rounded-full border border-amber-200 bg-white px-2 py-0.5 text-[11px] font-semibold text-amber-800">
          {roleLabel(effectiveProfile)}
        </span>
      )}
    </div>
  );
}
