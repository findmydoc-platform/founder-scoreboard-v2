# Google Chat Rollout

Stand: 2026-05-27

## Ziel

Google Chat ist ein Benachrichtigungskanal, nicht das führende System. Aufgaben, Reviews, Decisions, Kommentare und Benachrichtigungseinstellungen bleiben in Supabase. Google Chat bekommt nur bewusst gefilterte Hinweise, damit das Team nicht mit Einzelmeldungen überflutet wird.

Operative Event Messages bleiben in der Applikation. Ein möglicher Google-Chat-Pfad über eine Pipeline ist nur für Release-Details oder Deployment-Zusammenfassungen gedacht, nicht für den laufenden Event-Stream.

## Sicherheitsmodell

Die Zustellung ist zweifach gesperrt:

1. `GOOGLE_CHAT_WEBHOOK_URL` muss gesetzt sein.
2. `GOOGLE_CHAT_DELIVERY_ENABLED=true` muss gesetzt sein.

Solange `GOOGLE_CHAT_DELIVERY_ENABLED=false` ist, sammelt die App Benachrichtigungen weiter in Supabase und zeigt sie in der App an. Der Versand an Google Chat bleibt aus.

## Benötigte ENV-Werte

```bash
GOOGLE_CHAT_WEBHOOK_URL=
GOOGLE_CHAT_DELIVERY_ENABLED=false
```

Für den lokalen Trockenlauf bleibt `GOOGLE_CHAT_DELIVERY_ENABLED=false`. Für den echten Versand wird der Wert bewusst auf `true` gesetzt.

## Bot-Branding und geplanter Endpoint

Die Google-Chat-App soll unter dem Namen `FounderOps` geführt werden. Frühere Namen wie `Founder Scoreboard`, `Founder Scoreboard Bot` oder `Founders CoreBot` sind Altbezeichnungen und sollen bei neuen Google-Cloud-, Google-Chat-, GitHub-Actions- und Dokumentationsänderungen nicht weitergeführt werden.

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

1. Google-Chat-Space oder Zielkanal festlegen.
2. Incoming Webhook in Google Chat erstellen und URL als `GOOGLE_CHAT_WEBHOOK_URL` setzen.
3. `GOOGLE_CHAT_DELIVERY_ENABLED=false` lassen.
4. App starten und in den Einstellungen prüfen, dass Google Chat als gesammelt, aber nicht versandbereit angezeigt wird.
5. Benachrichtigung erzeugen, zum Beispiel Review anfragen oder Kommentar schreiben.
6. `npm run verify:google-chat` ausführen.
7. `POST /api/notifications/deliver` im deaktivierten Zustand testen. Erwartet ist kein Versand.
8. Erst danach `GOOGLE_CHAT_DELIVERY_ENABLED=true` setzen.
9. Einen einzelnen Digest senden und `notification_deliveries` prüfen.
10. Danach erst die regelmäßige Zustellung planen.

## Profile und Präferenzen

Die Profile enthalten Felder für spätere private Zustellung:

- `profiles.google_chat_user_id`
- `profiles.google_chat_dm_space`
- `profiles.notifications_enabled`

Die Tabelle `notification_preferences` steuert pro Person und Event-Typ, ob ein Event in den Google-Chat-Digest darf. Beispiele sind Review-Anfragen, Review-Ergebnisse, Blocker, Meeting-Rückmeldungen und Feedback.

## Offene Punkte für persönliche DMs

1. Von jedem Teammitglied die `FounderOps`-Direktchat-URL einsammeln und als `spaces/...` in `profiles.google_chat_dm_space` eintragen. Normale 1:1-Chats zwischen Teammitgliedern sind dafür nicht korrekt.
2. `founderops.findmydoc.eu` auf die per GitHub Actions bereitgestellte App zeigen lassen.
3. Die Route `/api/google-chat/events` über den GitHub-Actions-Deploy ausrollen und mit Google Chat testen, damit die Google-Chat-App Nachrichten und Installations-/Message-Events verarbeiten kann.
4. Den Versand von reinem `GOOGLE_CHAT_WEBHOOK_URL`-Digest auf Google Chat API Versand an `spaces/{dmSpace}/messages` erweitern, damit persönliche DMs wirklich an die Profil-DM-Spaces gehen.
5. Danach `GOOGLE_CHAT_DELIVERY_ENABLED=true` erst nach einem kontrollierten Test aktivieren.

## Rollback

Bei falscher Zustellung, zu vielen Meldungen oder Konfigurationsfehlern:

1. `GOOGLE_CHAT_DELIVERY_ENABLED=false` setzen.
2. App neu starten oder Deployment-ENV aktualisieren.
3. In den Einstellungen prüfen, dass Google Chat wieder als deaktiviert angezeigt wird.
4. Die Outbox bleibt erhalten; fehlerhafte Zustellungen können später kontrolliert geprüft werden.

## Späterer Ausbau

Incoming Webhooks senden nur in einen Space. Echte 1:1-Direktnachrichten brauchen später eine Google-Chat-App mit Chat API, OAuth/Service-Account-Konfiguration und sauberer Zuordnung von `profiles.google_chat_user_id` oder `profiles.google_chat_dm_space`.
