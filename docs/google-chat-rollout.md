# Google Chat Rollout

Stand: 2026-05-29

## Ziel

Google Chat ist ein Benachrichtigungskanal, nicht das führende System. Aufgaben, Reviews, Kommentare und Benachrichtigungseinstellungen bleiben in Supabase. Google Chat bekommt nur bewusst gefilterte Hinweise, damit das Team nicht mit Einzelmeldungen überflutet wird.

Operative Event Messages bleiben in der Applikation. Der GitHub-Actions-Google-Chat-Pfad ist nur für Release-Details oder Deployment-Zusammenfassungen gedacht, nicht für den laufenden Event-Stream.

## Phase 1: FounderOps-Gruppendigest

Phase 1 aktiviert nur den Gruppenbereich-Digest. Der alte Google-Chat-Bereich `Founder Scoreboard` wird in Google Chat manuell zu `FounderOps` umbenannt. Der Incoming Webhook muss zu genau diesem `FounderOps`-Gruppenbereich gehören.

Für Production/Pipeline werden in Phase 1 gesetzt:

```bash
APP_URL=https://founder-ops.findmydoc.eu
GOOGLE_CHAT_WEBHOOK_URL=<Webhook des FounderOps-Gruppenbereichs>
GOOGLE_CHAT_DELIVERY_ENABLED=true
```

Die Chat-API-Service-Account-Werte bleiben in Phase 1 leer. Private DMs und Chat-Kommandos sind spätere Phasen.

## Phase 2: Operative Delivery-API

Phase 2 hält den Gruppenbereich-Digest als kontrollierten App-Endpunkt bereit. Er darf manuell oder durch eine bewusst betriebene externe Pipeline ausgelöst werden, ist aber nicht mehr die GitHub-Actions-Chat-Pipeline des Repositories.

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

Der Header-Secret ist nur für operative Delivery-API-Aufrufe gedacht. Der manuelle Button in den Einstellungen nutzt weiter die normale Operational-Lead-Session. Wenn der Header fehlt, ungültig ist oder `GOOGLE_CHAT_DELIVERY_ENABLED=false` bleibt, wird kein Google-Chat-Versand ausgeführt.

GitHub Actions nutzt diesen operativen Delivery-Endpunkt nicht. Das Repository verwendet für Google Chat stattdessen den separaten Release-Workflow `.github/workflows/send-release-google-chat.yml`.

## Phase 2b: Release-Kanal über GitHub Actions

Release-Details und Deployment-Zusammenfassungen laufen über den GitHub-Actions-Workflow `.github/workflows/send-release-google-chat.yml`.

Workflow:

```text
.github/workflows/send-release-google-chat.yml
Trigger: workflow_dispatch
Input: message_payload_json
Secret: GOOGLE_CHAT_WEBHOOK_URL
Zweck: Release-Details oder Deployment-Zusammenfassungen an den FounderOps-Google-Chat senden
```

Der Release-Workflow darf keine operativen Events erzeugen oder zustellen. Er ruft weder `/api/notifications/generate-digest` noch `/api/notifications/deliver` auf.

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
- fällige oder überfällige Sprint-Reviews
- überfällige Deliverables

Jeder Reminder wird pro Event-Typ, Entität, Empfänger und Berlin-Kalendertag über `notification_events.dedupe_key` höchstens einmal erzeugt. `task.comment` bleibt weiterhin nur In-App; gezielte Erwähnungen in Kommentaren laufen separat als `task.mention`.

Sebastian-/Rresta-Übergabepaket:

```text
GitHub Release Workflow:
Secret: GOOGLE_CHAT_WEBHOOK_URL=<Webhook des FounderOps-Gruppenbereichs>

Vercel Production Runtime:
APP_URL=https://founder-ops.findmydoc.eu
GOOGLE_CHAT_WEBHOOK_URL=<neuer oder sicher übergebener FounderOps-Bot Webhook>
GOOGLE_CHAT_DELIVERY_ENABLED=true
FOUNDEROPS_DELIVERY_SECRET=<random secret für operative Delivery-API, nicht für Release-Chat>

Workflow:
.github/workflows/send-release-google-chat.yml
Manual run: workflow_dispatch mit `message_payload_json` und optionalem `release_tag`
Step 1: JSON-Payload und `GOOGLE_CHAT_WEBHOOK_URL` prüfen
Step 2: Payload an Google Chat senden
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

## Phase 4: Persönliche FounderOps-DMs

Phase 4 aktiviert nur ausgehende persönliche Google-Chat-DMs für klare Action-Items. Es gibt weiterhin keine Google-Chat-Kommandos, keine Dialoge und keine LLM-generierten Antworten.

Persönliche DMs sind erlaubt für:

- `task.review_requested`
- `task.review_rework`
- `task.mention`
- `task.blocker_reported`
- `task.deadline_overdue`

Normale `task.comment`-Events, allgemeine Gruppenhinweise und unklare Events ohne eindeutigen Empfänger bleiben In-App oder im Gruppen-Digest. Gezielte Kommentar-Erwähnungen erzeugen `task.mention` und dürfen persönlich per DM zugestellt werden. Wenn ein persönliches Action-Item keinen gültigen `profiles.google_chat_dm_space` hat, wird der Zustellversuch als `failed` mit `deliveryMode=direct_dm` protokolliert; es gibt keinen Gruppenchat-Fallback.

## Bot-Branding und geplanter Endpoint

Die Google-Chat-App heißt `FounderOps`. Frühere Namen wie `Founder Scoreboard`, `Founder Scoreboard Bot` oder `Founders CoreBot` sind Altbezeichnungen und sollen bei neuen Google-Cloud-, Google-Chat-, GitHub-Actions- und Dokumentationsänderungen nicht weitergeführt werden.

Für die Chat-App-Konfiguration in Google Cloud ist nach dem erfolgreichen GitHub-Actions-Deployment dieser öffentliche HTTPS-Endpunkt vorgesehen:

```text
https://founder-ops.findmydoc.eu/api/google-chat/events
```

Dieser Endpoint ist im Code als sichere Empfangsroute vorbereitet. In Phase 4 bestätigt er Erreichbarkeit und nimmt Google-Chat-Events an, aktiviert aber keine Chat-Kommandos.

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
7. `pnpm run verify:google-chat` ausführen.
8. `POST /api/notifications/deliver` im deaktivierten Zustand testen. Erwartet ist kein Versand.
9. Erst danach `GOOGLE_CHAT_DELIVERY_ENABLED=true` setzen.
10. Einen einzelnen Digest oder eine persönliche Test-DM senden und `notification_deliveries` prüfen.
11. Danach erst die regelmäßige Zustellung planen.

Sebastian-/Rresta-Paket für Phase 4:

```text
Google Cloud:
- Google Chat API aktivieren
- FounderOps Chat-App mit Endpoint https://founder-ops.findmydoc.eu/api/google-chat/events konfigurieren
- Service Account für Chat API bereitstellen

Vercel Production Runtime:
GOOGLE_CHAT_SERVICE_ACCOUNT_EMAIL=<service-account-email>
GOOGLE_CHAT_PRIVATE_KEY=<service-account-private-key mit \n>
GOOGLE_CHAT_DELIVERY_ENABLED=true

Supabase:
profiles.google_chat_dm_space je Person im Format spaces/...

Smoke:
POST /api/notifications/deliver mit x-founderops-delivery-secret
Erwartung: notification_deliveries.status=sent und payload.deliveryMode=direct_dm
```

## Profile und Präferenzen

Die Profile enthalten Felder für persönliche Zustellung:

- `profiles.google_chat_user_id`
- `profiles.google_chat_dm_space`
- `profiles.notifications_enabled`

Die Tabelle `notification_preferences` steuert pro Person und Event-Typ, ob ein Event in Google Chat gesendet werden darf. Beispiele sind Review-Anfragen, Review-Ergebnisse, Blocker, Weekly-Rückmeldungen und Feedback.

## Zustelllogik

Die App erzeugt automatische Fokus-Reminder in `/api/notifications/generate-digest` und verarbeitet `notification_events` anschließend in `/api/notifications/deliver`.

- Wenn Chat API konfiguriert ist und ein Profil `google_chat_dm_space` im Format `spaces/...` hat, sendet FounderOps persönlich an diesen DM-Space.
- Wenn ein persönliches Action-Item keinen gültigen DM-Space hat, wird der Zustellversuch als fehlgeschlagen in `notification_deliveries` protokolliert.
- Der Webhook bleibt nur für Gruppen-Digests und wird nicht als Fallback für fehlende persönliche DM-Spaces genutzt.
- User- und Event-Präferenzen werden vor dem Versand ausgewertet.

## Phase 5: Betrieb und Kontrolle

Phase 5 ergänzt kein Chat-Kommando und keine LLM-Antwort. Die Einstellungen zeigen ein Delivery-Monitoring mit Readiness, `direct_dm`/`webhook_digest`, Ziel, Attempts, Fehlertext und Retry.

- `POST /api/notifications/deliver` akzeptiert optional `eventIds` für kontrollierten Retry einzelner pending Events.
- `eventIds` ist auf maximal 20 IDs begrenzt; bereits erfolgreich gesendete Events werden nicht doppelt gesendet.
- `testDelivery=webhook_digest` erzeugt eine kontrollierte FounderOps-Testnachricht für den Gruppenbereich.
- `testDelivery=direct_dm` benötigt `profileId` und sendet nur an ein Profil mit gültigem `profiles.google_chat_dm_space`.
- Fehlende DM-Spaces bleiben `failed/direct_dm`; es gibt weiterhin keinen Gruppenchat-Fallback.

Smoke nach Sebastian/Rresta-Secret-Setzung:

1. Settings öffnen und Readiness prüfen.
2. `Test-Digest senden` klicken und den FounderOps-Gruppenbereich prüfen.
3. `Test-DM` für ein Profil mit `spaces/...` senden.
4. Eine fehlende DM-Space-Konfiguration kontrolliert prüfen: `failed`, `deliveryMode=direct_dm`, kein Gruppenchat-Fallback.
5. Profil korrigieren und `Erneut senden` nutzen.

## Rollback

Bei falscher Zustellung, zu vielen Meldungen oder Konfigurationsfehlern:

1. `GOOGLE_CHAT_DELIVERY_ENABLED=false` setzen.
2. App neu starten oder Deployment-ENV aktualisieren.
3. In den Einstellungen prüfen, dass Google Chat wieder als deaktiviert angezeigt wird.
4. Die Outbox bleibt erhalten; fehlerhafte Zustellungen können später kontrolliert geprüft werden.

## Späterer Ausbau

Incoming Webhooks senden nur in einen Space. Echte 1:1-Direktnachrichten laufen über die Google Chat API an die gespeicherten DM-Spaces. Google-Chat-Kommandos in `/api/google-chat/events` bleiben ein späterer Ausbau.
