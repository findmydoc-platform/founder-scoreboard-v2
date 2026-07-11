import { ShieldX } from "lucide-react";
import type { TeamTaskIntakeTokenRecord } from "@/features/intake/model/team-task-intake-contract";
import { UiBadge, UiButton } from "@/shared/atoms/ui-primitives";

function formatDateTime(value: string) {
  if (!value) return "noch nie";
  return new Intl.DateTimeFormat("de-DE", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

function tokenState(token: TeamTaskIntakeTokenRecord, currentTime: number) {
  if (token.revokedAt) return { label: "Widerrufen", tone: "red" as const };
  if (Date.parse(token.expiresAt) <= currentTime) return { label: "Abgelaufen", tone: "amber" as const };
  return { label: "Aktiv", tone: "emerald" as const };
}

export function ProfileTeamIntakeTokenRow({
  currentTime,
  onRevoke,
  pending,
  token,
}: {
  currentTime: number;
  onRevoke: (tokenId: string) => void;
  pending: boolean;
  token: TeamTaskIntakeTokenRecord;
}) {
  const state = tokenState(token, currentTime);
  const active = !token.revokedAt && Date.parse(token.expiresAt) > currentTime;

  return (
    <div className="rounded-md border border-slate-200 px-3 py-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-semibold text-slate-900">{token.label}</span>
            <UiBadge tone={state.tone} size="xs">{state.label}</UiBadge>
            <code className="text-xs text-slate-500">{token.tokenHint}</code>
          </div>
          <div className="mt-1 text-xs leading-5 text-slate-500">
            Erstellt {formatDateTime(token.createdAt)} · Läuft ab {formatDateTime(token.expiresAt)} · Zuletzt genutzt {formatDateTime(token.lastUsedAt)}
          </div>
        </div>
        {active && (
          <UiButton onClick={() => onRevoke(token.id)} disabled={pending} size="sm" variant="red">
            <ShieldX size={15} />
            Widerrufen
          </UiButton>
        )}
      </div>
    </div>
  );
}
