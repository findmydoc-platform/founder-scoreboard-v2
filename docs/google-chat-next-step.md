# Google Chat Integration - Next Step

Stand: 2026-05-29

Der kontrollierte Aktivierungsplan steht in `docs/google-chat-rollout.md`.

## Ziel

Google Chat soll nicht zum Einzelspam werden. Die App sammelt operative Ereignisse in Supabase, zeigt sie jedem Nutzer als In-App-Notification und sendet nur wichtige Sammelmeldungen oder persönliche FounderOps-DMs.

## Gewünschte Benachrichtigungen

- Aufgaben: neue Zuweisung, Statusänderung, Kommentar/Nachfrage, Blocker.
- Review: Founder reicht Aufgabe zur Review ein, CEO wird informiert.
- Review outcome: the Founder is informed about acceptance, minor rework, or fundamental rework.
- Sprint-Ende: Founder werden rechtzeitig an offene Deliverables erinnert.
- Review-Deadline: Founder werden vor Sprintende erinnert, Review rechtzeitig einzureichen oder Blocker zu melden.
- Weekly Updates: Teilnahme, Abmeldung, schriftliches Update und Punkte lösen ebenfalls Benachrichtigungen aus.

## Technische Entscheidung

Nicht direkt beim Speichern an Google Chat senden. Stattdessen nutzt die App eine Notification-Outbox:

- `notification_events`: fachliches Ereignis und In-App-Hinweis, z.B. `task.review_requested`.
- `notification_deliveries`: Zustellversuche, Kanal, Status, Fehler, Retry.
- `notification_preferences`: steuerbar pro Person und Event-Typ.
- `profiles.google_chat_user_id`, `profiles.google_chat_dm_space`: Zuordnung für persönliche DM-Zustellung.

Operative Event Messages bleiben in der Applikation. Die GitHub-Actions-Google-Chat-Pipeline ist der Release-Kanal und darf nur Release-Details oder Deployment-Zusammenfassungen senden.

## Google Chat Stufen

1. In-App: operative Event Messages bleiben im Board und in der Outbox.
2. Release-Kanal: GitHub Actions sendet Release-Details oder Deployment-Zusammenfassungen über `.github/workflows/send-release-google-chat.yml` an Google Chat.
3. Danach: echte private Nachrichten über Google Chat App/Bot und Chat API.

Wichtig: Ein Incoming Webhook sendet nur in den konfigurierten Space. Für echte private 1:1-DMs braucht es eine Google-Chat-App/Bot-Konfiguration in Google Cloud und eine Zuordnung der Profile zu Google-Chat-Usern bzw. DM-Spaces. Die Release-Pipeline ist davon getrennt.

## FounderOps Entscheidung

Die Chat-App/Bot-Anzeige soll `FounderOps` heißen. Der geplante Google-Chat-App-Endpoint nach GitHub-Actions-Deployment und Domain-Cutover ist:

```text
https://founder-ops.findmydoc.eu/api/google-chat/events
```

Vorherige Namen wie `Founder Scoreboard Bot` oder `Founders CoreBot` gelten als Altbezeichnungen und sollen bei neuen Konfigurations- oder Codeänderungen nicht weiterverwendet werden.

## Nicht vergessen

In-App bleibt der Hauptkanal für individuelle Arbeit. Google Chat ist nur für wichtige Sammelmeldungen gedacht.
