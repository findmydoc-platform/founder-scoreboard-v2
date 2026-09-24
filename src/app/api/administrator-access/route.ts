import { NextResponse, type NextRequest } from "next/server";
import {
  inactiveAdministratorAccess,
  type AdministratorAccessSnapshot,
} from "@/features/administrator-access/model/administrator-access";
import { apiError, authzError } from "@/lib/api-response";
import { bearerToken, requireTeamMember } from "@/lib/authz";
import { getSupabaseForToken } from "@/lib/supabase";

function sessionClient(request: NextRequest) {
  const token = bearerToken(request);
  return token ? getSupabaseForToken(token) : null;
}

async function snapshot(request: NextRequest) {
  const permission = await requireTeamMember(request);
  if (!permission.ok) return { response: authzError(permission) } as const;
  const supabase = sessionClient(request);
  if (!supabase) return { access: inactiveAdministratorAccess } as const;
  const { data, error } = await supabase.rpc("administrator_access_snapshot");
  if (error) return { response: apiError("Adminzugang konnte nicht geprüft werden.", 503) } as const;
  return { access: (data || inactiveAdministratorAccess) as AdministratorAccessSnapshot } as const;
}

export async function GET(request: NextRequest) {
  const result = await snapshot(request);
  if ("response" in result) return result.response;
  return NextResponse.json({ administratorAccess: result.access });
}

export async function POST(request: NextRequest) {
  const permission = await requireTeamMember(request);
  if (!permission.ok) return authzError(permission);
  const supabase = sessionClient(request);
  if (!supabase) return apiError("Ein echter Adminzugang ist nur mit einer Benutzersession verfügbar.", 403);
  const { data, error } = await supabase.rpc("activate_administrator_access");
  if (error?.code === "42501") return apiError("Du bist nicht für den Adminzugang berechtigt.", 403);
  if (error) return apiError("Adminzugang konnte nicht aktiviert werden.", 500);
  return NextResponse.json({ administratorAccess: data as AdministratorAccessSnapshot });
}

export async function DELETE(request: NextRequest) {
  const permission = await requireTeamMember(request);
  if (!permission.ok) return authzError(permission);
  const supabase = sessionClient(request);
  if (!supabase) return apiError("Ein echter Adminzugang ist nur mit einer Benutzersession verfügbar.", 403);
  const { data, error } = await supabase.rpc("end_administrator_access");
  if (error) return apiError("Adminzugang konnte nicht beendet werden.", 500);
  return NextResponse.json({ administratorAccess: data as AdministratorAccessSnapshot });
}
