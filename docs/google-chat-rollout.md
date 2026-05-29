# Google Chat Rollout

Stand: 2026-05-29

## Ziel

Google Chat ist ein Benachrichtigungskanal, nicht das führende System. Aufgaben, Reviews, Decisions, Kommentare und Benachrichtigungseinstellungen bleiben in Supabase. Google Chat bekommt nur bewusst gefilterte Hinweise, damit das Team nicht mit Einzelmeldungen überflutet wird.

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
```

Für den lokalen Trockenlauf bleibt `GOOGLE_CHAT_DELIVERY_ENABLED=false`. Für echte persönliche FounderOps-DMs werden `GOOGLE_CHAT_SERVICE_ACCOUNT_EMAIL`, `GOOGLE_CHAT_PRIVATE_KEY`, die Chat-API und pro Profil ein `profiles.google_chat_dm_space` im Format `spaces/...` benötigt. Der Webhook bleibt als Space-Digest-Fallback möglich.

## Bot-Branding und geplanter Endpoint

Die Google-Chat-App heißt `FounderOps`. Frühere Namen wie `Founder Scoreboard`, `Founder Scoreboard Bot` oder `Founders CoreBot` sind Altbezeichnungen und sollen bei neuen Google-Cloud-, Google-Chat-, Vercel- und Dokumentationsänderungen nicht weitergeführt werden.

Für die spätere Chat-App-Konfiguration in Google Cloud ist nach dem Vercel-Setup dieser öffentliche HTTPS-Endpunkt vorgesehen:

```text
https://founderops.findmydoc.eu/api/google-chat/events
```

Dieser Endpoint ist im Code als sichere Vorschau-Route vorbereitet. Er darf erst als produktive Google-Chat-App-URL verwendet werden, wenn `founderops.findmydoc.eu` auf die Vercel-App zeigt, das Deployment die Route `/api/google-chat/events` enthält und die Zustellung bewusst aktiviert wurde.

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

Die App verarbeitet `notification_events` in `/api/notifications/deliver`.

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
