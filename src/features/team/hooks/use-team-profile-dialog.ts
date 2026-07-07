"use client";

import { useState } from "react";
import type { Profile } from "@/lib/types";

export function useTeamProfileDialog(profiles: Profile[]) {
  const [editingProfileId, setEditingProfileId] = useState<string | null>(null);
  const editingProfile = editingProfileId ? profiles.find((profile) => profile.id === editingProfileId) || null : null;

  return {
    closeProfileDialog: () => setEditingProfileId(null),
    editingProfile,
    editingProfileId,
    openProfileDialog: setEditingProfileId,
  };
}
