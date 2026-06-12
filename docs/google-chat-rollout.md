# Google Chat Rollout

Stand: 2026-05-29

## Ziel

Google Chat ist ein Benachrichtigungskanal, nicht das führende System. Aufgaben, Reviews, Decisions, Kommentare und Benachrichtigungseinstellungen bleiben in Supabase. Google Chat bekommt nur bewusst gefilterte Hinweise, damit das Team nicht mit Einzelmeldungen überflutet wird.

Operative Event Messages bleiben in der Applikation. Ein möglicher Google-Chat-Pfad über eine Pipeline ist nur für Release-Details oder Deployment-Zusammenfassungen gedacht, nicht für den laufenden Event-Stream.

## Phase 1: FounderOps-Gruppendigest

Phase 1 aktiviert nur den Gruppenbereich-Digest. Der alte Google-Chat-Bereich `Founder Scoreboard` wird in Google Chat manuell zu `FounderOps` umbenannt. Der Incoming Webhook muss zu genau diesem `FounderOps`-Gruppenbereich gehören.

Für Production/Pipeline werden in Phase 1 gesetzt:

```bash
APP_URL=https://founder-ops.findmydoc.eu
GOOGLE_CHAT_WEBHOOK_URL=<Webhook des FounderOps-Gruppenbereichs>
GOOGLE_CHAT_DELIVERY_ENABLED=true
```

Die Chat-API-Service-Account-Werte bleiben in Phase 1 leer. Private DMs und Chat-Kommandos sind spätere Phasen.

## Phase 2: Externe Pipeline

Phase 2 automatisiert den Gruppenbereich-Digest ohne LLM-Antworten. Sebastian betreibt eine externe Pipeline, die werktags um `09:00 Europe/Berlin` den bestehenden Delivery-Endpunkt auslöst.

Pipeline-Request:

```http
POST https://founder-ops.findmydoc.eu/api/notifications/deliver
x-founderops-delivery-secret: <FOUNDEROPS_DELIVERY_SECRET>
content-type: application/json

{ "limit": 20 }
```

Zusätzlicher Production-/Pipeline-Wert:

```bash
FOUNDEROPS_DELIVERY_SECRET=<random secret>
```

Der Header-Secret ist nur für die externe Pipeline gedacht. Der manuelle Button in den Einstellungen nutzt weiter die normale Operational-Lead-Session. Wenn der Header fehlt, ungültig ist oder `GOOGLE_CHAT_DELIVERY_ENABLED=false` bleibt, wird kein Google-Chat-Versand ausgeführt.

Im Repository ist dafür `.github/workflows/google-chat-digest.yml` vorgesehen. Der Workflow läuft werktags per GitHub Actions Schedule und kann manuell mit `workflow_dispatch` gestartet werden.

## Phase 3: Automatische Fokus-Reminder

Phase 3 erzeugt vor dem Versand automatisch wichtige Business-Hinweise als `notification_events`. Der Gruppenchat bekommt weiterhin nur den bestehenden FounderOps-Digest; es gibt keine freien Bot-Antworten und keine privaten DMs.

Pipeline-Reihenfolge:

```http
POST https://founder-ops.findmydoc.eu/api/notifications/generate-digest
x-founderops-delivery-secret: <FOUNDEROPS_DELIVERY_SECRET>
content-type: application/json

{ "limit": 20 }
```

Danach:

```http
POST https://founder-ops.findmydoc.eu/api/notifications/deliver
x-founderops-delivery-secret: <FOUNDEROPS_DELIVERY_SECRET>
content-type: application/json

{ "limit": 20 }
```

Der Generator unterstützt für trockene Tests zusätzlich `{ "limit": 20, "dryRun": true }`. Dann werden Kandidaten und Dedupe-Keys zurückgegeben, aber keine `notification_events` geschrieben.

Erzeugte Reminder:

- offene Reviews
- Nacharbeit
- offene Blocker
- offene Aufgabenvorschläge
- offene Decision-Bestätigungen
- fällige oder überfällige Sprint-Reviews
- überfällige Deliverables

Jeder Reminder wird pro Event-Typ, Entität, Empfänger und Berlin-Kalendertag über `notification_events.dedupe_key` höchstens einmal erzeugt. `task.comment` bleibt weiterhin nur In-App.

Sebastian-/Rresta-Übergabepaket:

```text
GitHub Environment: production
Secret: FOUNDEROPS_DELIVERY_SECRET=<random secret>

Vercel Production Runtime:
APP_URL=https://founder-ops.findmydoc.eu
GOOGLE_CHAT_WEBHOOK_URL=<neuer oder sicher übergebener FounderOps-Bot Webhook>
GOOGLE_CHAT_DELIVERY_ENABLED=true
FOUNDEROPS_DELIVERY_SECRET=<gleiches random secret>

Workflow:
.github/workflows/google-chat-digest.yml
Schedule: werktags 09:00 Europe/Berlin Sommerzeit via 07:00 UTC
Manual run: workflow_dispatch mit optionalem limit, Standard 20
Step 1: /api/notifications/generate-digest
Step 2: /api/notifications/deliver
```

## Sicherheitsmodell

Die Zustellung ist zweifach gesperrt:

1. Entweder `GOOGLE_CHAT_WEBHOOK_URL` oder die Chat-API-Service-Account-Werte müssen gesetzt sein.
2. `GOOGLE_CHAT_DELIVERY_ENABLED=true` muss gesetzt sein.

Solange `GOOGLE_CHAT_DELIVERY_ENABLED=false` ist, sammelt die App Benachrichtigungen weiter in Supabase und zeigt sie in der App an. Der Versand an Google Chat bleibt aus.

## Benötigte ENV-Werte

```bash
GOOGLE_CHAT_WEBHOOK_URL=
GOOGLE_CHAT_SERVICE_ACCOUNT_EMAIL=
GOOGLE_CHAT_PRIVATE_KEY=
GOOGLE_CHAT_DELIVERY_ENABLED=false
FOUNDEROPS_DELIVERY_SECRET=
```

Für den lokalen Trockenlauf bleibt `GOOGLE_CHAT_DELIVERY_ENABLED=false`. Für echte persönliche FounderOps-DMs werden `GOOGLE_CHAT_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_CHAT_PRIVATE_KEY`, die Chat-API und pro Profil ein `profiles.google_chat_dm_space` im Format `spaces/...` benötigt. Der Webhook bleibt als Space-Digest-Fallback möglich.

## Bot-Branding und geplanter Endpoint

Die Google-Chat-App heißt `FounderOps`. Frühere Namen wie `Founder Scoreboard`, `Founder Scoreboard Bot` oder `Founders CoreBot` sind Altbezeichnungen und sollen bei neuen Google-Cloud-, Google-Chat-, GitHub-Actions- und Dokumentationsänderungen nicht weitergeführt werden.

Für die spätere Chat-App-Konfiguration in Google Cloud ist nach dem GitHub-Actions-Deployment und Domain-Cutover dieser öffentliche HTTPS-Endpunkt vorgesehen:

```text
https://founderops.findmydoc.eu/api/google-chat/events
```

Dieser Endpoint ist im Code als sichere Vorschau-Route vorbereitet. Er darf erst als produktive Google-Chat-App-URL verwendet werden, wenn `founderops.findmydoc.eu` auf die per GitHub Actions bereitgestellte App zeigt, das Deployment die Route `/api/google-chat/events` enthält und die Zustellung bewusst aktiviert wurde.

Empfohlene Google-Chat-App-Felder:

- Anwendungsname: `FounderOps`
- Beschreibung: `FounderOps Updates`
- Avatar-URL: `https://github.com/findmydoc-platform.png`

## Rollout-Schritte

1. FounderOps in Google Cloud/Google Chat konfigurieren und die Chat API aktivieren.
2. Service Account für die Chat-App bereitstellen und `GOOGLE_CHAT_SERVICE_ACCOUNT_EMAIL` sowie `GOOGLE_CHAT_PRIVATE_KEY` setzen.
3. FounderOps-Direktchat mit jedem Teammitglied öffnen und die DM-Spaces als `spaces/...` in `profiles.google_chat_dm_space` eintragen.
4. `GOOGLE_CHAT_DELIVERY_ENABLED=false` lassen.
5. App starten und in den Einstellungen prüfen, dass Google Chat als gesammelt, aber nicht versandbereit angezeigt wird.
6. Benachrichtigung erzeugen, zum Beispiel Review anfragen oder Kommentar schreiben.
7. `npm run verify:google-chat` ausführen.
8. `POST /api/notifications/deliver` im deaktivierten Zustand testen. Erwartet ist kein Versand.
9. Erst danach `GOOGLE_CHAT_DELIVERY_ENABLED=true` setzen.
10. Einen einzelnen Digest senden und `notification_deliveries` prüfen.
11. Danach erst die regelmäßige Zustellung planen.

## Profile und Präferenzen

Die Profile enthalten Felder für persönliche Zustellung:

- `profiles.google_chat_user_id`
- `profiles.google_chat_dm_space`
- `profiles.notifications_enabled`

Die Tabelle `notification_preferences` steuert pro Person und Event-Typ, ob ein Event in Google Chat gesendet werden darf. Beispiele sind Review-Anfragen, Review-Ergebnisse, Blocker, Meeting-Rückmeldungen und Feedback.

## Zustelllogik

Die App erzeugt automatische Fokus-Reminder in `/api/notifications/generate-digest` und verarbeitet `notification_events` anschließend in `/api/notifications/deliver`.

- Wenn Chat API konfiguriert ist und ein Profil `google_chat_dm_space` im Format `spaces/...` hat, sendet FounderOps persönlich an diesen DM-Space.
- Wenn kein DM-Space vorhanden ist, aber ein Webhook gesetzt ist, kann ein Space-Digest als Fallback gesendet werden.
- Wenn weder DM-Space noch Webhook verfügbar ist, wird der Zustellversuch als fehlgeschlagen in `notification_deliveries` protokolliert.
- User- und Event-Präferenzen werden vor dem Versand ausgewertet.

## Rollback

Bei falscher Zustellung, zu vielen Meldungen oder Konfigurationsfehlern:

1. `GOOGLE_CHAT_DELIVERY_ENABLED=false` setzen.
2. App neu starten oder Deployment-ENV aktualisieren.
3. In den Einstellungen prüfen, dass Google Chat wieder als deaktiviert angezeigt wird.
4. Die Outbox bleibt erhalten; fehlerhafte Zustellungen können später kontrolliert geprüft werden.

## Späterer Ausbau

Incoming Webhooks senden nur in einen Space. Echte 1:1-Direktnachrichten laufen über die Google Chat API an die gespeicherten DM-Spaces. Google-Chat-Kommandos in `/api/google-chat/events` bleiben ein späterer Ausbau.
