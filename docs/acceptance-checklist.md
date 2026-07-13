# Founder Scoreboard v2 - Abnahmecheckliste

Stand: 2026-05-25

## Vorab

Diese Checks sollen bewusst mit echter CEO-Session im Browser laufen. Automatische Read-only-Prüfungen laufen über:

```bash
pnpm run verify:supabase
pnpm run verify:auth
pnpm run verify:operational
pnpm run verify:github-sync
pnpm test
pnpm run lint
pnpm run build
```

## Login und Basiszustand

1. App unter `http://localhost:3000` öffnen.
2. Mit GitHub anmelden.
3. Seite neu laden.
4. Unten links muss der Teamzugriff die angemeldete Session zeigen.
5. `/api/health` muss `status: "ready"` für die Basis-Readiness melden.

Erwartung:
- Datenquelle ist Supabase.
- Ein Reload mit gültiger Session zeigt höchstens einen Ladezustand, aber keinen falschen Login-Screen.
- `pnpm run verify:supabase` und `pnpm run verify:auth` bestätigen Schema, Profile und Rollen.
- Navigation zeigt Planung, Sprint & Score, Team, Einstellungen und Mein Profil über das Account-Menü.

## Planung und Task-Erstellung

1. In `Planung` auf `Neu` klicken.
2. Als CEO ein Deliverable erstellen.
3. Prüfen, dass es im Board bei `Offen` erscheint.
4. Task öffnen und Status per Select ändern.
5. Task per Drag and Drop in eine andere Spalte verschieben.

Erwartung:
- Statuswechsel persistiert nach Reload.
- Deliverable ist score-relevant.
- Sub-Issues erscheinen nur im Detailpanel, nicht als eigene Board-Karte.

## Kommentare, Blocker und Review

1. Task öffnen.
2. Kommentar erfassen.
3. Blocker melden.
4. Review anfragen.
5. Als CEO über die Review-Checkliste akzeptieren, teilweise akzeptieren oder Nacharbeit setzen.

Erwartung:
- Kommentare und Blocker bleiben nach Reload sichtbar.
- Blocker setzt den Status auf `Blockiert`.
- Review-Anfrage setzt Status `Review`.
- Nacharbeit setzt Status `Nacharbeit`.
- Punkte werden erst nach Review final.

## Sprint & Score

1. `Sprint & Score` öffnen.
2. Sprint-Daten prüfen: Start, Ende, Review bis, Status.
3. Commitment pro Founder setzen: Lite, Standard, Heavy oder Away.
4. Wochenstunden erfassen.
5. Weekly Updates testen: Anwesenheit, schriftliches Update, akzeptierter Grund und Punkte.

Erwartung:
- Scoreboard ist tabellarisch.
- Commitments bleiben nach Reload erhalten.
- Weekly-Punkte sind separat von Task-Punkten sichtbar.

## Sprintabschluss und Carry-over

Nur ausführen, wenn Testdaten oder ein bewusst abschließbarer Sprint genutzt wird.

1. Offene Aufgabe mit Blocker anlegen oder bestehende Testaufgabe nutzen.
2. Sprint abschließen.
3. Neue Carry-over-Aufgabe im nächsten Sprint prüfen.

Erwartung:
- Ursprüngliche Aufgabe bekommt `score_final=true` und 0 offene Punkte.
- Kommunizierter Blocker wird als `accepted_carryover` markiert.
- Carry-over-Aufgabe zeigt Ursprung und Grund im Detailpanel.
- Notification-Event `sprint.task_carried_over` entsteht.

## GitHub Sync

Voraussetzung:
- GitHub OAuth Login ist aktiv.
- Die GitHub App ist auf `findmydoc-platform/management` installiert.
- Für Issue-Sync ist nur die technische GitHub-App-Installation erforderlich. Die persönliche Autorenverbindung wird nur für eigene Kommentare und Anhänge benötigt.

Check:
1. `pnpm run verify:github-sync` ausführen.
2. Planning öffnen und die GitHub-Sync-Queue im Header öffnen.
3. Die GitHub-Autorenverbindung im Header prüfen; sie darf den Issue-Sync nicht sperren.
4. `Offene GitHub Issues syncen` klicken; fehlende Parent-Deliverables werden vor ihren Sub-Issues angelegt.
5. Link zum GitHub Issue prüfen.

Erwartung:
- Read-only-Verify meldet Deliverables, Sub-Issues, die Sync-Queue und fehlende GitHub Issues.
- GitHub-Reconnect erscheint nicht mehrfach in einzelnen Karten, sondern zentral im Header/Benachrichtigungsbereich.
- Issue wird im Management-Repo über die GitHub-App-Installation erstellt oder aktualisiert.
- Der Sammel-Sync verarbeitet freigegebene Deliverables und ihre Sub-Issues Parent-first. Bei einem fehlgeschlagenen Parent wird das Kind übersprungen und bleibt in der Queue sichtbar.
- CEO, Founder, Deputy und Viewer können den Issue-Sync mit einer gültigen Team-Session auslösen.
- Viewer können weiterhin weder Task-Felder ändern noch neue Kommentare schreiben.
- Kommentare auf verknüpften Issues werden mit dem persönlichen Token ihres ursprünglichen Autors erstellt, auch wenn ein anderer Benutzer den Sync auslöst.
- Ohne gültige Autorenverbindung bleibt der Kommentar informativ wartend; der lokale Kommentar-Request und der Issue-Sync bleiben erfolgreich.
- OAuth-Reconnect sowie spätere Task- und Bulk-Syncs liefern wartende Kommentare idempotent nach.
- Body enthält den Aufgabenbrief mit Problem, Zielbild, Scope, Abnahmekriterien, Nachweis und Definition of Done.
- Parallele Syncs derselben Aufgabe oder desselben GitHub Issues werden als laufender Sync angezeigt, nicht als Fehler.
- GitHub Issues sind die native Arbeitsfläche für Issue-Inhalte; FounderOps ergänzt Planung, Review und Score-Kontext.

## Google Chat

Voraussetzung:
- `GOOGLE_CHAT_WEBHOOK_URL` ist gesetzt.

Check:
1. Event erzeugen, z. B. Kommentar oder Review-Anfrage.
2. Einstellungen öffnen.
3. Eine kontrollierte Test-Sammelmeldung oder persönliche Test-DM senden.
4. Für Release-Kommunikation den Dry Run `node .agents/skills/release-publish/scripts/publish-release.mjs --dry-run` prüfen und danach `.github/workflows/send-release-google-chat.yml` verwenden.

Erwartung:
- Wichtige Events werden als Digest gesendet und je Event als `sent` Delivery gespeichert.
- Persönliche Einzelhinweise bleiben in der In-App-Notification-Inbox, bis sie geschlossen werden.
- Ohne Webhook bleibt der Digest sichtbar, aber Versand scheitert kontrolliert.
- GitHub Actions sendet keine operativen Event-Digests mehr, sondern nur Release-Details oder Deployment-Zusammenfassungen.

## Offene V1-Grenzen

- Private 1:1-Google-Chat-DMs brauchen später eine Google Chat App/Bot-Konfiguration.
- GitHub-Sync ist V1 one-way App zu GitHub.
- Drag/Resize im Gantt ist noch nicht Teil von V1.
- Andere Founder-Logins müssen noch real getestet werden, sobald sie sich einmal angemeldet haben.
