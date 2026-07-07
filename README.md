# findmydoc Planning

Factro-inspirierte Planungs-App für das interne findmydoc Founder-Board.

## Entwicklung

```bash
pnpm run dev
```

Die App läuft standardmäßig auf `http://localhost:3000`.

## Supabase

1. Supabase-Projekt anlegen.
2. Supabase-Migrationen aus `supabase/` anwenden.
3. `.env.example` nach `.env.local` kopieren und Werte setzen.
4. Optional für Supabase-Demo-Import `SUPABASE_SERVICE_ROLE_KEY` oder `SUPABASE_SECRET_KEY` setzen.
5. App starten und den Header-Button `Demo Import` ausführen.

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

Als Vorlage für die Zuordnung gibt es `supabase/profile-auth-map.example.sql`.

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

Die Hierarchie aus Epic / Meilenstein, Group Commitment, Deliverable und Sub-Issue prüft:

```bash
pnpm run verify:hierarchy
```

Erwartet werden aktuell 5 Profile, 5 Packages und mindestens die 14 Demo-Tasks aus `src/lib/seed/source.json`.

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
