# findmydoc Planning

Factro-inspirierte Planungs-App für das interne findmydoc Founder-Board.

## Entwicklung

```bash
npm run dev
```

Die App läuft standardmäßig auf `http://localhost:3000`.

## Datenimport

Das Import-Script liest das alte Dashboard aus `../docs/findmydoc/founder-task-dashboard.html` und den lokalen State aus `../docs/findmydoc/dashboard-state.json`.

```bash
npm run import:legacy
```

Ausgabe:

- `src/lib/generated/seed-data.ts` für lokale Seed-Daten
- `supabase/schema.sql` für das Datenbankschema
- `supabase/seed.sql` für Schema plus importierte Startdaten

## Supabase

1. Supabase-Projekt anlegen.
2. `supabase/seed.sql` im SQL Editor ausführen.
3. `.env.example` nach `.env.local` kopieren und Werte setzen.
4. App neu starten.

Ohne Supabase-ENV nutzt die App den Seed-Fallback. UI-Änderungen werden dann dauerhaft im lokalen Browser gespeichert.

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
npm run verify:google-chat
```

## Supabase prüfen

Nach dem Eintragen der `.env.local` prüft dieser Befehl, ob die wichtigsten Tabellen erreichbar und befüllt sind:

```bash
npm run verify:supabase
```

Die Hierarchie aus Epic / Meilenstein, Group Commitment, Deliverable und Sub-Issue prüft:

```bash
npm run verify:hierarchy
```

Erwartet werden aktuell 5 Profile, 5 Packages und 54 Tasks.

Die Auth-Zuordnung prüft dieser Befehl:

```bash
npm run verify:auth
```

Er meldet fehlende GitHub-Logins, fehlende Rollen oder veraltete `auth_user_id`-Verknüpfungen, bevor `REQUIRE_SUPABASE_AUTH=true` aktiviert wird.

Der operative Smoke-Test prüft Supabase, Health, Server-Render und Kernmarker der UI:

```bash
npm run verify:operational
```

Der GitHub-Sync-Check prüft read-only, ob Supabase-Mapping, Sync Queue und App-only-Deliverables sauber erkennbar sind. Echte GitHub-Schreibrechte werden im Browser mit dem eingeloggten GitHub-User geprüft:

```bash
npm run verify:github-sync
```

Die manuelle Browser-Abnahme steht in `docs/acceptance-checklist.md`.

## Health Check

Die Route `/api/health` liefert eine kompakte Readiness-Prüfung ohne Secrets. Ohne Supabase oder bei falschen Counts antwortet sie mit `503` und `status: "degraded"`. Nach erfolgreicher Supabase-Anbindung und korrektem Seed antwortet sie mit `200` und `status: "ready"`.
