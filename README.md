# findmydoc Planning

Factro-inspirierte Planungs-App für das interne findmydoc Founder-Board.

## Entwicklung

```bash
pnpm run dev
```

Die App läuft standardmäßig auf `http://localhost:3000`.

## Supabase

The repository uses the pinned Supabase CLI and timestamp migrations under `supabase/migrations/`. There is no separate schema file or direct SQL apply path.

1. Copy `.env.example` to `.env.local` and configure the local values.
2. Start the local Supabase stack with `pnpm exec supabase start`.
3. Recreate the local database from the canonical migration history with `pnpm run db:reset`.
4. Optionally set `SUPABASE_SERVICE_ROLE_KEY` or `SUPABASE_SECRET_KEY` for the local demo import.
5. Start the app and use the `Demo Import` header action.

Create a new migration with `pnpm run db:migration:new -- <clear_name>`. Validate migration structure with `pnpm run verify:migrations`. Production applies only pending migrations through the protected GitHub Actions workflow.

Ohne Supabase-ENV oder bei fehlenden Core-Daten startet die App mit einem leeren lokalen Fallback. Demo-Daten aus `src/lib/seed/source.json` werden nur durch den lokalen `Demo Import` Button geladen. Mit leerer Supabase-Bootstrap-Datenbank schreibt der Button nach Supabase; ohne passende ENV befüllt er den lokalen Browser-State.

## Rollen und Zugriff

Das Schema enthält eine vorbereitete Supabase-Auth-Zuordnung über `profiles.github_login`. Nach dem Aktivieren des GitHub Providers in Supabase werden die Teamprofile über den GitHub-Login gemappt. `profiles.auth_user_id` kann später zusätzlich gesetzt werden, ist für V1 aber nicht der führende Schlüssel.

Rollen:

- `ceo`: volle operative Rechte und Decision-Log-Edit.
- `founder`: eigene operative Arbeit, Reviews und Bestätigungen.
- `deputy`: temporäre operative Vertretung ohne Decision-Log-Edit.
- `viewer`: liest nur.

Mit `REQUIRE_SUPABASE_AUTH=true` verlangt die API für Schreibzugriffe eine gültige Supabase-Session mit gemapptem GitHub-Login und passender `platform_role`. Für lokale Entwicklung kann der Wert auf `false` bleiben.

## Login-Ablauf

Sobald `NEXT_PUBLIC_SUPABASE_URL` und `NEXT_PUBLIC_SUPABASE_ANON_KEY` gesetzt sind, nutzt die App Supabase GitHub OAuth. Mit `REQUIRE_SUPABASE_AUTH=true` prüft der Server die Supabase-Session und `profiles.platform_role`, bevor Planungsdaten geladen oder gerendert werden. Ein Reload mit gültiger Session zeigt deshalb nur einen Ladezustand oder direkt die App, nicht zuerst den Login-Screen.

GitHub-Schreibaktionen verwenden weiterhin den eingeloggten GitHub-User-Token aus der aktiven Supabase OAuth Session. Dieser Provider-Token bleibt nur im Browser-Speicher und wird nicht persistiert. Wenn GitHub-Rechte erneut benötigt werden, erscheint die Aktion zentral im Header/Benachrichtigungsbereich statt in jeder einzelnen GitHub-Karte.

Der technische Ablauf mit Mermaid-Diagrammen steht in `docs/auth-flow.md`.

Für produktiven Teamzugriff:

1. GitHub Provider in Supabase Auth aktivieren.
2. Die jeweiligen GitHub-Logins in `profiles.github_login` eintragen.
3. Die Rolle in `profiles.platform_role` auf `ceo`, `founder`, `deputy` oder `viewer` setzen.
4. `REQUIRE_SUPABASE_AUTH=true` aktivieren.
5. Supabase Redirect URLs für `/auth/callback` und die Produktionsdomain freigeben.

Maintain `profiles.github_login` and `profiles.platform_role` through the Team profile management UI; there is no checked-in profile mapping SQL file.

## Founder Scoreboard v2 Module

- Rollenmodell: `CEO`, `Founder`, `Deputy`, `Viewer` über `profiles.platform_role` und `profiles.github_login`.
- Planungshierarchie: Epic / Meilenstein -> Group Commitment -> Deliverable -> Sub-Issue. Sprints sind Zeitcontainer für Deliverables.
- Sprint/Scoring: Aufgaben haben `sprint_id`, Review-Status, Punkte und Score-Lock-Felder.
- GitHub Sync: One-way App zu `findmydoc-platform/management` mit dem eingeloggten GitHub-User-Token aus Supabase OAuth.
- Decision Log: CEO erstellt/ändert, Founder bestätigen, vollständige Bestätigung lockt den Eintrag.
- Meeting Finder: V1 nutzt manuelle Arbeitszeiten und Abwesenheiten in Supabase.

## Google Chat

Google Chat ist als Outbox-basierter Benachrichtigungskanal vorbereitet. Der Versand ist standardmäßig deaktiviert und braucht beide ENV-Werte:

```bash
GOOGLE_CHAT_WEBHOOK_URL=
GOOGLE_CHAT_DELIVERY_ENABLED=false
```

Der sichere Rollout steht in `docs/google-chat-rollout.md`. Der lokale Check läuft mit:

```bash
pnpm run verify:google-chat
```

## Supabase prüfen

Nach dem Eintragen der `.env.local` prüft dieser Befehl, ob die wichtigsten Tabellen erreichbar und befüllt sind:

```bash
pnpm run verify:supabase
```

Die Auth-Zuordnung prüft dieser Befehl:

```bash
pnpm run verify:auth
```

Er meldet fehlende GitHub-Logins, fehlende Rollen oder veraltete `auth_user_id`-Verknüpfungen, bevor `REQUIRE_SUPABASE_AUTH=true` aktiviert wird.

Der operative Smoke-Test prüft Supabase, Health, Server-Render und Kernmarker der UI:

```bash
pnpm run verify:operational
```

Der GitHub-Sync-Check prüft read-only, ob Supabase-Mapping, Sync Queue und App-only-Deliverables sauber erkennbar sind. Echte GitHub-Schreibrechte werden im Browser mit dem eingeloggten GitHub-User geprüft:

```bash
pnpm run verify:github-sync
```

Die manuelle Browser-Abnahme steht in `docs/acceptance-checklist.md`.

## Health Check

Die Route `/api/health` liefert eine kleine Basis-Readiness-Prüfung ohne Secrets. Sie prüft nur, ob Supabase konfiguriert ist, die App Supabase-Daten nutzt und die Core-Tabellen `profiles`, `packages` und `tasks` erreichbar sind. Tiefere Schema-, Auth-, GitHub- und fachliche Rollout-Prüfungen laufen über `verify:supabase`, `verify:auth`, `verify:github-sync` und `verify:operational`.
