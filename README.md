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

Sobald `NEXT_PUBLIC_SUPABASE_URL` und `NEXT_PUBLIC_SUPABASE_ANON_KEY` gesetzt sind, zeigt die App im Projektkopf einen Team-Login. Die Anmeldung nutzt Supabase GitHub OAuth. Nach erfolgreicher Anmeldung sendet das Frontend den Supabase Access Token bei Aufgabenänderungen an die API.

Für produktiven Teamzugriff:

1. GitHub Provider in Supabase Auth aktivieren.
2. Die jeweiligen GitHub-Logins in `profiles.github_login` eintragen.
3. Die Rolle in `profiles.platform_role` auf `ceo`, `founder`, `deputy` oder `viewer` setzen.
4. `REQUIRE_SUPABASE_AUTH=true` aktivieren.

Als Vorlage für die Zuordnung gibt es `supabase/profile-auth-map.example.sql`.

## Founder Scoreboard v2 Module

- Rollenmodell: `CEO`, `Founder`, `Deputy`, `Viewer` über `profiles.platform_role` und `profiles.github_login`.
- Planungshierarchie: Epic / Meilenstein -> Group Commitment -> Deliverable -> Sub-Issue. Sprints sind Zeitcontainer für Deliverables.
- Sprint/Scoring: Aufgaben haben `sprint_id`, Review-Status, Punkte und Score-Lock-Felder.
- GitHub Sync: One-way App zu `findmydoc-platform/management` mit `GITHUB_SYNC_TOKEN`.
- Decision Log: CEO erstellt/ändert, Founder bestätigen, vollständige Bestätigung lockt den Eintrag.
- Meeting Finder: V1 nutzt manuelle Arbeitszeiten und Abwesenheiten in Supabase.

## Supabase prüfen

Nach dem Eintragen der `.env.local` prüft dieser Befehl, ob die wichtigsten Tabellen erreichbar und befüllt sind:

```bash
npm run verify:supabase
```

Die Hierarchie aus Epic / Meilenstein, Group Commitment, Deliverable und Sub-Issue prüft:

```bash
npm run verify:hierarchy
```

Erwartet werden aktuell 5 Profile, 5 Packages und 53 Tasks.

Die Auth-Zuordnung prüft dieser Befehl:

```bash
npm run verify:auth
```

Er meldet fehlende GitHub-Logins, fehlende Rollen oder veraltete `auth_user_id`-Verknüpfungen, bevor `REQUIRE_SUPABASE_AUTH=true` aktiviert wird.

Der operative Smoke-Test prüft Supabase, Health, Server-Render und Kernmarker der UI:

```bash
npm run verify:operational
```

Die manuelle Browser-Abnahme steht in `docs/acceptance-checklist.md`.

## Health Check

Die Route `/api/health` liefert eine kompakte Readiness-Prüfung ohne Secrets. Ohne Supabase oder bei falschen Counts antwortet sie mit `503` und `status: "degraded"`. Nach erfolgreicher Supabase-Anbindung und korrektem Seed antwortet sie mit `200` und `status: "ready"`.
